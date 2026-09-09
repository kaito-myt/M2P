import { describe, expect, it, vi } from 'vitest';

import {
  runPromotionMetricsFetch,
  extractTweetId,
  type PromotionMetricsFetchPrisma,
  type PromotionMetricsFetchDeps,
} from '../src/tasks/promotion-metrics-fetch.js';

const silentLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn(),
} as unknown as PromotionMetricsFetchDeps['logger'];

const NOW = new Date('2026-08-10T00:00:00Z');

function harness(opts: {
  token?: string | null;
  posts?: Array<{ id: string; external_url: string | null }>;
  fetchImpl?: PromotionMetricsFetchDeps['doFetch'];
}) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    promotionChannelSetting: {
      findUnique: vi.fn(async () => (opts.token === undefined ? { token_enc: 'enc' } : { token_enc: opts.token })),
    },
    promotionPost: {
      findMany: vi.fn(async () => opts.posts ?? []),
      update: vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: a.where.id, data: a.data });
        return {};
      }),
    },
  } as unknown as PromotionMetricsFetchPrisma;
  const deps: PromotionMetricsFetchDeps = {
    prisma,
    logger: silentLogger,
    now: () => NOW,
    decryptToken: () => '{"kind":"oauth1","apiKey":"k","apiSecret":"s","accessToken":"t","accessTokenSecret":"ts"}',
    doFetch: opts.fetchImpl,
  };
  return { deps, updates };
}

describe('extractTweetId', () => {
  it('status/<id> から数値IDを抽出', () => {
    expect(extractTweetId('https://x.com/goodbooks_intro/status/2086392197067558923')).toBe('2086392197067558923');
  });
  it('URLなし/不一致は null', () => {
    expect(extractTweetId(null)).toBeNull();
    expect(extractTweetId('https://note.com/abc')).toBeNull();
  });
});

describe('runPromotionMetricsFetch', () => {
  it('token 未設定なら skip', async () => {
    const { deps } = harness({ token: null });
    const res = await runPromotionMetricsFetch({}, deps);
    expect(res.skipped_reason).toBe('x_token_missing');
    expect(res.updated).toBe(0);
  });

  it('public_metrics を取得して行を更新する', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: '2086392197067558111', public_metrics: { impression_count: 1200, like_count: 8, retweet_count: 2, reply_count: 1 } },
        ],
      }),
      text: async () => '',
    }));
    const { deps, updates } = harness({
      posts: [{ id: 'post-a', external_url: 'https://x.com/h/status/2086392197067558111' }],
      fetchImpl,
    });
    const res = await runPromotionMetricsFetch({}, deps);
    expect(res.scanned).toBe(1);
    expect(res.updated).toBe(1);
    expect(updates[0]!.id).toBe('post-a');
    expect(updates[0]!.data.impressions).toBe(1200);
    expect(updates[0]!.data.likes).toBe(8);
    expect(updates[0]!.data.reposts).toBe(2);
    expect(updates[0]!.data.metrics_fetched_at).toEqual(NOW);
  });

  it('X API が非OK(読み取り不可プラン等)なら skip_reason を記録し更新しない', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 403, json: async () => ({}), text: async () => 'Forbidden',
    }));
    const { deps, updates } = harness({
      posts: [{ id: 'post-a', external_url: 'https://x.com/h/status/2086392197067558111' }],
      fetchImpl,
    });
    const res = await runPromotionMetricsFetch({}, deps);
    expect(res.skipped_reason).toBe('x_api_403');
    expect(updates).toHaveLength(0);
  });
});
