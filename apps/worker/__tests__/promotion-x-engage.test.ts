import { describe, expect, it, vi } from 'vitest';

import {
  dailyCap,
  pickCandidates,
  runPromotionXEngage,
  type PromotionXEngagePrisma,
} from '../src/tasks/promotion-x-engage.js';

describe('dailyCap (ランプアップ)', () => {
  it('日数に応じて段階的に上限が上がる', () => {
    expect(dailyCap(0)).toBe(8);
    expect(dailyCap(1)).toBe(8);
    expect(dailyCap(3)).toBe(15);
    expect(dailyCap(7)).toBe(22);
    expect(dailyCap(20)).toBe(30);
  });
});

describe('pickCandidates', () => {
  const users = new Map([
    ['a1', { username: 'reader_a', followers: 1200 }],
    ['big', { username: 'huge', followers: 500000 }],
    ['me', { username: 'me', followers: 2 }],
  ]);
  it('自分/大手/エンゲージ済みを除外し1著者1件', () => {
    const tweets = [
      { id: 't1', author_id: 'a1' },
      { id: 't2', author_id: 'a1' }, // 同著者 → 1件のみ
      { id: 't3', author_id: 'big' }, // 大手 → 除外
      { id: 't4', author_id: 'me' }, // 自分 → 除外
    ];
    const cands = pickCandidates(tweets, users, 'me', new Set());
    expect(cands).toHaveLength(1);
    expect(cands[0]!.authorHandle).toBe('reader_a');
  });
  it('follow済み+like済みの著者は除外', () => {
    const tweets = [{ id: 't1', author_id: 'a1' }];
    const cands = pickCandidates(tweets, users, 'me', new Set(['follow:a1', 'like:t1']));
    expect(cands).toHaveLength(0);
  });
});

function makePrisma(opts: { enabled: boolean; engaged?: Array<{ action_type: string; target_id: string }>; today?: number; onCreate?: (d: Record<string, unknown>) => void }): PromotionXEngagePrisma {
  return {
    appSettings: { findUnique: vi.fn(async () => ({ x_engage_enabled: opts.enabled })) },
    promotionChannelSetting: { findUnique: vi.fn(async () => ({ token_enc: 'enc' })) },
    promotionXEngagement: {
      findMany: vi.fn(async (args: { select?: { created_at?: boolean } }) =>
        args?.select && 'created_at' in args.select ? [] : (opts.engaged ?? []),
      ),
      count: vi.fn(async () => opts.today ?? 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { opts.onCreate?.(data); return {}; }),
    },
  } as unknown as PromotionXEngagePrisma;
}

function makeFetch() {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/2/users/me')) return okJson({ data: { id: 'me' } });
    if (url.includes('/2/tweets/search/recent')) return okJson({ data: [{ id: 't1', author_id: 'a1' }], includes: { users: [{ id: 'a1', username: 'reader_a', public_metrics: { followers_count: 1000 } }] } });
    if (method === 'POST' && url.includes('/likes')) return okJson({ data: { liked: true } });
    if (method === 'POST' && url.includes('/following')) return okJson({ data: { following: true } });
    return okJson({});
  });
}
function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('runPromotionXEngage', () => {
  it('x_engage_enabled=false なら何もしない', async () => {
    const res = await runPromotionXEngage({}, { prisma: makePrisma({ enabled: false }), doFetch: makeFetch() as never, decryptToken: () => 'tok', sleep: async () => {}, lineConfigured: () => false });
    expect(res.skipped_reason).toBe('disabled');
    expect(res.followed).toBe(0);
  });

  it('有効時: 検索→いいね＋フォローを実行し記録する', async () => {
    const created: Record<string, unknown>[] = [];
    // decrypt/parse をモックできないため creds は実 parse に通す必要 → token を OAuth1 JSON にする。
    const tokenJson = JSON.stringify({ kind: 'oauth1', apiKey: 'k', apiSecret: 's', accessToken: 'at', accessTokenSecret: 'ats' });
    const res = await runPromotionXEngage(
      { override_cap: 5 },
      { prisma: makePrisma({ enabled: true, onCreate: (d) => created.push(d) }), doFetch: makeFetch() as never, decryptToken: () => tokenJson, sleep: async () => {}, lineConfigured: () => false },
    );
    expect(res.liked).toBe(1);
    expect(res.followed).toBe(1);
    expect(created.filter((d) => d.action_type === 'like')).toHaveLength(1);
    expect(created.filter((d) => d.action_type === 'follow')).toHaveLength(1);
  });

  it('当日上限に達していれば実行しない', async () => {
    const tokenJson = JSON.stringify({ kind: 'oauth1', apiKey: 'k', apiSecret: 's', accessToken: 'at', accessTokenSecret: 'ats' });
    const res = await runPromotionXEngage(
      {},
      { prisma: makePrisma({ enabled: true, today: 30 }), doFetch: makeFetch() as never, decryptToken: () => tokenJson, sleep: async () => {}, lineConfigured: () => false },
    );
    expect(res.skipped_reason).toBe('cap_reached');
  });
});
