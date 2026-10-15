import { describe, expect, it } from 'vitest';

import {
  computePlatformCost,
  getCostLevel,
  jstYearMonth,
  percentChange,
  platformCostRange,
  prevYm,
  type PlatformCostUsageRow,
} from '../platform-cost-core';

// 2026-10-13 10:28 JST = 2026-10-13 01:28 UTC
const NOW = new Date('2026-10-13T01:28:00.000Z');

function row(date: string, tool: string, cost: number, calls = 1): PlatformCostUsageRow {
  return { date, tool, cost_jpy: cost, call_count: calls };
}

describe('jstYearMonth / platformCostRange', () => {
  it('JST の年月を返す (UTC で前月末でも JST では当月)', () => {
    expect(jstYearMonth(NOW)).toBe('2026-10');
    // 2026-09-30 16:00 UTC = 2026-10-01 01:00 JST
    expect(jstYearMonth(new Date('2026-09-30T16:00:00.000Z'))).toBe('2026-10');
    // 2026-09-30 14:59 UTC = 2026-09-30 23:59 JST
    expect(jstYearMonth(new Date('2026-09-30T14:59:00.000Z'))).toBe('2026-09');
  });

  it('前月初〜翌月初を JST 基準 (= UTC 月初 -9h) で返す', () => {
    const { start, monthStart, end } = platformCostRange(NOW);
    expect(start.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // 9/1 00:00 JST
    expect(monthStart.toISOString()).toBe('2026-09-30T15:00:00.000Z'); // 10/1 00:00 JST
    expect(end.toISOString()).toBe('2026-10-31T15:00:00.000Z'); // 11/1 00:00 JST
  });

  it('年をまたぐ', () => {
    const r = platformCostRange(new Date('2026-01-05T00:00:00.000Z'));
    expect(r.monthStart.toISOString()).toBe('2025-12-31T15:00:00.000Z');
    expect(prevYm('2026-01')).toBe('2025-12');
  });
});

describe('computePlatformCost', () => {
  const usage: PlatformCostUsageRow[] = [
    // 前月
    row('2026-09-20', 'a2p', 500),
    row('2026-09-21', 'anp', 1500),
    // 当月
    row('2026-10-01', 'anp', 700, 120),
    row('2026-10-01', 'a2p', 100, 4),
    row('2026-10-02', 'anp', 800, 130),
    row('2026-10-13', 'm2p', 400, 2),
  ];

  it('当月をツール別に分け、前月は別勘定にする', () => {
    const d = computePlatformCost({ usage, now: NOW, budgetJpy: 30_000 });
    expect(d.ym).toBe('2026-10');
    expect(d.totalThisMonth).toBe(2000);
    expect(d.totalLastMonth).toBe(2000);
    expect(d.callsThisMonth).toBe(256);

    const byTool = Object.fromEntries(d.byTool.map((t) => [t.tool, t.cost_jpy]));
    // 3DP は第3ツールとして TOOL_KEYS に入っているので、使っていなくても 0 円の行が出る。
    expect(byTool).toEqual({ anp: 1500, m2p: 400, a2p: 100, '3dp': 0 });
    // コスト降順 (0 円の 3dp は末尾)
    expect(d.byTool.map((t) => t.tool)).toEqual(['anp', 'm2p', 'a2p', '3dp']);
    expect(Math.round(d.byTool[0]!.sharePct)).toBe(75);
  });

  it('全ツールが常に行として出る (0 円でも消えない)', () => {
    const d = computePlatformCost({ usage: [row('2026-10-01', 'a2p', 10)], now: NOW, budgetJpy: 1000 });
    expect(d.byTool).toHaveLength(4);
    expect(d.byTool.find((t) => t.tool === 'anp')?.cost_jpy).toBe(0);
    expect(d.byTool.find((t) => t.tool === 'anp')?.sharePct).toBe(0);
  });

  it('未知の tool 値は既定 (a2p) に寄せる', () => {
    const d = computePlatformCost({
      usage: [row('2026-10-01', 'legacy', 300)],
      now: NOW,
      budgetJpy: 1000,
    });
    expect(d.byTool.find((t) => t.tool === 'a2p')?.cost_jpy).toBe(300);
    expect(d.totalThisMonth).toBe(300);
  });

  it('日次は昇順で、各日のツール別内訳を持つ', () => {
    const d = computePlatformCost({ usage, now: NOW, budgetJpy: 30_000 });
    expect(d.daily.map((p) => p.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-13']);
    expect(d.daily[0]!.cost_jpy).toBe(800);
    expect(d.daily[0]!.byTool.anp).toBe(700);
    expect(d.daily[0]!.byTool.a2p).toBe(100);
    expect(d.daily[0]!.byTool.m2p).toBe(0);
  });

  it('月末着地は経過日数の日割り (10/13 時点で 13 日経過 / 31 日)', () => {
    const d = computePlatformCost({ usage, now: NOW, budgetJpy: 30_000 });
    expect(d.forecastMonthEnd).toBe(Math.round((2000 / 13) * 31));
    expect(d.ratioPct).toBe(6.7);
    expect(d.level).toBe('green');
  });

  it('予算 0 なら比率 0 で落ちない', () => {
    const d = computePlatformCost({ usage, now: NOW, budgetJpy: 0 });
    expect(d.ratioPct).toBe(0);
    expect(d.forecastRatioPct).toBe(0);
    expect(d.level).toBe('green');
  });

  it('着地予測が赤ラインを超えたら red', () => {
    const d = computePlatformCost({
      usage: [row('2026-10-01', 'a2p', 20_000)],
      now: NOW,
      budgetJpy: 30_000,
    });
    expect(d.level).toBe('red');
  });

  it('空データでも落ちない', () => {
    const d = computePlatformCost({ usage: [], now: NOW, budgetJpy: 30_000 });
    expect(d.totalThisMonth).toBe(0);
    expect(d.forecastMonthEnd).toBe(0);
    expect(d.daily).toEqual([]);
    expect(d.byTool.every((t) => t.cost_jpy === 0)).toBe(true);
  });

  it('Prisma Decimal のような toNumber を持つ値を読める', () => {
    const decimal = { toNumber: () => 123.5 };
    const d = computePlatformCost({
      usage: [{ date: '2026-10-01', tool: 'anp', cost_jpy: decimal, call_count: 1 }],
      now: NOW,
      budgetJpy: 1000,
    });
    expect(d.totalThisMonth).toBe(123.5);
  });
});

describe('getCostLevel / percentChange', () => {
  it('docs/04 §3.2 の閾値', () => {
    expect(getCostLevel(0)).toBe('green');
    expect(getCostLevel(79.9)).toBe('green');
    expect(getCostLevel(80)).toBe('yellow');
    expect(getCostLevel(94.9)).toBe('yellow');
    expect(getCostLevel(95)).toBe('orange');
    expect(getCostLevel(99.9)).toBe('orange');
    expect(getCostLevel(100)).toBe('red');
  });

  it('前月比 (前月 0 は null)', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 0)).toBeNull();
  });
});
