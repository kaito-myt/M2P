/**
 * CostMeter のコアロジック (T-07-06 / docs/04 §3.2 / docs/05 §4.2).
 *
 * Route Handler `/api/cost/current` から呼ばれる。
 * テスト容易性のため Prisma を DI で受け取る。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CostLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface CostMeterData {
  monthly_cost_jpy: number;
  budget_jpy: number;
  ratio: number;
  level: CostLevel;
  remaining: number;
  warn_count: number;
  paused_count: number;
}

export interface CostMeterPrisma {
  tokenUsage: {
    aggregate: (args: {
      where: { created_at: { gte: Date; lt: Date } };
      _sum: { cost_jpy: true };
    }) => Promise<{ _sum: { cost_jpy: unknown } }>;
  };
  // [F-090] 当月の Amazon Ads 広告費。当月コスト・純利益に算入する。
  adSpend?: {
    aggregate: (args: {
      where: { year_month: string };
      _sum: { spend_jpy: true };
    }) => Promise<{ _sum: { spend_jpy: unknown } }>;
  };
  book: {
    count: (args: { where: { cost_status: string } }) => Promise<number>;
  };
  appSettings: {
    findUnique: (args: {
      where: { id: string };
      select: { monthly_cost_red_jpy: true };
    }) => Promise<{ monthly_cost_red_jpy: number } | null>;
  };
}

// ---------------------------------------------------------------------------
// Level calculation (docs/04 §3.2: 0-80% green, 80-95% yellow, 95-100% orange, 100%+ red)
// ---------------------------------------------------------------------------

export function getCostLevel(ratioPct: number): CostLevel {
  if (ratioPct >= 100) return 'red';
  if (ratioPct >= 95) return 'orange';
  if (ratioPct >= 80) return 'yellow';
  return 'green';
}

// ---------------------------------------------------------------------------
// Data fetcher
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET_JPY = 50_000;

function toNumber(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function getCostMeterData(
  prisma: CostMeterPrisma,
  now?: Date,
): Promise<CostMeterData> {
  const current = now ?? new Date();
  const year = current.getFullYear();
  const month = current.getMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));

  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  const [costResult, adResult, warnCount, pausedCount, settings] = await Promise.all([
    prisma.tokenUsage.aggregate({
      where: { created_at: { gte: start, lt: end } },
      _sum: { cost_jpy: true },
    }),
    // [F-090] 当月の Amazon Ads 広告費 (year_month = "YYYY-MM")。未計上/未接続なら 0。
    prisma.adSpend
      ? prisma.adSpend.aggregate({ where: { year_month: ym }, _sum: { spend_jpy: true } })
      : Promise.resolve({ _sum: { spend_jpy: 0 } }),
    prisma.book.count({ where: { cost_status: 'warn' } }),
    prisma.book.count({ where: { cost_status: 'paused' } }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { monthly_cost_red_jpy: true },
    }),
  ]);

  // 当月コスト = AI 従量(token_usage) + Amazon Ads 広告費。
  const monthlyCostJpy = toNumber(costResult._sum.cost_jpy) + toNumber(adResult._sum.spend_jpy);
  const budgetJpy = settings?.monthly_cost_red_jpy ?? DEFAULT_BUDGET_JPY;
  const ratioPct = budgetJpy > 0 ? (monthlyCostJpy / budgetJpy) * 100 : 0;
  const remaining = Math.max(budgetJpy - monthlyCostJpy, 0);

  return {
    monthly_cost_jpy: Math.round(monthlyCostJpy),
    budget_jpy: budgetJpy,
    ratio: Math.round(ratioPct * 10) / 10,
    level: getCostLevel(ratioPct),
    remaining: Math.round(remaining),
    warn_count: warnCount,
    paused_count: pausedCount,
  };
}
