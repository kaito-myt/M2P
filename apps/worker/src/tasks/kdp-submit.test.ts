import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { encryptKdpCredentials } from '@a2p/crypto';

import { runKdpSubmit, type KdpSubmitDeps } from './kdp-submit.js';
import type { KdpPublishPort, KdpPublishResult } from './kdp-submit/playwright-publish-port.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'book1',
    title: 'テスト本',
    subtitle: null,
    account_id: 'acc1',
    pen_name: '著者',
    description: '説明',
    categories: [],
    keywords: ['k1'],
    price_jpy: 680,
    title_kana: null,
    title_romaji: null,
    subtitle_kana: null,
    subtitle_romaji: null,
    author_kana: null,
    author_romaji: null,
    kdp_session_state_enc: encryptKdpCredentials(JSON.stringify({ cookies: [], origins: [] })),
    kdp_2fa_secret_enc: null,
    cover_key: 'covers/book1.jpg',
    docx_key: 'artifacts/book1.docx',
    ...overrides,
  };
}

function makePrisma(row: Record<string, unknown> | null) {
  const bookUpdate = vi.fn().mockResolvedValue({});
  const accountUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    $queryRawUnsafe: vi.fn().mockResolvedValue(row ? [row] : []),
    book: { update: bookUpdate },
    account: { update: accountUpdate },
    appSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as KdpSubmitDeps['prisma'];
  return { prisma, bookUpdate, accountUpdate };
}

function portReturning(result: KdpPublishResult): KdpPublishPort {
  return { publishOne: vi.fn().mockResolvedValue(result) };
}

describe('runKdpSubmit', () => {
  beforeEach(() => {
    process.env.KDP_CRED_KEY = TEST_KEY;
    process.env.AMAZON_EMAIL = 'a@b.co';
    process.env.AMAZON_PASSWORD = 'pw';
  });
  afterEach(() => {
    delete process.env.AMAZON_EMAIL;
    delete process.env.AMAZON_PASSWORD;
    vi.restoreAllMocks();
  });

  it('AMAZON creds 未設定なら no_creds で即 return', async () => {
    delete process.env.AMAZON_EMAIL;
    const { prisma } = makePrisma(baseRow());
    const r = await runKdpSubmit({
      payload: { book_id: 'book1' },
      publishPort: portReturning({ ok: true, status: 'submitted', asin: null, storageState: '{}' }),
      prisma,
      proxy: null,
      fetchAsset: async () => Buffer.from('x'),
    });
    expect(r.status).toBe('no_creds');
  });

  it('資産(docx/cover)が無ければ skip_no_assets', async () => {
    const { prisma } = makePrisma(baseRow({ docx_key: null }));
    const r = await runKdpSubmit({
      payload: { book_id: 'book1' },
      publishPort: portReturning({ ok: true, status: 'submitted', asin: null, storageState: '{}' }),
      prisma,
      proxy: null,
      fetchAsset: async () => Buffer.from('x'),
    });
    expect(r.status).toBe('skip_no_assets');
  });

  it('成功時: books を submitted + asin に更新しセッション書き戻し', async () => {
    const { prisma, bookUpdate, accountUpdate } = makePrisma(baseRow());
    const port = portReturning({ ok: true, status: 'submitted', asin: 'B0ABCDE123', storageState: '{"cookies":[]}' });
    const r = await runKdpSubmit({
      payload: { book_id: 'book1' },
      publishPort: port,
      prisma,
      proxy: null,
      fetchAsset: async () => Buffer.from('x'),
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe('submitted');
    expect(r.asin).toBe('B0ABCDE123');
    expect(bookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'book1' },
        data: expect.objectContaining({ publish_status: 'submitted', kdp_publish_queued: false, asin: 'B0ABCDE123' }),
      }),
    );
    expect(accountUpdate).toHaveBeenCalled(); // storageState 書き戻し
  });

  it('dry_run 成功時は books を更新しない', async () => {
    const { prisma, bookUpdate } = makePrisma(baseRow());
    const r = await runKdpSubmit({
      payload: { book_id: 'book1', dry_run: true },
      publishPort: portReturning({ ok: true, status: 'dry_run_ready', asin: null, storageState: '{}' }),
      prisma,
      proxy: null,
      fetchAsset: async () => Buffer.from('x'),
    });
    expect(r.status).toBe('dry_run_ready');
    expect(bookUpdate).not.toHaveBeenCalled();
  });

  it('creation_limit 失敗時は books 更新せず reason を返す', async () => {
    const { prisma, bookUpdate } = makePrisma(baseRow());
    const r = await runKdpSubmit({
      payload: { book_id: 'book1' },
      publishPort: portReturning({ ok: false, reason: 'creation_limit', message: 'limit' }),
      prisma,
      proxy: null,
      fetchAsset: async () => Buffer.from('x'),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('creation_limit');
    expect(bookUpdate).not.toHaveBeenCalled();
  });
});
