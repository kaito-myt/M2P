import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import { paperbackPrice, printCost, royalty } from '../src/tasks/paperback-submit/paperback-price.js';
import {
  COVER_SIZE_ERROR,
  isRealPreviewError,
} from '../src/tasks/paperback-submit/playwright-paperback-port.js';
import type {
  PaperbackPublishPort,
  PaperbackPublishResult,
} from '../src/tasks/paperback-submit/playwright-paperback-port.js';
import { PAPERBACK_SUBMIT_TASK_NAME, runPaperbackSubmit } from '../src/tasks/paperback-submit.js';
import { runPaperbackSubmitDispatcher } from '../src/tasks/paperback-submit-dispatcher.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

interface BookRow {
  id: string;
  title: string;
  pb_title_id: string | null;
  pb_publish_status: string;
}

function buildPrisma(book: BookRow | null, hasSession = true) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    book: {
      findUnique: async () => book,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return {};
      },
    },
    account: {
      findFirst: async () => ({ id: 'acc1', kdp_session_state_enc: hasSession ? 'enc' : null }),
    },
  } as unknown as NonNullable<Parameters<typeof runPaperbackSubmit>[1]>['prisma'];
  return { prisma, updates };
}

function makePort(result: PaperbackPublishResult): { port: PaperbackPublishPort; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    port: {
      async publishDraft(args) {
        calls.push(args);
        return result;
      },
    },
  };
}

const BOOK: BookRow = { id: 'b1', title: '本', pb_title_id: 'ABC12345678', pb_publish_status: 'drafted' };
const ENV = { AMAZON_PASSWORD: 'pw', AMAZON_TOTP_SECRET: 'sec' } as NodeJS.ProcessEnv;

describe('paperback 定価計算', () => {
  it('薄い本は基準価格 ¥980、厚い本は手取り ¥150 を確保できる価格まで上がる', () => {
    expect(paperbackPrice(100)).toBe(980);
    const thick = paperbackPrice(400);
    expect(thick).toBeGreaterThan(980);
    expect(royalty(400, thick)).toBeGreaterThanOrEqual(150);
    expect(thick % 10).toBe(0);
  });

  it('印刷コストは固定 206 円 + 頁数 × 2.06 円', () => {
    expect(printCost(100)).toBeCloseTo(206 + 206, 5);
  });
});

describe('paperback.submit (F-097d)', () => {
  it('出版できたら submitted にしてキューから降ろす', async () => {
    const { prisma, updates } = buildPrisma(BOOK);
    const { port, calls } = makePort({ ok: true, status: 'submitted', pages: 145, priceJpy: 1090 });

    const res = await runPaperbackSubmit(
      { book_id: 'b1' },
      { prisma, port, logger: makeLogger(), decryptSession: () => 'session', env: ENV },
    );

    expect(res).toMatchObject({ ok: true, status: 'submitted' });
    expect(updates[0]).toMatchObject({ pb_publish_status: 'submitted', pb_publish_queued: false });
    expect(calls[0]).toMatchObject({ titleId: 'ABC12345678', dryRun: false });
  });

  it('pb_title_id が無ければ何もしない (下書きがまだ無い本)', async () => {
    const { prisma, updates } = buildPrisma({ ...BOOK, pb_title_id: null });
    const { port } = makePort({ ok: true, status: 'submitted', pages: null, priceJpy: null });

    const res = await runPaperbackSubmit(
      { book_id: 'b1' },
      { prisma, port, logger: makeLogger(), decryptSession: () => 'session', env: ENV },
    );

    expect(res.status).toBe('no_title_id');
    expect(updates).toHaveLength(0);
  });

  it('AMAZON_PASSWORD が無ければ再認証できないので skip', async () => {
    const { prisma } = buildPrisma(BOOK);
    const { port } = makePort({ ok: true, status: 'submitted', pages: null, priceJpy: null });
    const res = await runPaperbackSubmit(
      { book_id: 'b1' },
      { prisma, port, logger: makeLogger(), decryptSession: () => 'session', env: {} as NodeJS.ProcessEnv },
    );
    expect(res.status).toBe('no_creds');
  });

  it('失敗は理由ごとのクールダウンを置いて記録する', async () => {
    const { prisma, updates } = buildPrisma(BOOK);
    const { port } = makePort({ ok: false, reason: 'blocked_prior_page', message: '以前のページに問題' });
    const now = new Date('2026-09-25T00:00:00.000Z');

    const res = await runPaperbackSubmit(
      { book_id: 'b1' },
      { prisma, port, logger: makeLogger(), decryptSession: () => 'session', env: ENV, now: () => now },
    );

    expect(res).toMatchObject({ ok: false, status: 'blocked_prior_page' });
    const data = updates[0]!;
    expect(String(data.pb_last_error)).toContain('blocked_prior_page');
    expect((data.pb_submit_cooldown_until as Date).getTime()).toBe(now.getTime() + 6 * 60 * 60 * 1000);
    // 失敗しても status は drafted のまま (再試行できる)。
    expect(data).not.toHaveProperty('pb_publish_status');
  });

  it('セッション未保存なら skip', async () => {
    const { prisma } = buildPrisma(BOOK, false);
    const { port } = makePort({ ok: true, status: 'submitted', pages: null, priceJpy: null });
    const res = await runPaperbackSubmit(
      { book_id: 'b1' },
      { prisma, port, logger: makeLogger(), decryptSession: () => 'session', env: ENV },
    );
    expect(res.status).toBe('no_session');
  });

  it('タスク名が docs/05 と一致する', () => {
    expect(PAPERBACK_SUBMIT_TASK_NAME).toBe('paperback.submit');
  });
});

describe('paperback.submit.dispatch', () => {
  it('下書き済みの本を 1 冊だけ投入する', async () => {
    const enqueued: Array<{ task: string; payload: unknown }> = [];
    const prisma = {
      book: {
        findMany: async (args: { take: number }) => {
          expect(args.take).toBe(1);
          return [{ id: 'b1', title: '本' }];
        },
      },
    } as unknown as NonNullable<Parameters<typeof runPaperbackSubmitDispatcher>[0]>['prisma'];

    const res = await runPaperbackSubmitDispatcher({
      prisma,
      logger: makeLogger(),
      env: ENV,
      addJob: async (task: string, payload: unknown) => {
        enqueued.push({ task, payload });
      },
    });

    expect(res).toMatchObject({ enabled: true, enqueued: 1, bookId: 'b1' });
    expect(enqueued[0]).toMatchObject({ task: 'paperback.submit', payload: { book_id: 'b1' } });
  });

  it('資格情報が無ければ何も投入しない', async () => {
    const res = await runPaperbackSubmitDispatcher({
      prisma: { book: { findMany: async () => [] } } as never,
      logger: makeLogger(),
      env: {} as NodeJS.ProcessEnv,
      addJob: async () => {
        throw new Error('should not enqueue');
      },
    });
    expect(res).toMatchObject({ enabled: false, enqueued: 0 });
  });
});

describe('プレビューの文言分類 (F-097k)', () => {
  // 画面から広く文言を集めるようにしたら、成功通知「表紙 "x.pdf" が正常にアップロード
  // されました。」まで拾ってしまい、/表紙/ だけで判定していた表紙差し替えが
  // **エラーが 1 つも無いのに毎回発火**した (2026-10-02 実測)。
  it('成功通知や案内文はエラーとして扱わない', () => {
    const info = [
      '表紙 "cmq-pb-cover-191p.pdf" が正常にアップロードされました。',
      '原稿 "cmq-interior.pdf" を正常にアップロードしました',
      'コンテンツ ページのデザインが新しくなりました',
      '無料の KDP ISBN が割り当てられました:',
      '選択された本文、用紙タイプ、判型の本では、外部流通機能を利用できません。',
      '新しい原稿または表紙画像をアップロードされたようです。',
      '原稿、表紙、印刷オプションを更新しました。',
    ];
    for (const t of info) expect(isRealPreviewError(t), t).toBe(false);
    for (const t of info) expect(COVER_SIZE_ERROR.test(t), t).toBe(false);
  });

  it('本物のエラーはエラーとして扱う', () => {
    const errs = [
      '内側マージンが不十分です。',
      'ページの上下には 6.35 mm (0.25 インチ) 以上の外側マージンが必要です。',
      'エラーのある本は、Amazon の品質基準を満たしません。',
      '適切な表紙のサイズは 12.000x8.520 ですが、提出されたファイル サイズは 8.264x11.694 です。',
    ];
    for (const t of errs) expect(isRealPreviewError(t), t).toBe(true);
    expect(errs.some((e) => /マージン/.test(e))).toBe(true);
    expect(errs.filter((e) => COVER_SIZE_ERROR.test(e))).toHaveLength(1);
  });
});
