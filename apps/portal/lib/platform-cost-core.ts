/**
 * M2P 全ツール横断の AI コスト集計 (docs/10 §5 / docs/05 §3.3)。
 *
 * **ここが「統合コスト」の置き場所。** 各ツール (A2P / ANP) の画面は
 * `token_usage.tool` で自分の活動分だけを集計する方針にしたため、
 * 全ツール合算を見る場所がプラットフォーム側に必要になった。
 *
 * この関数は純粋 (DB も Date も触らない) で、呼び出し側が `token_usage` の
 * 日次×ツール集計行と `now` を渡す。
 */
import {
  TOOL_KEYS,
  jstMonthRange,
  jstYearMonth,
  normalizeToolKey,
  type ToolKey,
} from '@a2p/contracts/cost-attribution';

/** 呼び出し側が SQL で作る集計行 (1 日 × 1 ツール)。 */
export interface PlatformCostUsageRow {
  /** JST の 'YYYY-MM-DD'。 */
  date: string;
  /** `token_usage.tool`。未知値は既定ツールに寄せる。 */
  tool: string;
  cost_jpy: unknown;
  call_count: number;
}

export interface PlatformCostToolTotal {
  tool: ToolKey;
  cost_jpy: number;
  call_count: number;
  /** 当月合計に対する比率 (0〜100)。合計 0 なら 0。 */
  sharePct: number;
}

export interface PlatformCostDailyPoint {
  date: string;
  cost_jpy: number;
  byTool: Record<ToolKey, number>;
}

export type CostLevel = 'green' | 'yellow' | 'orange' | 'red';

export interface PlatformCostDashboard {
  /** 'YYYY-MM' (JST)。 */
  ym: string;
  totalThisMonth: number;
  totalLastMonth: number;
  callsThisMonth: number;
  /** 当月着地の単純予測 (日割り × 当月日数)。経過日数 0 なら null。 */
  forecastMonthEnd: number | null;
  budgetJpy: number;
  ratioPct: number;
  forecastRatioPct: number;
  level: CostLevel;
  byTool: PlatformCostToolTotal[];
  daily: PlatformCostDailyPoint[];
}

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** docs/04 §3.2 と同じ閾値 (0-80 green / 80-95 yellow / 95-100 orange / 100+ red)。 */
export function getCostLevel(ratioPct: number): CostLevel {
  if (ratioPct >= 100) return 'red';
  if (ratioPct >= 95) return 'orange';
  if (ratioPct >= 80) return 'yellow';
  return 'green';
}

export { jstYearMonth };

/**
 * 当月/前月の集計範囲 (JST 月初〜翌月初を UTC の Date で返す)。
 * 境界の定義は `@a2p/contracts/cost-attribution` の `jstMonthRange` に集約してある
 * (A2P / ANP / ポータルで同じ月を指すため)。前月分も取って前月比を出す。
 */
export function platformCostRange(now: Date): { start: Date; monthStart: Date; end: Date } {
  const r = jstMonthRange(now);
  return { start: r.prevMonthStart, monthStart: r.monthStart, end: r.nextMonthStart };
}

function emptyByTool(): Record<ToolKey, number> {
  const out = {} as Record<ToolKey, number>;
  for (const t of TOOL_KEYS) out[t] = 0;
  return out;
}

export interface ComputePlatformCostArgs {
  /** 当月 + 前月の日次×ツール集計行。 */
  usage: readonly PlatformCostUsageRow[];
  now: Date;
  /** 月次赤ライン (app_settings.monthly_cost_red_jpy)。 */
  budgetJpy: number;
}

export function computePlatformCost(args: ComputePlatformCostArgs): PlatformCostDashboard {
  const { usage, now, budgetJpy } = args;
  const ym = jstYearMonth(now);
  const lastYm = prevYm(ym);

  const dailyMap = new Map<string, PlatformCostDailyPoint>();
  const toolTotals = emptyByTool();
  const toolCalls = emptyByTool();
  let totalThisMonth = 0;
  let totalLastMonth = 0;
  let callsThisMonth = 0;

  for (const row of usage) {
    const cost = toNumber(row.cost_jpy);
    const tool = normalizeToolKey(row.tool);
    const rowYm = row.date.slice(0, 7);
    if (rowYm === ym) {
      totalThisMonth += cost;
      callsThisMonth += row.call_count;
      toolTotals[tool] += cost;
      toolCalls[tool] += row.call_count;
      const point = dailyMap.get(row.date) ?? { date: row.date, cost_jpy: 0, byTool: emptyByTool() };
      point.cost_jpy += cost;
      point.byTool[tool] += cost;
      dailyMap.set(row.date, point);
    } else if (rowYm === lastYm) {
      totalLastMonth += cost;
    }
  }

  const byTool: PlatformCostToolTotal[] = TOOL_KEYS.map((tool) => ({
    tool,
    cost_jpy: toolTotals[tool],
    call_count: toolCalls[tool],
    sharePct: totalThisMonth > 0 ? (toolTotals[tool] / totalThisMonth) * 100 : 0,
  })).sort((a, b) => b.cost_jpy - a.cost_jpy);

  const jst = new Date(now.getTime() + 9 * 3600_000);
  const elapsedDays = jst.getUTCDate();
  const daysInMonth = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + 1, 0)).getUTCDate();
  const forecastMonthEnd =
    elapsedDays > 0 ? Math.round((totalThisMonth / elapsedDays) * daysInMonth) : null;

  const ratioPct = budgetJpy > 0 ? (totalThisMonth / budgetJpy) * 100 : 0;
  const forecastRatioPct =
    budgetJpy > 0 && forecastMonthEnd != null ? (forecastMonthEnd / budgetJpy) * 100 : 0;

  return {
    ym,
    totalThisMonth,
    totalLastMonth,
    callsThisMonth,
    forecastMonthEnd,
    budgetJpy,
    ratioPct: Math.round(ratioPct * 10) / 10,
    forecastRatioPct: Math.round(forecastRatioPct * 10) / 10,
    level: getCostLevel(forecastRatioPct),
    byTool,
    daily: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/** 'YYYY-MM' の 1 か月前。 */
export function prevYm(ym: string): string {
  const [y, m] = ym.split('-').map((v) => Number(v));
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 前月比 (%)。前月 0 なら null。 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
