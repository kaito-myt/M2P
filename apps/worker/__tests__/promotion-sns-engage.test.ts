import { describe, expect, it, vi } from 'vitest';

import {
  dailyCap,
  pickFollowTargets,
} from '../src/tasks/promotion-sns-engage/engage-port.js';
import {
  runPromotionSnsEngage,
  type PromotionSnsEngagePrisma,
} from '../src/tasks/promotion-sns-engage.js';

describe('dailyCap (IG/TikTok ランプアップ・保守的)', () => {
  it('X より控えめに段階上昇する', () => {
    expect(dailyCap(0)).toBe(5);
    expect(dailyCap(1)).toBe(5);
    expect(dailyCap(3)).toBe(8);
    expect(dailyCap(7)).toBe(12);
    expect(dailyCap(20)).toBe(15);
  });
});

describe('pickFollowTargets', () => {
  const resolve = (a: { target_handle?: string; target_url?: string }) => a.target_url ?? '';
  it('follow のみ / URL 有 / 重複除外 / 上限まで', () => {
    const actions = [
      { action_type: 'follow', target_handle: '@a', target_url: 'https://www.instagram.com/a/' },
      { action_type: 'like', target_handle: '@b', target_url: 'https://www.instagram.com/b/' }, // like → 除外
      { action_type: 'follow', target_handle: '@a', target_url: 'https://www.instagram.com/a/' }, // 重複 → 除外
      { action_type: 'follow', target_handle: '@c', target_url: '' }, // URL無 → 除外
      { action_type: 'follow', target_handle: '@d', target_url: 'https://www.instagram.com/d/' },
    ];
    const targets = pickFollowTargets(actions, resolve, new Set(), 10);
    expect(targets.map((t) => t.handle)).toEqual(['@a', '@d']);
  });

  it('既フォロー済みは除外し、上限で切る', () => {
    const actions = [
      { action_type: 'follow', target_handle: '@a', target_url: 'https://x/a' },
      { action_type: 'follow', target_handle: '@b', target_url: 'https://x/b' },
      { action_type: 'follow', target_handle: '@c', target_url: 'https://x/c' },
    ];
    const targets = pickFollowTargets(actions, resolve, new Set(['follow:@a']), 1);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.handle).toBe('@b');
  });
});

function basePrisma(overrides: Partial<PromotionSnsEngagePrisma> = {}): PromotionSnsEngagePrisma {
  return {
    appSettings: { findUnique: vi.fn().mockResolvedValue({ sns_engage_enabled: true }) },
    promotionChannelSetting: {
      findUnique: vi.fn().mockResolvedValue({ auto_enabled: true, strategy_json: { concept: 'c' }, browser_session_enc: 'ENC' }),
    },
    promotionSnsEngagement: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as PromotionSnsEngagePrisma;
}

describe('runPromotionSnsEngage', () => {
  it('sns_engage_enabled=false なら何もしない', async () => {
    const prisma = basePrisma({ appSettings: { findUnique: vi.fn().mockResolvedValue({ sns_engage_enabled: false }) } });
    const port = { followAll: vi.fn() };
    const r = await runPromotionSnsEngage({}, { prisma, port, lineConfigured: () => false });
    expect(r.enabled).toBe(false);
    expect(port.followAll).not.toHaveBeenCalled();
  });

  it('セッション未取り込みのチャンネルはスキップ', async () => {
    const prisma = basePrisma({
      promotionChannelSetting: { findUnique: vi.fn().mockResolvedValue({ auto_enabled: true, strategy_json: {}, browser_session_enc: null }) },
    });
    const port = { followAll: vi.fn() };
    const r = await runPromotionSnsEngage({ channel: 'instagram' }, { prisma, port, lineConfigured: () => false });
    expect(r.skipped).toContain('instagram:no_session');
    expect(port.followAll).not.toHaveBeenCalled();
  });

  it('有効時: growth_scout の対象をフォローし記録する', async () => {
    const prisma = basePrisma();
    const port = {
      followAll: vi.fn().mockResolvedValue({
        outcomes: [
          { handle: '@a', url: 'https://www.instagram.com/a/', status: 'done' },
          { handle: '@b', url: 'https://www.instagram.com/b/', status: 'already' },
        ],
      }),
    };
    const generate = vi.fn().mockResolvedValue({
      summary: 's',
      actions: [
        { action_type: 'follow', platform: 'instagram', target_handle: 'a', target_url: 'https://www.instagram.com/a/' },
        { action_type: 'follow', platform: 'instagram', target_handle: 'b', target_url: 'https://www.instagram.com/b/' },
      ],
      search_hashtags: [],
      notes: [],
    });
    const r = await runPromotionSnsEngage(
      { channel: 'instagram' },
      { prisma, port, generate, decryptSession: () => '{"cookies":[]}', resolveProxy: async () => null, lineConfigured: () => false },
    );
    expect(port.followAll).toHaveBeenCalledOnce();
    expect(r.per_channel.instagram!.followed).toBe(1);
    expect(r.per_channel.instagram!.already).toBe(1);
    expect(prisma.promotionSnsEngagement.upsert).toHaveBeenCalledTimes(2);
  });

  it('アクションブロック時は blocked を記録し通知する', async () => {
    const prisma = basePrisma();
    const port = {
      followAll: vi.fn().mockResolvedValue({ outcomes: [], blocked: 'action_blocked' }),
    };
    const generate = vi.fn().mockResolvedValue({
      summary: 's',
      actions: [{ action_type: 'follow', platform: 'instagram', target_handle: 'a', target_url: 'https://www.instagram.com/a/' }],
      search_hashtags: [],
      notes: [],
    });
    const pushAlert = vi.fn().mockResolvedValue(true);
    const r = await runPromotionSnsEngage(
      { channel: 'instagram' },
      { prisma, port, generate, decryptSession: () => '{"cookies":[]}', resolveProxy: async () => null, lineConfigured: () => true, pushAlert },
    );
    expect(r.per_channel.instagram!.blocked).toBe('action_blocked');
    expect(pushAlert).toHaveBeenCalled();
  });

  it('当日上限に達していれば port を呼ばない', async () => {
    const prisma = basePrisma({
      promotionSnsEngagement: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(99), // 上限超過
        upsert: vi.fn(),
      },
    });
    const port = { followAll: vi.fn() };
    const r = await runPromotionSnsEngage({ channel: 'instagram' }, { prisma, port, resolveProxy: async () => null, lineConfigured: () => false });
    expect(port.followAll).not.toHaveBeenCalled();
    expect(r.per_channel.instagram!.followed).toBe(0);
  });
});
