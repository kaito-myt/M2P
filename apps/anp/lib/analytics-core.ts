/**
 * 分析 (S-ANP-11 売上ダッシュボード / S-ANP-12 コストダッシュボード, docs/11-anp-design.md §3.5 F-ANP-41/42) の集計ロジック。
 *
 * 運営者要望 (2026-09-21)「売上ダッシュボードとコストダッシュボードも作りましょうか。A2P と同じように、分析メニューの
 * 配下に売上ダッシュボードとコストダッシュボードを追加しましょう」。DB 非依存の純関数にして RSC とテストから共用する。
 *
 * - 売上: `note_sales` (記事×年月の当月実績: 売上/ビュー/スキ/購入者) と `note_membership_stats` (アカウント×年月:
 *   メンバー数/MRR) を、記事→アカウントで束ねて「当月 KPI / 6 か月推移 / アカウント別 / 記事別」にする。
 * - コスト: `token_usage` (role='anp.*') を日次・役割別・モデル別に集計し、記事別は `note_articles.cost_jpy_total`。
 */
import { jstMonthRange, toNumber } from './home-core';

export { jstMonthRange, toNumber };

/** now を含む直近 n か月の "YYYY-MM" (古い順、JST)。 */
export function recentMonthKeys(now: Date, n: number): string[] {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** "YYYY-MM" → 前月キー。 */
export function previousMonthKey(ym: string): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 売上
// ---------------------------------------------------------------------------

export interface SalesAccountRow {
  id: string;
  display_name: string;
  niche: string;
  status: string;
  followers_total: number;
}

export interface SalesArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  paid: boolean;
  price_jpy: number | null;
  publish_status: string;
  published_at: Date | null;
  note_url: string | null;
}

export interface SalesRecordRow {
  note_article_id: string;
  year_month: string;
  revenue_jpy: number;
  views: number;
  likes: number;
  buyers: number;
}

export interface MembershipRow {
  note_account_id: string;
  year_month: string;
  subscribers: number;
  mrr_jpy: number;
}

export interface SalesTotals {
  revenue: number;
  views: number;
  likes: number;
  buyers: number;
  mrr: number;
  subscribers: number;
}

export interface SalesMonthPoint extends SalesTotals {
  ym: string;
  published: number;
}

export interface SalesAccountKpi extends SalesTotals {
  id: string;
  displayName: string;
  niche: string;
  status: string;
  followersTotal: number;
  publishedTotal: number;
  publishedThisMonth: number;
  paidArticles: number;
  topArticle: { id: string; title: string; revenue: number; views: number } | null;
}

export interface SalesArticleKpi {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  paid: boolean;
  price_jpy: number | null;
  revenue: number;
  views: number;
  likes: number;
  buyers: number;
  note_url: string | null;
  published_at: string | null;
}

export interface SalesDashboard {
  ym: string;
  thisMonth: SalesTotals;
  lastMonth: SalesTotals;
  trend: SalesMonthPoint[];
  accounts: SalesAccountKpi[];
  topArticles: SalesArticleKpi[];
}

const emptyTotals = (): SalesTotals => ({ revenue: 0, views: 0, likes: 0, buyers: 0, mrr: 0, subscribers: 0 });

function addSale(t: SalesTotals, s: SalesRecordRow): void {
  t.revenue += s.revenue_jpy;
  t.views += s.views;
  t.likes += s.likes;
  t.buyers += s.buyers;
}

function ymOf(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function computeSalesDashboard(params: {
  accounts: SalesAccountRow[];
  articles: SalesArticleRow[];
  sales: SalesRecordRow[];
  membership: MembershipRow[];
  now: Date;
  months?: number;
  topN?: number;
}): SalesDashboard {
  const { accounts, articles, sales, membership, now } = params;
  const months = recentMonthKeys(now, params.months ?? 6);
  const ym = months[months.length - 1]!;
  const lastYm = previousMonthKey(ym);
  const articleById = new Map(articles.map((a) => [a.id, a]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // 月別トレンド
  const trendByYm = new Map<string, SalesMonthPoint>(months.map((k) => [k, { ym: k, published: 0, ...emptyTotals() }]));
  for (const s of sales) {
    const p = trendByYm.get(s.year_month);
    if (p) addSale(p, s);
  }
  for (const mrow of membership) {
    const p = trendByYm.get(mrow.year_month);
    if (p) {
      p.mrr += mrow.mrr_jpy;
      p.subscribers += mrow.subscribers;
    }
  }
  for (const a of articles) {
    if (a.publish_status !== 'published' || !a.published_at) continue;
    const p = trendByYm.get(ymOf(a.published_at));
    if (p) p.published += 1;
  }

  const totalsFor = (key: string): SalesTotals => {
    const t = emptyTotals();
    for (const s of sales) if (s.year_month === key) addSale(t, s);
    for (const mrow of membership) {
      if (mrow.year_month !== key) continue;
      t.mrr += mrow.mrr_jpy;
      t.subscribers += mrow.subscribers;
    }
    return t;
  };

  // アカウント別 (当月)
  const perAccount = new Map<string, SalesAccountKpi>();
  for (const acc of accounts) {
    perAccount.set(acc.id, {
      id: acc.id,
      displayName: acc.display_name,
      niche: acc.niche,
      status: acc.status,
      followersTotal: acc.followers_total,
      publishedTotal: 0,
      publishedThisMonth: 0,
      paidArticles: 0,
      topArticle: null,
      ...emptyTotals(),
    });
  }
  for (const a of articles) {
    const k = perAccount.get(a.note_account_id);
    if (!k) continue;
    if (a.publish_status === 'published') {
      k.publishedTotal += 1;
      if (a.published_at && ymOf(a.published_at) === ym) k.publishedThisMonth += 1;
      if (a.paid) k.paidArticles += 1;
    }
  }
  const articleThisMonth = new Map<string, SalesArticleKpi>();
  for (const s of sales) {
    if (s.year_month !== ym) continue;
    const a = articleById.get(s.note_article_id);
    if (!a) continue;
    const k = perAccount.get(a.note_account_id);
    if (k) addSale(k, s);
    const acc = accountById.get(a.note_account_id);
    const cur = articleThisMonth.get(a.id) ?? {
      id: a.id,
      title: a.title,
      accountId: a.note_account_id,
      accountName: acc?.display_name ?? '',
      paid: a.paid,
      price_jpy: a.price_jpy,
      revenue: 0,
      views: 0,
      likes: 0,
      buyers: 0,
      note_url: a.note_url,
      published_at: a.published_at ? a.published_at.toISOString() : null,
    };
    cur.revenue += s.revenue_jpy;
    cur.views += s.views;
    cur.likes += s.likes;
    cur.buyers += s.buyers;
    articleThisMonth.set(a.id, cur);
  }
  for (const mrow of membership) {
    if (mrow.year_month !== ym) continue;
    const k = perAccount.get(mrow.note_account_id);
    if (!k) continue;
    k.mrr += mrow.mrr_jpy;
    k.subscribers += mrow.subscribers;
  }
  const rankArticles = (list: SalesArticleKpi[]) => list.sort((x, y) => y.revenue - x.revenue || y.views - x.views || y.likes - x.likes);
  for (const k of perAccount.values()) {
    const mine = rankArticles([...articleThisMonth.values()].filter((a) => a.accountId === k.id));
    const top = mine[0];
    k.topArticle = top && (top.revenue > 0 || top.views > 0) ? { id: top.id, title: top.title, revenue: top.revenue, views: top.views } : null;
  }

  const accountsSorted = [...perAccount.values()].sort((x, y) => y.revenue - x.revenue || y.views - x.views || x.displayName.localeCompare(y.displayName, 'ja'));
  const topArticles = rankArticles([...articleThisMonth.values()]).slice(0, params.topN ?? 10);

  return {
    ym,
    thisMonth: totalsFor(ym),
    lastMonth: totalsFor(lastYm),
    trend: months.map((k) => trendByYm.get(k)!),
    accounts: accountsSorted,
    topArticles,
  };
}

/** 前月比 (%)。前月 0 なら null。 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// コスト
// ---------------------------------------------------------------------------

export interface CostUsageRow {
  /** JST 日付 "YYYY-MM-DD"。 */
  date: string;
  provider: string;
  model: string;
  role: string;
  cost_jpy: unknown;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CostArticleRow {
  id: string;
  title: string;
  note_account_id: string;
  status: string;
  publish_status: string;
  cost_jpy_total: unknown;
  created_at: Date;
}

export interface CostAccountRow {
  id: string;
  display_name: string;
}

export interface CostBreakdownRow {
  key: string;
  label: string;
  cost: number;
  calls: number;
  share: number;
}

export interface CostDayPoint {
  date: string;
  cost: number;
  calls: number;
}

export interface CostAccountKpi {
  id: string;
  displayName: string;
  cost: number;
  articles: number;
  published: number;
  costPerArticle: number | null;
}

export interface CostArticleKpi {
  id: string;
  title: string;
  accountId: string;
  accountName: string;
  status: string;
  cost: number;
  created_at: string;
}

export interface CostDashboard {
  ym: string;
  totalThisMonth: number;
  totalLastMonth: number;
  callsThisMonth: number;
  tokensThisMonth: { input: number; output: number };
  /** 当月に作成された記事 1 本あたりの平均コスト (記事 cost_jpy_total ベース)。 */
  avgCostPerArticle: number | null;
  /** 当月の公開記事 1 本あたり (公開済みのみ)。 */
  avgCostPerPublished: number | null;
  daily: CostDayPoint[];
  byRole: CostBreakdownRow[];
  byModel: CostBreakdownRow[];
  byProvider: CostBreakdownRow[];
  accounts: CostAccountKpi[];
  topArticles: CostArticleKpi[];
  /** 月末着地の単純予測 (当月日割り × 月日数)。 */
  forecastMonthEnd: number | null;
}

function jstDateKey(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

function breakdown(rows: ReadonlyArray<{ key: string; label: string; cost: number; calls: number }>): CostBreakdownRow[] {
  const map = new Map<string, CostBreakdownRow>();
  for (const r of rows) {
    const cur = map.get(r.key) ?? { key: r.key, label: r.label, cost: 0, calls: 0, share: 0 };
    cur.cost += r.cost;
    cur.calls += r.calls;
    map.set(r.key, cur);
  }
  const total = [...map.values()].reduce((s, r) => s + r.cost, 0);
  return [...map.values()]
    .map((r) => ({ ...r, cost: Math.round(r.cost * 100) / 100, share: total > 0 ? Math.round((r.cost / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.cost - a.cost);
}

export function computeCostDashboard(params: {
  /** 当月 + 前月の token_usage 日次集計 (role='anp.*')。 */
  usage: CostUsageRow[];
  articles: CostArticleRow[];
  accounts: CostAccountRow[];
  now: Date;
  topN?: number;
}): CostDashboard {
  const { usage, articles, accounts, now } = params;
  const { start: monthStart, end: monthEnd, ym } = jstMonthRange(now);
  const lastYm = previousMonthKey(ym);
  const thisMonthUsage = usage.filter((u) => u.date.startsWith(ym));
  const lastMonthUsage = usage.filter((u) => u.date.startsWith(lastYm));

  const totalThisMonth = thisMonthUsage.reduce((s, u) => s + toNumber(u.cost_jpy), 0);
  const totalLastMonth = lastMonthUsage.reduce((s, u) => s + toNumber(u.cost_jpy), 0);
  const callsThisMonth = thisMonthUsage.reduce((s, u) => s + u.call_count, 0);
  const tokensThisMonth = {
    input: thisMonthUsage.reduce((s, u) => s + u.input_tokens, 0),
    output: thisMonthUsage.reduce((s, u) => s + u.output_tokens, 0),
  };

  // 日次 (当月の 1 日〜今日まで埋める)
  const dayMap = new Map<string, CostDayPoint>();
  const jstNow = new Date(now.getTime() + 9 * 3600_000);
  const daysInMonth = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth() + 1, 0)).getUTCDate();
  const today = jstNow.getUTCDate();
  for (let d = 1; d <= today; d++) {
    const key = `${ym}-${String(d).padStart(2, '0')}`;
    dayMap.set(key, { date: key, cost: 0, calls: 0 });
  }
  for (const u of thisMonthUsage) {
    const p = dayMap.get(u.date);
    if (!p) continue;
    p.cost += toNumber(u.cost_jpy);
    p.calls += u.call_count;
  }
  const daily = [...dayMap.values()].map((p) => ({ ...p, cost: Math.round(p.cost * 100) / 100 }));

  const byRole = breakdown(thisMonthUsage.map((u) => ({ key: u.role, label: u.role, cost: toNumber(u.cost_jpy), calls: u.call_count })));
  const byModel = breakdown(thisMonthUsage.map((u) => ({ key: `${u.provider}/${u.model}`, label: `${u.provider} / ${u.model}`, cost: toNumber(u.cost_jpy), calls: u.call_count })));
  const byProvider = breakdown(thisMonthUsage.map((u) => ({ key: u.provider, label: u.provider, cost: toNumber(u.cost_jpy), calls: u.call_count })));

  // アカウント別 / 記事別 (当月作成の記事の cost_jpy_total)
  const monthArticles = articles.filter((a) => a.created_at >= monthStart && a.created_at < monthEnd);
  const accountName = new Map(accounts.map((a) => [a.id, a.display_name]));
  const perAccount = new Map<string, CostAccountKpi>(accounts.map((a) => [a.id, { id: a.id, displayName: a.display_name, cost: 0, articles: 0, published: 0, costPerArticle: null }]));
  for (const a of monthArticles) {
    const k = perAccount.get(a.note_account_id);
    if (!k) continue;
    k.cost += toNumber(a.cost_jpy_total);
    k.articles += 1;
    if (a.publish_status === 'published') k.published += 1;
  }
  const accountsSorted = [...perAccount.values()]
    .map((k) => ({ ...k, cost: Math.round(k.cost), costPerArticle: k.articles > 0 ? Math.round(k.cost / k.articles) : null }))
    .sort((x, y) => y.cost - x.cost || x.displayName.localeCompare(y.displayName, 'ja'));
  const topArticles: CostArticleKpi[] = [...monthArticles]
    .map((a) => ({
      id: a.id,
      title: a.title,
      accountId: a.note_account_id,
      accountName: accountName.get(a.note_account_id) ?? '',
      status: a.status,
      cost: Math.round(toNumber(a.cost_jpy_total)),
      created_at: a.created_at.toISOString(),
    }))
    .sort((x, y) => y.cost - x.cost)
    .slice(0, params.topN ?? 10);

  const articleCostSum = monthArticles.reduce((s, a) => s + toNumber(a.cost_jpy_total), 0);
  const publishedCount = monthArticles.filter((a) => a.publish_status === 'published').length;
  const forecastMonthEnd = today > 0 ? Math.round((totalThisMonth / today) * daysInMonth) : null;

  return {
    ym,
    totalThisMonth: Math.round(totalThisMonth),
    totalLastMonth: Math.round(totalLastMonth),
    callsThisMonth,
    tokensThisMonth,
    avgCostPerArticle: monthArticles.length > 0 ? Math.round(articleCostSum / monthArticles.length) : null,
    avgCostPerPublished: publishedCount > 0 ? Math.round(articleCostSum / publishedCount) : null,
    daily,
    byRole,
    byModel,
    byProvider,
    accounts: accountsSorted,
    topArticles,
    forecastMonthEnd,
  };
}

/** `token_usage` の JST 日次集計に使う期間 (前月 1 日 JST 〜 翌月 1 日 JST)。 */
export function costQueryRange(now: Date): { start: Date; end: Date } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m - 1, 1) - 9 * 3600_000),
    end: new Date(Date.UTC(y, m + 1, 1) - 9 * 3600_000),
  };
}

export { jstDateKey };
