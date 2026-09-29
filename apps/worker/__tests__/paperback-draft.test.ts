import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import {
  computePaperbackPlan,
  gutterRequiredMm,
  PB_MAX_PAGES,
  PB_MIN_PAGES,
} from '../src/tasks/paperback-draft/plan.js';
import {
  extractTitleId,
  toPaperbackCategorySegments,
  type PaperbackDraftPort,
  type PaperbackDraftResult,
} from '../src/tasks/paperback-draft/playwright-paperback-draft-port.js';
import {
  paperbackCoverKey,
  readCategoryPaths,
  runPaperbackDraft,
  CREATION_LIMIT_COOLDOWN_HOURS,
  PLAN_NG_COOLDOWN_HOURS,
  type PaperbackDraftPrisma,
} from '../src/tasks/paperback-draft.js';
import {
  runPaperbackDraftDispatcher,
  type PaperbackDraftDispatcherPrisma,
} from '../src/tasks/paperback-draft-dispatcher.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

describe('computePaperbackPlan (F-097f)', () => {
  it('ノド余白の必要量は頁数で段階的に増える', () => {
    expect(gutterRequiredMm(100)).toBe(9.6);
    expect(gutterRequiredMm(200)).toBe(12.7);
    expect(gutterRequiredMm(400)).toBe(15.9);
    expect(gutterRequiredMm(600)).toBe(19.1);
    expect(gutterRequiredMm(800)).toBe(22.3);
  });

  it('現行の本文 (左右15mm) は 300 頁までなら OK', () => {
    const ok = computePaperbackPlan(280);
    expect(ok.ready).toBe(true);
    expect(ok.gutterOk).toBe(true);
    expect(ok.reason).toBeNull();
  });

  it('301 頁以上はノド余白が足りず NG', () => {
    const ng = computePaperbackPlan(400);
    expect(ng.ready).toBe(false);
    expect(ng.reason).toContain('ノド余白NG');
  });

  it('頁数レンジ外は NG', () => {
    expect(computePaperbackPlan(PB_MIN_PAGES - 1).reason).toContain('頁数レンジ外');
    expect(computePaperbackPlan(PB_MAX_PAGES + 1).reason).toContain('頁数レンジ外');
  });

  it('背幅は頁数 × 0.0572mm', () => {
    expect(computePaperbackPlan(200).spineMm).toBeCloseTo(11.44, 2);
  });
});

describe('カテゴリ/URL の純関数', () => {
  it('Kindle のカテゴリパスからペーパーバック用のセグメントに変換する', () => {
    const segs = toPaperbackCategorySegments(['Kindle本 > 健康・フィットネス > 食事療法']);
    expect(segs).toEqual([['暮らし・健康・子育て', '食事療法']]);
  });

  it('Kindle本 が無いパスはそのまま使う / 最大 3 本', () => {
    const segs = toPaperbackCategorySegments(['A > B', 'C', 'D', 'E']);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual(['A', 'B']);
  });

  it('extractTitleId は print-setup の URL から取る', () => {
    expect(extractTitleId('https://kdp.amazon.co.jp/print-setup/paperback/6Z7D6HAHCBJ/content')).toBe('6Z7D6HAHCBJ');
    expect(extractTitleId('https://kdp.amazon.co.jp/ja_JP/bookshelf')).toBeNull();
  });

  it('readCategoryPaths は配列/JSON文字列/その他を吸収する', () => {
    expect(readCategoryPaths(['a', 'b'])).toEqual(['a', 'b']);
    expect(readCategoryPaths('["a"]')).toEqual(['a']);
    expect(readCategoryPaths('not json')).toEqual([]);
    expect(readCategoryPaths(null)).toEqual([]);
  });

  it('表紙 PDF の R2 キー', () => {
    expect(paperbackCoverKey('b1')).toBe('books/b1/paperback/cover.pdf');
  });
});

interface BookState {
  id: string;
  title: string;
  subtitle: string | null;
  asin: string | null;
  pb_publish_status: string;
  pb_title_id: string | null;
}

function buildPrisma(overrides: Partial<BookState> = {}, opts: { cover?: boolean; pdfKey?: string | null } = {}) {
  const book: BookState = {
    id: 'b1',
    title: 'テスト本',
    subtitle: null,
    asin: 'B0TEST0001',
    pb_publish_status: 'unlisted',
    pb_title_id: null,
    ...overrides,
  };
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    book: {
      findUnique: async () => book,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return {};
      },
    },
    kdpMetadata: {
      findFirst: async () => ({ categories: ['Kindle本 > 健康・フィットネス > 食事療法'], description: '紹介文。' }),
    },
    cover: {
      findFirst: async () => ((opts.cover ?? true) ? { r2_key: 'covers/b1.png' } : null),
    },
    artifact: {
      findFirst: async () => ({ r2_key: opts.pdfKey === undefined ? 'books/b1/manuscript/final.pdf' : opts.pdfKey }),
    },
    account: { findFirst: async () => ({ kdp_session_state_enc: 'enc', kdp_2fa_secret_enc: null }) },
  } as unknown as PaperbackDraftPrisma;
  return { prisma, updates, book };
}

function makePort(result: PaperbackDraftResult): { port: PaperbackDraftPort; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
      createDraft: async (args) => {
        calls.push(args);
        return result;
      },
    },
  };
}

/** 表紙画像のダミー (sharp が実画像を要求するため)。 */
async function makeCoverPng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 60, height: 90, channels: 3, background: '#335577' } })
    .png()
    .toBuffer();
}

/** 指定頁数のダミー PDF を作る (pdf-lib は実物を要求するため)。 */
async function makePdf(pages: number): Promise<Buffer> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([420, 595]);
  return Buffer.from(await doc.save());
}

describe('paperback.draft', () => {
  const baseDeps = {
    logger: makeLogger(),
    decryptSession: () => 'session-json',
    env: { AMAZON_PASSWORD: 'pw', AMAZON_TOTP_SECRET: 'sec' } as NodeJS.ProcessEnv,
    putAsset: vi.fn(async () => ({})),
  };

  it('下書きを作って DB に title_id を書き戻す', async () => {
    const { prisma, updates } = buildPrisma();
    const { port, calls } = makePort({ ok: true, titleId: 'ABC123', isbn: '9781234567897' });
    const pdf = await makePdf(120);
    const png = await makeCoverPng();

    const res = await runPaperbackDraft(
      { book_id: 'b1' },
      {
        ...baseDeps,
        prisma,
        port,
        fetchAsset: async (key: string) => {
          if (key.endsWith('paperback/cover.pdf')) return null; // 未生成 → その場で組む
          if (key.startsWith('covers/')) return png;
          return pdf;
        },
      },
    );

    expect(res).toMatchObject({ ok: true, status: 'drafted', titleId: 'ABC123', pages: 120 });
    expect(calls).toHaveLength(1);
    // 本棚の検索は ASIN ではなく**タイトル**で行うので、タイトルを渡していること。
    expect(calls[0]).toMatchObject({ asin: 'B0TEST0001', title: 'テスト本' });
    expect(updates.at(-1)).toMatchObject({ pb_publish_status: 'drafted', pb_title_id: 'ABC123' });
  });

  it('ノド余白 NG なら port を呼ばず長いクールダウンを置く', async () => {
    const { prisma, updates } = buildPrisma();
    const { port, calls } = makePort({ ok: true, titleId: 'X', isbn: null });
    const pdf = await makePdf(400);
    const now = new Date('2026-09-29T00:00:00Z');

    const res = await runPaperbackDraft(
      { book_id: 'b1' },
      { ...baseDeps, prisma, port, now: () => now, fetchAsset: async () => pdf },
    );

    expect(res).toMatchObject({ ok: false, status: 'plan_ng' });
    expect(calls).toHaveLength(0);
    const cooldown = updates.at(-1)?.pb_submit_cooldown_until as Date;
    expect(cooldown.getTime() - now.getTime()).toBe(PLAN_NG_COOLDOWN_HOURS * 3600_000);
  });

  it('作成数上限なら 20 時間のクールダウン', async () => {
    const { prisma, updates } = buildPrisma();
    const { port } = makePort({ ok: false, reason: 'creation_limit', message: '上限' });
    const pdf = await makePdf(120);
    const now = new Date('2026-09-29T00:00:00Z');

    const res = await runPaperbackDraft(
      { book_id: 'b1' },
      { ...baseDeps, prisma, port, now: () => now, fetchAsset: async (k: string) => (k.endsWith('cover.pdf') ? Buffer.from('pdf') : pdf) },
    );

    expect(res).toMatchObject({ ok: false, status: 'creation_limit' });
    const cooldown = updates.at(-1)?.pb_submit_cooldown_until as Date;
    expect(cooldown.getTime() - now.getTime()).toBe(CREATION_LIMIT_COOLDOWN_HOURS * 3600_000);
  });

  it('ASIN が無ければ対象外', async () => {
    const { prisma } = buildPrisma({ asin: null });
    const { port, calls } = makePort({ ok: true, titleId: 'X', isbn: null });
    const res = await runPaperbackDraft({ book_id: 'b1' }, { ...baseDeps, prisma, port, fetchAsset: async () => null });
    expect(res).toMatchObject({ ok: false, status: 'no_asin' });
    expect(calls).toHaveLength(0);
  });

  it('既に下書き済みなら何もしない', async () => {
    const { prisma } = buildPrisma({ pb_publish_status: 'drafted', pb_title_id: 'OLD' });
    const { port, calls } = makePort({ ok: true, titleId: 'X', isbn: null });
    const res = await runPaperbackDraft({ book_id: 'b1' }, { ...baseDeps, prisma, port, fetchAsset: async () => null });
    expect(res).toMatchObject({ ok: true, status: 'already_drafted' });
    expect(calls).toHaveLength(0);
  });

  it('採用済み表紙が無ければ対象外', async () => {
    const { prisma } = buildPrisma({}, { cover: false });
    const { port, calls } = makePort({ ok: true, titleId: 'X', isbn: null });
    const res = await runPaperbackDraft({ book_id: 'b1' }, { ...baseDeps, prisma, port, fetchAsset: async () => null });
    expect(res).toMatchObject({ ok: false, status: 'no_cover' });
    expect(calls).toHaveLength(0);
  });
});

describe('paperback.draft.dispatch', () => {
  function dispatcherPrisma(rows: Array<{ id: string; title: string }>) {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = {
      book: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          seen.push(args.where);
          return rows;
        },
      },
    } as unknown as PaperbackDraftDispatcherPrisma;
    return { prisma, seen };
  }

  it('下書き未作成の本を 1 冊だけ投入する', async () => {
    const { prisma, seen } = dispatcherPrisma([{ id: 'b1', title: '本' }]);
    const addJob = vi.fn(async () => ({}));
    const res = await runPaperbackDraftDispatcher({
      prisma,
      addJob: addJob as never,
      logger: makeLogger(),
      hasCreds: true,
    });
    expect(res).toMatchObject({ enabled: true, enqueued: 1, bookId: 'b1' });
    expect(addJob).toHaveBeenCalledTimes(1);
    // 取り下げ済みの本は本棚に「ペーパーバックの作成」が出ないので対象から外す。
    expect(seen[0]).toMatchObject({ pb_publish_status: 'unlisted', pb_title_id: null, publish_status: 'published' });
  });

  it('対象が無ければ投入しない', async () => {
    const { prisma } = dispatcherPrisma([]);
    const addJob = vi.fn(async () => ({}));
    const res = await runPaperbackDraftDispatcher({
      prisma,
      addJob: addJob as never,
      logger: makeLogger(),
      hasCreds: true,
    });
    expect(res.enqueued).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('認証情報が無ければ無効', async () => {
    const { prisma } = dispatcherPrisma([{ id: 'b1', title: '本' }]);
    const addJob = vi.fn(async () => ({}));
    const res = await runPaperbackDraftDispatcher({
      prisma,
      addJob: addJob as never,
      logger: makeLogger(),
      hasCreds: false,
    });
    expect(res).toMatchObject({ enabled: false, enqueued: 0 });
    expect(addJob).not.toHaveBeenCalled();
  });
});
