/**
 * `/ads` 広告(Amazon Ads)ダッシュボードのビューヘルパ (F-090拡張)。
 *
 * RSC ページが Prisma から取得した生の行 (ad_spend / ad_campaign_stats /
 * ad_product_stats) を受け取り、KPI 集計・トレンド整形・キャンペーン/書籍別集計を行う
 * 純粋関数群。DB アクセスは含まない (テスト容易性のため apps/web/app/(app)/ads/page.tsx
 * 側で prisma クエリを行い、本ファイルへ生データを渡す)。
 *
 * 仕様根拠: 親タスク指示 (2026-09-21, 広告パフォーマンス取込) / docs/05 §追加 DB テーブル。
 */

export { formatJpy, formatJpyCompact } from './sales-kpi-view';

// ---------------------------------------------------------------------------
// 期間 (当月 / 先月 / 直近30日)
// ---------------------------------------------------------------------------

export type AdsPeriod = 'current' | 'prev' | 'last30';

export interface AdsDateWindow {
  /** ads_date (YYYY-MM-DD) の下限 (含む)。 */
  fromDate: string;
  /** ads_date (YYYY-MM-DD) の上限 (含む)。 */
  toDate: string;
  /** 当月/先月選択時のみ設定 (year_month 完全一致フィルタに使える)。 */
  yearMonth?: string;
}

export interface AdsPeriodRange extends AdsDateWindow {
  period: AdsPeriod;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** searchParams の `period` から表示期間を解決する。不正値/未指定は 'current'。 */
export function resolveAdsPeriod(periodRaw: string | undefined, now: Date = new Date()): AdsPeriodRange {
  const period: AdsPeriod = periodRaw === 'prev' || periodRaw === 'last30' ? periodRaw : 'current';
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();

  if (period === 'last30') {
    const to = new Date(Date.UTC(y, mo, now.getUTCDate()));
    const from = new Date(to.getTime() - 29 * 86_400_000); // 当日含め直近30日
    return { period, fromDate: ymd(from), toDate: ymd(to) };
  }

  if (period === 'prev') {
    const from = new Date(Date.UTC(y, mo - 1, 1));
    const to = new Date(Date.UTC(y, mo, 0)); // 前月末日
    const yearMonth = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
    return { period, fromDate: ymd(from), toDate: ymd(to), yearMonth };
  }

  // current
  const from = new Date(Date.UTC(y, mo, 1));
  const to = new Date(Date.UTC(y, mo + 1, 0));
  const yearMonth = `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { period, fromDate: ymd(from), toDate: ymd(to), yearMonth };
}

/** 選択期間の直前・同じ日数の比較用ウィンドウ（前月比 MoM 用）。 */
export function previousAdsWindow(range: AdsDateWindow): AdsDateWindow {
  if (!range.yearMonth) {
    // last30 相当: 直前の同じ日数分
    const to = new Date(`${range.fromDate}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() - 1);
    const from = new Date(`${range.fromDate}T00:00:00.000Z`);
    const spanDays = Math.round(
      (new Date(`${range.toDate}T00:00:00.000Z`).getTime() - new Date(`${range.fromDate}T00:00:00.000Z`).getTime()) /
        86_400_000,
    );
    from.setUTCDate(from.getUTCDate() - (spanDays + 1));
    return { fromDate: ymd(from), toDate: ymd(to) };
  }
  // current/prev: 1 ヶ月前
  const anchor = new Date(`${range.fromDate}T00:00:00.000Z`);
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 0));
  const yearMonth = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
  return { fromDate: ymd(from), toDate: ymd(to), yearMonth };
}

// ---------------------------------------------------------------------------
// KPI 集計 (ad_spend 日次合計行から)
// ---------------------------------------------------------------------------

export interface AdsDailyRow {
  ads_date: string;
  spend_jpy: number;
  sales_jpy: number;
  impressions: number;
  clicks: number;
  orders: number;
}

export interface AdsKpi {
  spendJpy: number;
  salesJpy: number;
  /** 広告経由売上 / 広告費。広告費 0 円のときは null。 */
  roas: number | null;
  /** 広告費 / 広告経由売上 (%)。広告経由売上 0 円のときは null。 */
  acosPct: number | null;
  impressions: number;
  clicks: number;
  /** クリック率 (%)。 */
  ctrPct: number | null;
  /** クリック単価 (円)。 */
  cpc: number | null;
  orders: number;
}

export function computeAdsKpi(rows: readonly AdsDailyRow[]): AdsKpi {
  let spendJpy = 0;
  let salesJpy = 0;
  let impressions = 0;
  let clicks = 0;
  let orders = 0;
  for (const r of rows) {
    spendJpy += r.spend_jpy;
    salesJpy += r.sales_jpy;
    impressions += r.impressions;
    clicks += r.clicks;
    orders += r.orders;
  }
  return {
    spendJpy,
    salesJpy,
    roas: spendJpy > 0 ? Math.round((salesJpy / spendJpy) * 100) / 100 : null,
    acosPct: salesJpy > 0 ? Math.round((spendJpy / salesJpy) * 1000) / 10 : null,
    impressions,
    clicks,
    ctrPct: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : null,
    cpc: clicks > 0 ? Math.round(spendJpy / clicks) : null,
    orders,
  };
}

/** current に対する previous の前月比(%)。previous が 0 のときは null (算出不能)。 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ---------------------------------------------------------------------------
// 日次トレンド (直近30日: 広告費 vs 広告経由売上)
// ---------------------------------------------------------------------------

export interface AdsTrendPoint {
  date: string;
  spendJpy: number;
  salesJpy: number;
}

export function buildAdsTrend(rows: readonly AdsDailyRow[]): AdsTrendPoint[] {
  return [...rows]
    .sort((a, b) => a.ads_date.localeCompare(b.ads_date))
    .map((r) => ({ date: r.ads_date, spendJpy: r.spend_jpy, salesJpy: r.sales_jpy }));
}

// ---------------------------------------------------------------------------
// キャンペーン別集計 (ad_campaign_stats の期間内行 → キャンペーン単位に合算)
// ---------------------------------------------------------------------------

export interface AdCampaignStatRaw {
  campaign_id: string;
  campaign_name: string | null;
  campaign_state: string | null;
  budget_jpy: number | null;
  ads_date: string;
  spend_jpy: number;
  sales_jpy: number;
  clicks: number;
  impressions: number;
  orders: number;
}

export interface AdsCampaignRow {
  campaignId: string;
  campaignName: string;
  state: string | null;
  budgetJpy: number | null;
  spendJpy: number;
  salesJpy: number;
  roas: number | null;
  acosPct: number | null;
  clicks: number;
  cpc: number | null;
  impressions: number;
  orders: number;
}

/** 期間内の日次行をキャンペーン単位に合算する。state/budget は最新日の値を採用。 */
export function aggregateCampaignRows(rows: readonly AdCampaignStatRaw[]): AdsCampaignRow[] {
  interface Acc {
    name: string | null;
    state: string | null;
    stateDate: string;
    budget: number | null;
    budgetDate: string;
    spend: number;
    sales: number;
    clicks: number;
    impressions: number;
    orders: number;
  }
  const byId = new Map<string, Acc>();
  for (const r of rows) {
    const cur: Acc = byId.get(r.campaign_id) ?? {
      name: null,
      state: null,
      stateDate: '',
      budget: null,
      budgetDate: '',
      spend: 0,
      sales: 0,
      clicks: 0,
      impressions: 0,
      orders: 0,
    };
    cur.spend += r.spend_jpy;
    cur.sales += r.sales_jpy;
    cur.clicks += r.clicks;
    cur.impressions += r.impressions;
    cur.orders += r.orders;
    if (r.campaign_name) cur.name = r.campaign_name;
    if (r.campaign_state != null && r.ads_date >= cur.stateDate) {
      cur.state = r.campaign_state;
      cur.stateDate = r.ads_date;
    }
    if (r.budget_jpy != null && r.ads_date >= cur.budgetDate) {
      cur.budget = r.budget_jpy;
      cur.budgetDate = r.ads_date;
    }
    byId.set(r.campaign_id, cur);
  }

  const out: AdsCampaignRow[] = [];
  for (const [campaignId, v] of byId) {
    out.push({
      campaignId,
      campaignName: v.name ?? campaignId,
      state: v.state,
      budgetJpy: v.budget,
      spendJpy: v.spend,
      salesJpy: v.sales,
      roas: v.spend > 0 ? Math.round((v.sales / v.spend) * 100) / 100 : null,
      acosPct: v.sales > 0 ? Math.round((v.spend / v.sales) * 1000) / 10 : null,
      clicks: v.clicks,
      cpc: v.clicks > 0 ? Math.round(v.spend / v.clicks) : null,
      impressions: v.impressions,
      orders: v.orders,
    });
  }
  // ROAS 降順 (算出不能 = null は最後)
  return out.sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
}

// ---------------------------------------------------------------------------
// 書籍(ASIN)別集計 (ad_product_stats の期間内行 → ASIN 単位に合算 → books/sales_records と結合)
// ---------------------------------------------------------------------------

export interface AdProductStatRaw {
  asin: string | null;
  spend_jpy: number;
  sales_jpy: number;
  orders: number;
}

export interface AdsBookRow {
  asin: string | null;
  title: string;
  spendJpy: number;
  salesJpy: number;
  orders: number;
  roas: number | null;
  royaltyJpy: number | null;
}

const UNREGISTERED_ASIN_LABEL = '(未登録 ASIN)';

/**
 * ASIN 単位に合算し、書名(bookTitleByAsin)・当月印税(royaltyByAsin)と結合する。
 * books に無い ASIN は `UNREGISTERED_ASIN_LABEL` で表示する。
 */
export function buildAdsBookRows(
  rows: readonly AdProductStatRaw[],
  bookTitleByAsin: ReadonlyMap<string, string>,
  royaltyByAsin: ReadonlyMap<string, number>,
): AdsBookRow[] {
  interface Acc {
    spend: number;
    sales: number;
    orders: number;
  }
  const byAsin = new Map<string, Acc>();
  for (const r of rows) {
    const key = r.asin ?? '';
    const cur = byAsin.get(key) ?? { spend: 0, sales: 0, orders: 0 };
    cur.spend += r.spend_jpy;
    cur.sales += r.sales_jpy;
    cur.orders += r.orders;
    byAsin.set(key, cur);
  }

  const out: AdsBookRow[] = [];
  for (const [asinKey, v] of byAsin) {
    const asin = asinKey === '' ? null : asinKey;
    out.push({
      asin,
      title: asin ? (bookTitleByAsin.get(asin) ?? UNREGISTERED_ASIN_LABEL) : UNREGISTERED_ASIN_LABEL,
      spendJpy: v.spend,
      salesJpy: v.sales,
      orders: v.orders,
      roas: v.spend > 0 ? Math.round((v.sales / v.spend) * 100) / 100 : null,
      royaltyJpy: asin ? (royaltyByAsin.get(asin) ?? null) : null,
    });
  }
  return out.sort((a, b) => b.spendJpy - a.spendJpy);
}

// ---------------------------------------------------------------------------
// 表示フォーマット
// ---------------------------------------------------------------------------

export function formatRoas(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(2)}x`;
}

export function formatPct(value: number | null): string {
  if (value == null) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatMomPct(value: number | null): string {
  if (value == null) return '—';
  return value >= 0 ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('ja-JP');
}
