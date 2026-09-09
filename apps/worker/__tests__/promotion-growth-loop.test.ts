import { describe, expect, it, vi } from 'vitest';

import {
  decideGrowthActions,
  runPromotionGrowthLoop,
  type GrowthLoopInputs,
  type PromotionGrowthLoopPrisma,
} from '../src/tasks/promotion-growth-loop.js';

const baseEngagement = { sample: 12, avg_impressions: 20, sum_likes: 3, max_impressions: 40 };
const goodEngagement = { sample: 12, avg_impressions: 500, sum_likes: 50, max_impressions: 900 };
const flatTrend = { latest_followers: 50, prior_followers: 50, span_days: 7, delta: 0 };
const growingTrend = { latest_followers: 200, prior_followers: 150, span_days: 7, delta: 50 };

describe('decideGrowthActions', () => {
  it('キューが薄いチャンネルは content 再生成', () => {
    const inputs: GrowthLoopInputs = {
      engagement: goodEngagement,
      trend: growingTrend,
      channels: [
        { channel: 'x', auto_enabled: true, scheduled_value: 2, playbook_stale: false },
        { channel: 'instagram', auto_enabled: true, scheduled_value: 10, playbook_stale: false },
      ],
      x_engage_enabled: true,
      sns_engage_enabled: true,
    };
    const actions = decideGrowthActions(inputs);
    expect(actions.filter((a) => a.type === 'regenerate_content').map((a) => (a as { channel: string }).channel)).toEqual(['x']);
  });

  it('到達が弱い(reach_critical)ときは全autoチャンネル再生成＋Xプレイブック更新', () => {
    const inputs: GrowthLoopInputs = {
      engagement: baseEngagement, // sample12, avg20 < 50 => reach_critical
      trend: flatTrend, // growth_stalled
      channels: [
        { channel: 'x', auto_enabled: true, scheduled_value: 20, playbook_stale: false },
        { channel: 'note', auto_enabled: true, scheduled_value: 20, playbook_stale: false },
        { channel: 'blog', auto_enabled: false, scheduled_value: 0, playbook_stale: true },
      ],
      x_engage_enabled: true,
      sns_engage_enabled: true,
    };
    const actions = decideGrowthActions(inputs);
    const regen = actions.filter((a) => a.type === 'regenerate_content').map((a) => (a as { channel: string }).channel);
    expect(regen).toContain('x');
    expect(regen).toContain('note');
    expect(regen).not.toContain('blog'); // auto_enabled=false
    expect(actions.some((a) => a.type === 'refresh_playbook' && (a as { channel: string }).channel === 'x')).toBe(true);
  });

  it('プレイブックが古いチャンネルはリサーチ更新', () => {
    const inputs: GrowthLoopInputs = {
      engagement: goodEngagement,
      trend: growingTrend,
      channels: [{ channel: 'x', auto_enabled: true, scheduled_value: 20, playbook_stale: true }],
      x_engage_enabled: true,
      sns_engage_enabled: true,
    };
    const actions = decideGrowthActions(inputs);
    expect(actions.some((a) => a.type === 'refresh_playbook')).toBe(true);
  });

  it('エンゲージ engine が OFF なら推奨のみ(自動ONしない)', () => {
    const inputs: GrowthLoopInputs = {
      engagement: goodEngagement,
      trend: growingTrend,
      channels: [{ channel: 'x', auto_enabled: true, scheduled_value: 20, playbook_stale: false }],
      x_engage_enabled: false,
      sns_engage_enabled: false,
    };
    const actions = decideGrowthActions(inputs);
    expect(actions.filter((a) => a.type === 'recommend')).toHaveLength(2);
    expect(actions.some((a) => a.type === 'regenerate_content')).toBe(false);
  });
});

function basePrisma(overrides: Partial<PromotionGrowthLoopPrisma> = {}): PromotionGrowthLoopPrisma {
  return {
    appSettings: { findUnique: vi.fn().mockResolvedValue({ promo_growth_loop_enabled: true, x_engage_enabled: true, sns_engage_enabled: true }) },
    promotionChannelSetting: { findMany: vi.fn().mockResolvedValue([{ channel: 'x', auto_enabled: true, playbook_updated_at: null }]) },
    promotionPost: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0), // 予約0 → 再生成トリガ
    },
    promotionGrowthSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    salesRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { royalty_jpy: 1234 } }) },
    tokenUsage: { aggregate: vi.fn().mockResolvedValue({ _sum: { cost_jpy: 500 } }) },
    recurringCost: { aggregate: vi.fn().mockResolvedValue({ _sum: { monthly_jpy: 20000 } }) },
    orgTask: { create: vi.fn().mockResolvedValue({ id: 't1' }) },
    ...overrides,
  } as PromotionGrowthLoopPrisma;
}

describe('runPromotionGrowthLoop', () => {
  it('promo_growth_loop_enabled=false なら何もしない', async () => {
    const prisma = basePrisma({ appSettings: { findUnique: vi.fn().mockResolvedValue({ promo_growth_loop_enabled: false }) } });
    const addJob = vi.fn();
    const r = await runPromotionGrowthLoop({}, { prisma, addJob, lineConfigured: () => false });
    expect(r.enabled).toBe(false);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('有効時: 薄いキューを検知して content.generate を enqueue し org_task を記録', async () => {
    const prisma = basePrisma();
    const addJob = vi.fn().mockResolvedValue(undefined);
    const r = await runPromotionGrowthLoop({}, { prisma, addJob, lineConfigured: () => false });
    expect(r.enabled).toBe(true);
    expect(addJob).toHaveBeenCalledWith('promotion.content.generate', { channel: 'x' });
    // playbook_updated_at=null → stale → refresh も
    expect(addJob).toHaveBeenCalledWith('promotion.playbook.refresh', { channel: 'x' });
    expect(r.executed.content).toBe(1);
    expect(prisma.orgTask.create).toHaveBeenCalledOnce();
    expect(r.revenue_month_jpy).toBe(1234);
    // 損益 = 売上1234 − AI原価500 − 固定費20000 = -19266（赤字）
    expect(r.ai_cost_month_jpy).toBe(500);
    expect(r.fixed_cost_month_jpy).toBe(20000);
    expect(r.profit_month_jpy).toBe(1234 - 500 - 20000);
  });

  it('force=true ならフラグOFFでも実行', async () => {
    const prisma = basePrisma({ appSettings: { findUnique: vi.fn().mockResolvedValue({ promo_growth_loop_enabled: false, x_engage_enabled: true, sns_engage_enabled: true }) } });
    const addJob = vi.fn().mockResolvedValue(undefined);
    const r = await runPromotionGrowthLoop({ force: true }, { prisma, addJob, lineConfigured: () => false });
    expect(r.enabled).toBe(true);
    expect(addJob).toHaveBeenCalled();
  });
});
