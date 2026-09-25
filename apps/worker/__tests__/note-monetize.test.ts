import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import { computePaywallSplit, toAnchorText } from '../src/tasks/note-publish/paywall-split.js';
import type {
  NoteMonetizeArgs,
  NoteMonetizeResult,
  NotePublishPort,
} from '../src/tasks/note-publish/playwright-note-publish-port.js';
import {
  PIPELINE_NOTE_MONETIZE_TASK_NAME,
  readFreeRatio,
  resolveMonetizePrice,
  runPipelineNoteMonetize,
  type PipelineNoteMonetizePrisma,
} from '../src/tasks/pipeline-note-monetize.js';

const LF = String.fromCharCode(10);
const PARA_SEP = LF + LF;

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

const BODY = [
  '# 導入',
  'この記事では実際の記録を出します。',
  '## 無料パート',
  '最初の3日でやったことを並べます。',
  'ここまでが前提です。',
  '## 有料パート',
  '実際に使った文面をそのまま出します。',
  'テンプレは4種類あります。',
  'まとめです。',
].join('\n\n');

interface ArticleState {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  price_jpy: number | null;
  paywall_line_pos: number | null;
  note_url: string | null;
  status: string;
  publish_status: string;
}

function buildPrisma(
  overrides: Partial<ArticleState> = {},
  accountOverrides: Record<string, unknown> = {},
  dryRunGlobal = false,
) {
  const article: ArticleState = {
    id: 'a1',
    note_account_id: 'acc1',
    title: '記録',
    body_md: BODY,
    paid: false,
    price_jpy: 480,
    paywall_line_pos: null,
    note_url: 'https://note.com/kaito/n/n1234abcd',
    status: 'published',
    publish_status: 'published',
    ...overrides,
  };
  const articleUpdates: Array<Record<string, unknown>> = [];
  const jobUpdates: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    appSettings: { findUnique: async () => ({ anp_publish_dry_run: dryRunGlobal }) },
    job: {
      findUnique: async () => ({ status: 'queued' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args: { data: Record<string, unknown> }) => {
        jobUpdates.push(args.data);
        return {};
      },
    },
    noteArticle: {
      findUnique: async () => article,
      update: async (args: { data: Record<string, unknown> }) => {
        articleUpdates.push(args.data);
        return {};
      },
    },
    noteAccount: {
      findUnique: async () => ({
        id: 'acc1',
        display_name: 'AI副業',
        session_state_enc: 'enc',
        monetization_policy_json: { free_ratio: 0.3, price_band: [300, 1000] },
        settings_json: { paid_publish_enabled: true },
        ...accountOverrides,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return {};
      },
    },
    noteAuthRequest: { findFirst: async () => null, create: async () => ({ id: 'r1' }) },
  } as unknown as PipelineNoteMonetizePrisma;
  return { prisma, articleUpdates, jobUpdates, accountUpdates };
}

function makePort(result: NoteMonetizeResult): { port: NotePublishPort; calls: NoteMonetizeArgs[] } {
  const calls: NoteMonetizeArgs[] = [];
  return {
    calls,
    port: {
      publishOne: async () => {
        throw new Error('publishOne should not be called');
      },
      checkPublished: async () => {
        throw new Error('checkPublished should not be called');
      },
      monetizeOne: async (args: NoteMonetizeArgs) => {
        calls.push(args);
        return result;
      },
    },
  };
}

const BASE_DEPS = {
  logger: makeLogger(),
  acquireLock: async () => ({}) as never,
  releaseLock: async () => ({}) as never,
  decryptSession: () => 'session',
  notify: async () => true,
  now: () => new Date('2026-09-25T00:00:00.000Z'),
};

describe('computePaywallSplit (F-ANP-47)', () => {
  it('free_ratio の位置に近いブロック境界で切り、無料側にも有料側にも中身を残す', () => {
    const split = computePaywallSplit(BODY, 0.3);
    expect(split).not.toBeNull();
    expect(split!.freeBlockCount).toBeGreaterThanOrEqual(1);
    expect(split!.pos).toBeGreaterThan(0);
    expect(split!.pos).toBeLessThan(split!.totalChars);
    // 無料側はおおむね 3 割 (ブロック境界に丸めるのでぴったりではない)。
    expect(split!.freeChars / split!.totalChars).toBeGreaterThan(0.1);
    expect(split!.freeChars / split!.totalChars).toBeLessThan(0.6);
  });

  it('見出しがあるときは必ず見出しの直前で切り、その見出し文をアンカーにする', () => {
    const split = computePaywallSplit(BODY, 0.3)!;
    expect(split.anchorIsHeading).toBe(true);
    // `#` は落とし、エディタ上の表示テキストと突き合わせられる形にする。
    expect(split.anchorText.startsWith('#')).toBe(false);
    expect(['無料パート', '有料パート']).toContain(split.anchorText);
  });

  it('見出しが無い本文では段落境界を使う', () => {
    const noHeadings = ['一段落目です。', '二段落目です。', '三段落目です。'].join(PARA_SEP);
    const split = computePaywallSplit(noHeadings, 0.4)!;
    expect(split.anchorIsHeading).toBe(false);
    expect(split.anchorText.length).toBeGreaterThan(0);
  });

  it('ブロックが 1 つしかない本文では引けない (null)', () => {
    expect(computePaywallSplit('一段落しかない本文です。', 0.3)).toBeNull();
    expect(computePaywallSplit('', 0.3)).toBeNull();
  });

  it('free_ratio が大きいほど無料側が長くなる', () => {
    const low = computePaywallSplit(BODY, 0.2)!;
    const high = computePaywallSplit(BODY, 0.8)!;
    expect(high.pos).toBeGreaterThan(low.pos);
  });
});

describe('toAnchorText', () => {
  it('見出し記号・箇条書き記号を落として 40 字までに切る', () => {
    expect(toAnchorText(`## 有料パート${LF}本文`)).toBe('有料パート');
    expect(toAnchorText('- 箇条書き')).toBe('箇条書き');
    expect(toAnchorText('あ'.repeat(60)).length).toBe(40);
  });
});

describe('resolveMonetizePrice / readFreeRatio', () => {
  it('指定 → 記事の提案価格 → 価格帯下限 → 既定 500 の順で決まり 10 円単位に丸まる', () => {
    expect(resolveMonetizePrice(777, 480, { price_band: [300, 1000] })).toBe(780);
    expect(resolveMonetizePrice(null, 480, { price_band: [300, 1000] })).toBe(480);
    expect(resolveMonetizePrice(null, null, { price_band: [300, 1000] })).toBe(300);
    expect(resolveMonetizePrice(null, null, null)).toBe(500);
  });

  it('note の下限 100 円を下回らない', () => {
    expect(resolveMonetizePrice(null, 150, null)).toBe(150);
    expect(resolveMonetizePrice(null, 10, null)).toBe(100);
  });

  it('提案価格が 0 の記事 (judge が値を落とした) は未設定扱いにして次の候補を使う', () => {
    expect(resolveMonetizePrice(null, 0, { price_band: [380, 1200] })).toBe(380);
    expect(resolveMonetizePrice(null, 0, null)).toBe(500);
  });

  it('free_ratio は 0<x<1 の数値のみ採用し、それ以外は既定 0.3', () => {
    expect(readFreeRatio({ free_ratio: 0.5 })).toBe(0.5);
    expect(readFreeRatio({ free_ratio: 0 })).toBe(0.3);
    expect(readFreeRatio({ free_ratio: 'x' })).toBe(0.3);
    expect(readFreeRatio(null)).toBe(0.3);
  });
});

describe('pipeline.note.monetize', () => {
  it('タスク名が docs/05 と一致する', () => {
    expect(PIPELINE_NOTE_MONETIZE_TASK_NAME).toBe('pipeline.note.monetize');
  });

  it('有料化できたら paid/price/paywall_line_pos を保存する', async () => {
    const { prisma, articleUpdates, jobUpdates } = buildPrisma();
    const { port, calls } = makePort({ ok: true, status: 'monetized', noteUrl: 'https://note.com/kaito/n/n1234abcd' });

    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );

    expect(res).toMatchObject({ ok: true, status: 'monetized', priceJpy: 480 });
    expect(articleUpdates[0]).toMatchObject({ paid: true, price_jpy: 480 });
    expect(articleUpdates[0]!.paywall_line_pos).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ dryRun: false, priceJpy: 480 });
    expect(calls[0]!.freeBlockCount).toBeGreaterThanOrEqual(1);
    // note エディタ上で位置を特定するためのアンカー (見出し文) が渡る。
    expect(calls[0]!.anchorText).toBeTruthy();
    expect(jobUpdates.at(-1)).toMatchObject({ status: 'done' });
  });

  it('paid_publish_enabled が OFF なら実更新要求でも強制ドライラン (記事は無料のまま)', async () => {
    const { prisma, articleUpdates } = buildPrisma({}, { settings_json: { paid_publish_enabled: false } });
    const { port, calls } = makePort({ ok: true, status: 'dry_run_ready', noteUrl: 'https://note.com/kaito/n/n1234abcd' });

    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );

    expect(calls[0]!.dryRun).toBe(true);
    expect(res.status).toBe('dry_run_ready');
    expect(articleUpdates).toHaveLength(0);
  });

  it('グローバルのドライラン設定が ON の間も強制ドライラン', async () => {
    const { prisma } = buildPrisma({}, {}, true);
    const { port, calls } = makePort({ ok: true, status: 'dry_run_ready', noteUrl: 'u' });
    await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );
    expect(calls[0]!.dryRun).toBe(true);
  });

  it('公開済みでない記事はスキップ (note 側に記事が無い)', async () => {
    const { prisma } = buildPrisma({ status: 'ready', note_url: null });
    const { port, calls } = makePort({ ok: true, status: 'monetized', noteUrl: 'u' });
    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );
    expect(res).toMatchObject({ ok: false, status: 'not_published' });
    expect(calls).toHaveLength(0);
  });

  it('すでに有料の記事は二重処理しない', async () => {
    const { prisma } = buildPrisma({ paid: true });
    const { port, calls } = makePort({ ok: true, status: 'monetized', noteUrl: 'u' });
    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );
    expect(res).toMatchObject({ ok: true, status: 'already_paid' });
    expect(calls).toHaveLength(0);
  });

  it('本文が短すぎて有料ラインを引けないならスキップ', async () => {
    const { prisma } = buildPrisma({ body_md: '一段落だけ。' });
    const { port, calls } = makePort({ ok: true, status: 'monetized', noteUrl: 'u' });
    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );
    expect(res).toMatchObject({ ok: false, status: 'no_paywall_slot' });
    expect(calls).toHaveLength(0);
  });

  it('KYC 未完了は記事を無料のまま残し、理由を Job に記録して通知する', async () => {
    const { prisma, articleUpdates, jobUpdates } = buildPrisma();
    const { port } = makePort({ ok: false, reason: 'kyc_required', message: '本人情報の登録が必要' });
    const notified: string[] = [];

    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      {
        prisma,
        publishPort: port,
        ...BASE_DEPS,
        notify: async (t: string) => {
          notified.push(t);
          return true;
        },
      },
    );

    expect(res).toMatchObject({ ok: false, status: 'kyc_required' });
    expect(articleUpdates).toHaveLength(0);
    expect(String(jobUpdates.at(-1)!.error)).toContain('本人情報');
    expect(notified.join('')).toContain('本人情報');
  });

  it('セッション失効ならアカウントを paused にする', async () => {
    const { prisma, accountUpdates } = buildPrisma();
    const { port } = makePort({ ok: false, reason: 'not_logged_in', message: 'セッション失効' });
    const res = await runPipelineNoteMonetize(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { prisma, publishPort: port, ...BASE_DEPS },
    );
    expect(res).toMatchObject({ ok: false, status: 'not_logged_in' });
    expect(accountUpdates[0]).toMatchObject({ status: 'paused' });
  });

  it('dry_run 省略時は安全側 (ドライラン)', async () => {
    const { prisma } = buildPrisma();
    const { port, calls } = makePort({ ok: true, status: 'dry_run_ready', noteUrl: 'u' });
    await runPipelineNoteMonetize({ note_article_id: 'a1', job_id: 'j1' }, { prisma, publishPort: port, ...BASE_DEPS });
    expect(calls[0]!.dryRun).toBe(true);
  });
});
