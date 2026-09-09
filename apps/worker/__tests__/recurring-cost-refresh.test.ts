import { describe, expect, it, vi } from 'vitest';

import {
  estimateXMonthlyUsd,
  runRecurringCostRefresh,
  X_WRITE_USD,
  type RecurringCostRefreshPrisma,
} from '../src/tasks/recurring-cost-refresh.js';

describe('estimateXMonthlyUsd', () => {
  it('書き込み＋検索リード(3回/日×25件)から月額を外挿する', () => {
    // 15日経過で writes=90。reads=15*3*25=1125。usd=90*0.015 + 1125*0.005 = 1.35 + 5.625 = 6.975。
    // 日割 6.975/15 * 30 = 13.95。
    const usd = estimateXMonthlyUsd({ writesToDate: 90, daysElapsed: 15, daysInMonth: 30 });
    expect(usd).toBeCloseTo(13.95, 1);
  });
  it('X_WRITE_USD は 0.015', () => {
    expect(X_WRITE_USD).toBe(0.015);
  });
});

describe('runRecurringCostRefresh', () => {
  const now = () => new Date('2026-08-16T00:00:00Z'); // 8月・15日経過(1日起点)

  function makePrisma(updateSpy = vi.fn().mockResolvedValue({})): RecurringCostRefreshPrisma {
    return {
      appSettings: { findUnique: vi.fn().mockResolvedValue({ latest_fx_rate: 160 }) },
      recurringCost: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a', label: 'Railway', monthly_jpy: 4500, currency: 'USD', amount_usd: 30, auto_source: 'fx', active: true },
          { id: 'b', label: 'X API', monthly_jpy: 2000, currency: 'USD', amount_usd: null, auto_source: 'x_usage', active: true },
          { id: 'c', label: 'LINE', monthly_jpy: 0, currency: 'JPY', amount_usd: null, auto_source: null, active: true },
        ]),
        update: updateSpy,
      },
      promotionPost: { count: vi.fn().mockResolvedValue(30) }, // X投稿30
      promotionXEngagement: { count: vi.fn().mockResolvedValue(60) }, // フォロー/いいね60
    } as unknown as RecurringCostRefreshPrisma;
  }

  it('fx: USD建てを最新FXで再換算、x_usage: 実使用量から推定、manual: 据置', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = makePrisma(update);
    const r = await runRecurringCostRefresh({}, { prisma, now, lineConfigured: () => false });
    // Railway: 30 * 160 = 4800（4500から更新）
    const railway = r.updated.find((u) => u.label === 'Railway');
    expect(railway?.to).toBe(4800);
    // X: writes=90, 15日経過, 8月31日 → estimateXMonthlyUsd * 160 に更新される
    const x = r.updated.find((u) => u.label === 'X API');
    expect(x).toBeDefined();
    expect(x!.to).toBeGreaterThan(0);
    // LINE(manual)は更新されない
    expect(r.updated.find((u) => u.label === 'LINE')).toBeUndefined();
    expect(r.fx_rate).toBe(160);
  });

  it('合計が10%以上動いたらLINE通知', async () => {
    const pushAlert = vi.fn().mockResolvedValue(true);
    // X使用量を大きくして合計を10%以上動かす。
    const prisma = makePrisma();
    (prisma.promotionXEngagement.count as ReturnType<typeof vi.fn>).mockResolvedValue(400);
    await runRecurringCostRefresh({}, { prisma, now, lineConfigured: () => true, pushAlert });
    expect(pushAlert).toHaveBeenCalled();
  });

  it('変化が10%未満なら通知しない', async () => {
    const pushAlert = vi.fn().mockResolvedValue(true);
    const prisma = makePrisma();
    await runRecurringCostRefresh({}, { prisma, now, lineConfigured: () => true, pushAlert });
    expect(pushAlert).not.toHaveBeenCalled();
  });
});
