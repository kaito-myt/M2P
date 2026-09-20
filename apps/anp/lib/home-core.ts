/**
 * ホーム (F-ANP-42, docs/11-anp-design.md §3.5/§8) の集計ロジック。
 * DB 非依存の純関数にして RSC (`app/(app)/page.tsx`) からもテストからも呼べるようにする。
 */

export function jstMonthRange(now: Date): { start: Date; end: Date; ym: string } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 9 * 3600_000);
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0) - 9 * 3600_000);
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start, end, ym };
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return Math.round((v as { toNumber: () => number }).toNumber());
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface HomeAccountRow {
  id: string;
  display_name: string;
  niche: string;
  status: string;
  followers_total: number;
}

export interface HomeArticleRow {
  id: string;
  note_account_id: string;
  publish_status: string;
  published_at: Date | null;
  created_at: Date;
  cost_jpy_total: unknown;
}

export interface HomeSalesRow {
  note_article_id: string;
  revenue_jpy: number;
  views: number;
}

export interface AccountKpi {
  id: string;
  displayName: string;
  niche: string;
  status: string;
  followersTotal: number;
  publishedTotal: number;
  published30d: number;
  revenueThisMonth: number;
  costThisMonth: number;
  netProfitThisMonth: number;
}

/**
 * アカウント別 KPI: フォロワー/公開記事数(累計・30日)/当月売上/当月コスト/当月純利益。
 * 当月コストは `token_usage` にアカウント紐付け列が無いため (docs/11 §3.5)、
 * `note_articles.cost_jpy_total` の当月作成分合計を近似値として使う。
 */
export function computeAccountKpis(params: {
  accounts: HomeAccountRow[];
  articles: HomeArticleRow[];
  salesThisMonth: HomeSalesRow[];
  now: Date;
}): AccountKpi[] {
  const { accounts, articles, salesThisMonth, now } = params;
  const { start: monthStart, end: monthEnd } = jstMonthRange(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600_000);

  const articleToAccount = new Map(articles.map((a) => [a.id, a.note_account_id]));
  const revenueByAccount = new Map<string, number>();
  for (const sale of salesThisMonth) {
    const accountId = articleToAccount.get(sale.note_article_id);
    if (!accountId) continue;
    revenueByAccount.set(accountId, (revenueByAccount.get(accountId) ?? 0) + sale.revenue_jpy);
  }

  return accounts.map((account) => {
    const accountArticles = articles.filter((a) => a.note_account_id === account.id);
    const publishedTotal = accountArticles.filter((a) => a.publish_status === 'published').length;
    const published30d = accountArticles.filter(
      (a) => a.publish_status === 'published' && a.published_at != null && a.published_at >= thirtyDaysAgo,
    ).length;
    const costThisMonth = accountArticles
      .filter((a) => a.created_at >= monthStart && a.created_at < monthEnd)
      .reduce((sum, a) => sum + toNumber(a.cost_jpy_total), 0);
    const revenueThisMonth = revenueByAccount.get(account.id) ?? 0;

    return {
      id: account.id,
      displayName: account.display_name,
      niche: account.niche,
      status: account.status,
      followersTotal: account.followers_total,
      publishedTotal,
      published30d,
      revenueThisMonth,
      costThisMonth,
      netProfitThisMonth: revenueThisMonth - costThisMonth,
    };
  });
}
