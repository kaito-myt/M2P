/**
 * [F-090拡張] Amazon Ads レポート/キャンペーン一覧のレスポンスを DB 行に変換する純関数群。
 *
 * `amazon-ads-client.ts` が HTTP I/O を担い、本モジュールは JSON→型付き行への変換と
 * 集計だけを行う（ネットワーク非依存・Vitest で直接テスト可能）。
 */

export function toAdsNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// spCampaigns (campaign 粒度) レポート行
// ---------------------------------------------------------------------------

export interface SpCampaignRow {
  date: string;
  campaignId: string;
  campaignName: string | null;
  impressions: number;
  clicks: number;
  cost: number; // マーケットプレイス通貨
  sales: number; // sales14d, マーケットプレイス通貨
  orders: number; // purchases14d
}

/** `spCampaigns` (groupBy campaign) レポートの GZIP_JSON 配列を型付き行に変換する。 */
export function parseSpCampaignReportRows(raw: unknown): SpCampaignRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SpCampaignRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const date = String(row.date ?? '').slice(0, 10);
    const campaignId = row.campaignId != null ? String(row.campaignId) : '';
    if (!DATE_RE.test(date) || !campaignId) continue;
    out.push({
      date,
      campaignId,
      campaignName: row.campaignName != null ? String(row.campaignName) : null,
      impressions: toAdsNumber(row.impressions),
      clicks: toAdsNumber(row.clicks),
      cost: toAdsNumber(row.cost),
      sales: toAdsNumber(row.sales14d),
      orders: toAdsNumber(row.purchases14d),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// spAdvertisedProduct (ASIN 粒度) レポート行
// ---------------------------------------------------------------------------

export interface SpProductRow {
  date: string;
  campaignId: string;
  adGroupId: string | null;
  asin: string | null;
  sku: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  sales: number;
  orders: number;
  units: number;
}

/** `spAdvertisedProduct` レポートの GZIP_JSON 配列を型付き行に変換する。 */
export function parseSpProductReportRows(raw: unknown): SpProductRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SpProductRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const date = String(row.date ?? '').slice(0, 10);
    const campaignId = row.campaignId != null ? String(row.campaignId) : '';
    if (!DATE_RE.test(date) || !campaignId) continue;
    out.push({
      date,
      campaignId,
      adGroupId: row.adGroupId != null ? String(row.adGroupId) : null,
      asin: row.advertisedAsin != null ? String(row.advertisedAsin) : null,
      sku: row.advertisedSku != null ? String(row.advertisedSku) : null,
      impressions: toAdsNumber(row.impressions),
      clicks: toAdsNumber(row.clicks),
      cost: toAdsNumber(row.cost),
      sales: toAdsNumber(row.sales14d),
      orders: toAdsNumber(row.purchases14d),
      units: toAdsNumber(row.unitsSoldClicks14d),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// ad_spend (日次合計) — 既存 F-090 挙動と同一の集計。
// ---------------------------------------------------------------------------

export interface DailyAdSpendRow {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

/** campaign 粒度の行を date で合算する（既存 `ad_spend` の集計と同じ挙動）。 */
export function aggregateDailySpend(rows: SpCampaignRow[]): DailyAdSpendRow[] {
  const byDate = new Map<string, DailyAdSpendRow>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { date: r.date, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    cur.spend += r.cost;
    cur.sales += r.sales;
    cur.orders += r.orders;
    byDate.set(r.date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// /sp/campaigns/list メタデータ
// ---------------------------------------------------------------------------

export interface CampaignMeta {
  campaignId: string;
  name: string | null;
  state: string | null;
  budget: number | null; // マーケットプレイス通貨、日予算
}

/** `POST /sp/campaigns/list` レスポンスを型付き配列に変換する。 */
export function parseCampaignsListResponse(raw: unknown): CampaignMeta[] {
  if (!raw || typeof raw !== 'object') return [];
  const arr = (raw as Record<string, unknown>).campaigns;
  if (!Array.isArray(arr)) return [];
  const out: CampaignMeta[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const campaignId = row.campaignId != null ? String(row.campaignId) : '';
    if (!campaignId) continue;
    const budgetObj = row.budget && typeof row.budget === 'object' ? (row.budget as Record<string, unknown>) : null;
    const budget = budgetObj?.budget;
    out.push({
      campaignId,
      name: row.name != null ? String(row.name) : null,
      state: row.state != null ? String(row.state) : null,
      budget: budget != null ? toAdsNumber(budget) : null,
    });
  }
  return out;
}

/** ページネーション用 nextToken を抽出する（無ければ null）。 */
export function extractNextToken(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = (raw as Record<string, unknown>).nextToken;
  return typeof t === 'string' && t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// 期間分割 (Reporting v3 DAILY は 1 リクエスト最大 31 日)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `startISO`〜`endISO` (両端含む, "YYYY-MM-DD") を最大 `maxDays` 日ずつのチャンクに分割する。 */
export function chunkDateRange(
  startISO: string,
  endISO: string,
  maxDays = 31,
): Array<{ start: string; end: string }> {
  const start = new Date(`${startISO}T00:00:00.000Z`);
  const end = new Date(`${endISO}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > end.getTime()) {
    return [];
  }
  const span = Math.max(1, maxDays);
  const chunks: Array<{ start: string; end: string }> = [];
  let cursor = start.getTime();
  const endTime = end.getTime();
  while (cursor <= endTime) {
    const chunkEndTime = Math.min(cursor + (span - 1) * DAY_MS, endTime);
    chunks.push({ start: toYmd(new Date(cursor)), end: toYmd(new Date(chunkEndTime)) });
    cursor = chunkEndTime + DAY_MS;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// 通貨換算 (JP マーケットプレイスは常時 JPY 想定。非 JPY の保険として latest_fx_rate で換算)
// ---------------------------------------------------------------------------

const FALLBACK_FX_USD_JPY = 150;

/** `currency` が JPY 以外なら `fxRateUsdJpy`(既定150) で円換算する。JPY はそのまま。 */
export function toJpy(amount: number, currency: string, fxRateUsdJpy: number | null): number {
  if (!currency || currency.toUpperCase() === 'JPY') return amount;
  const rate = fxRateUsdJpy != null && fxRateUsdJpy > 0 ? fxRateUsdJpy : FALLBACK_FX_USD_JPY;
  return amount * rate;
}

// ---------------------------------------------------------------------------
// ad_campaign_stats / ad_product_stats へ upsert する行の組み立て
// ---------------------------------------------------------------------------

export interface CampaignStatUpsertRow {
  date: string;
  campaignId: string;
  campaignName: string | null;
  /** campaigns/list で取得したメタ。当該キャンペーンの最新日行にのみ設定する。 */
  campaignState: string | null;
  budgetJpy: number | null;
  impressions: number;
  clicks: number;
  spendJpy: number;
  salesJpy: number;
  orders: number;
  amountOriginal: number | null;
  currency: string;
}

/**
 * campaign 粒度のレポート行 + campaigns/list メタを ad_campaign_stats 用の行に組み立てる。
 * campaign_state / budget_jpy は「実装してほしいこと」の指示どおり、各キャンペーンの
 * 最新日 (このバッチで最も新しい ads_date) の行にのみ反映する。
 */
export function buildCampaignStatRows(
  rows: SpCampaignRow[],
  meta: CampaignMeta[],
  currency: string,
  fxRateUsdJpy: number | null,
): CampaignStatUpsertRow[] {
  const metaById = new Map(meta.map((m) => [m.campaignId, m]));
  const latestDateByCampaign = new Map<string, string>();
  for (const r of rows) {
    const cur = latestDateByCampaign.get(r.campaignId);
    if (!cur || r.date > cur) latestDateByCampaign.set(r.campaignId, r.date);
  }
  const isJpy = !currency || currency.toUpperCase() === 'JPY';
  return rows.map((r) => {
    const isLatest = latestDateByCampaign.get(r.campaignId) === r.date;
    const m = metaById.get(r.campaignId);
    return {
      date: r.date,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? m?.name ?? null,
      campaignState: isLatest ? (m?.state ?? null) : null,
      budgetJpy: isLatest && m?.budget != null ? Math.round(toJpy(m.budget, currency, fxRateUsdJpy)) : null,
      impressions: Math.round(r.impressions),
      clicks: Math.round(r.clicks),
      spendJpy: Math.round(toJpy(r.cost, currency, fxRateUsdJpy)),
      salesJpy: Math.round(toJpy(r.sales, currency, fxRateUsdJpy)),
      orders: Math.round(r.orders),
      amountOriginal: isJpy ? null : r.cost,
      currency: isJpy ? 'JPY' : currency,
    };
  });
}

export interface ProductStatUpsertRow {
  date: string;
  campaignId: string;
  adGroupId: string | null;
  asin: string | null;
  sku: string | null;
  impressions: number;
  clicks: number;
  spendJpy: number;
  salesJpy: number;
  orders: number;
  units: number;
  amountOriginal: number | null;
  currency: string;
}

/** ASIN 粒度のレポート行を ad_product_stats 用の行に組み立てる（通貨換算込み）。 */
export function buildProductStatRows(
  rows: SpProductRow[],
  currency: string,
  fxRateUsdJpy: number | null,
): ProductStatUpsertRow[] {
  const isJpy = !currency || currency.toUpperCase() === 'JPY';
  return rows.map((r) => ({
    date: r.date,
    campaignId: r.campaignId,
    adGroupId: r.adGroupId,
    asin: r.asin,
    sku: r.sku,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    spendJpy: Math.round(toJpy(r.cost, currency, fxRateUsdJpy)),
    salesJpy: Math.round(toJpy(r.sales, currency, fxRateUsdJpy)),
    orders: Math.round(r.orders),
    units: Math.round(r.units),
    amountOriginal: isJpy ? null : r.cost,
    currency: isJpy ? 'JPY' : currency,
  }));
}
