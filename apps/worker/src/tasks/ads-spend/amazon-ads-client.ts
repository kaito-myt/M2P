/**
 * [F-090 / F-090拡張] Amazon Advertising API v3 クライアント。
 *
 * フロー: LwA refresh_token → access_token → v3 非同期レポート作成 → ポーリング →
 *   GZIP_JSON ダウンロード → 型付き行への変換 (`ads-report-transform.ts`)。
 *   JP マーケットプレイス(region=fe)の cost/sales は JPY。
 *
 * 2026-09-21 拡張: 広告パフォーマンス取込 (キャンペーン別/書籍(ASIN)別)。
 *   - `spCampaigns`(campaign 粒度) から日次合計(ad_spend, 既存挙動)とキャンペーン別内訳(ad_campaign_stats)の
 *     両方を 1 リクエストから導出する。
 *   - `spAdvertisedProduct` で ASIN 別内訳(ad_product_stats)を取得。
 *   - `POST /sp/campaigns/list` でキャンペーンのメタ(name/state/budget)を取得。
 *   - SB/SD (`sbCampaigns`/`sdCampaigns`) は KDP 著者アカウントでは権限が無い場合があるため best-effort
 *     (呼び出し側が try/catch して warn ログで skip する設計。カラム名は SP と同型と仮定した未検証実装
 *     — 実 creds 到着後に 1 回実走して確認すること)。
 *
 * 参考: https://advertising.amazon.com/API/docs (Reporting v3 / SP Campaigns API v3)
 * ※ ページが JS 描画のため curl 等では読めない。ドキュメント記載の事実は docs/05 §追加 DB テーブルに転記済み。
 */
import { gunzipSync } from 'node:zlib';

export type AdsRegion = 'na' | 'eu' | 'fe';
export type AdProductKind = 'SP' | 'SB' | 'SD';

/**
 * LwA 認可コード交換/リフレッシュのトークン URL。region ごとに別ドメインがある
 * (日本=fe は api.amazon.co.jp)。region 別 URL が失敗した場合は `api.amazon.com` へ
 * フォールバックする (どちらが正か不確実な運用者環境があるための保険)。
 */
const TOKEN_HOSTS: Record<AdsRegion, string> = {
  na: 'https://api.amazon.com/auth/o2/token',
  eu: 'https://api.amazon.co.uk/auth/o2/token',
  fe: 'https://api.amazon.co.jp/auth/o2/token',
};
const TOKEN_URL_FALLBACK = 'https://api.amazon.com/auth/o2/token';

const REGION_HOSTS: Record<AdsRegion, string> = {
  na: 'advertising-api.amazon.com',
  eu: 'advertising-api-eu.amazon.com',
  fe: 'advertising-api-fe.amazon.com',
};

const AD_PRODUCT_CONFIG: Record<AdProductKind, { adProduct: string; campaignReportTypeId: string }> = {
  SP: { adProduct: 'SPONSORED_PRODUCTS', campaignReportTypeId: 'spCampaigns' },
  SB: { adProduct: 'SPONSORED_BRANDS', campaignReportTypeId: 'sbCampaigns' },
  SD: { adProduct: 'SPONSORED_DISPLAY', campaignReportTypeId: 'sdCampaigns' },
};

export interface AmazonAdsCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: AdsRegion;
}

// ---------------------------------------------------------------------------
// LwA アクセストークン
// ---------------------------------------------------------------------------

interface TokenResult {
  ok: boolean;
  status: number;
  accessToken?: string;
  errorDescription?: string;
}

async function requestAccessToken(url: string, creds: AmazonAdsCreds): Promise<TokenResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  return {
    ok: res.ok && !!json.access_token,
    status: res.status,
    accessToken: json.access_token,
    errorDescription: json.error_description,
  };
}

/** region 別トークン URL → 失敗時は api.amazon.com へ 1 度だけフォールバック。 */
async function refreshAccessToken(creds: AmazonAdsCreds): Promise<string> {
  const primaryUrl = TOKEN_HOSTS[creds.region] ?? TOKEN_URL_FALLBACK;
  let result: TokenResult;
  try {
    result = await requestAccessToken(primaryUrl, creds);
  } catch (err) {
    result = { ok: false, status: 0, errorDescription: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok && primaryUrl !== TOKEN_URL_FALLBACK) {
    try {
      result = await requestAccessToken(TOKEN_URL_FALLBACK, creds);
    } catch (err) {
      throw new Error(
        `LwA token refresh failed on both ${primaryUrl} and fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (!result.ok || !result.accessToken) {
    throw new Error(`LwA token refresh failed ${result.status}: ${result.errorDescription ?? ''}`);
  }
  return result.accessToken;
}

function adsHeaders(creds: AmazonAdsCreds, accessToken: string, contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': creds.profileId,
  };
  if (contentType) {
    h['content-type'] = contentType;
    h.accept = contentType;
  }
  return h;
}

// ---------------------------------------------------------------------------
// Reporting v3 (非同期レポート作成 → ポーリング → ダウンロード)
// ---------------------------------------------------------------------------

export interface CreateReportConfig {
  adProduct: string;
  reportTypeId: string;
  groupBy: string[];
  columns: string[];
}

async function createReport(
  host: string,
  creds: AmazonAdsCreds,
  accessToken: string,
  startDate: string,
  endDate: string,
  config: CreateReportConfig,
): Promise<string> {
  const res = await fetch(`https://${host}/reporting/reports`, {
    method: 'POST',
    headers: adsHeaders(creds, accessToken, 'application/vnd.createasyncreportrequest.v3+json'),
    body: JSON.stringify({
      name: `${config.reportTypeId}-${startDate}-${endDate}`,
      startDate,
      endDate,
      configuration: {
        adProduct: config.adProduct,
        groupBy: config.groupBy,
        columns: config.columns,
        reportTypeId: config.reportTypeId,
        timeUnit: 'DAILY',
        format: 'GZIP_JSON',
      },
    }),
  });
  const json = (await res.json()) as { reportId?: string; message?: string };
  if (!res.ok || !json.reportId) {
    throw new Error(`createReport(${config.reportTypeId}) failed ${res.status}: ${json.message ?? ''}`);
  }
  return json.reportId;
}

async function getReportStatus(
  host: string,
  creds: AmazonAdsCreds,
  accessToken: string,
  reportId: string,
): Promise<{ status: string; url: string | null }> {
  const res = await fetch(`https://${host}/reporting/reports/${reportId}`, {
    method: 'GET',
    headers: adsHeaders(creds, accessToken),
  });
  const json = (await res.json()) as { status?: string; url?: string };
  if (!res.ok) throw new Error(`getReport failed ${res.status}`);
  return { status: json.status ?? 'UNKNOWN', url: json.url ?? null };
}

async function downloadReportRows(url: string): Promise<unknown[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`report download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = gunzipSync(buf).toString('utf8');
  } catch {
    text = buf.toString('utf8'); // 稀に非圧縮
  }
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * 非同期レポートを作成 → 完了までポーリング(最大 ~5 分, 10s x 30) → ダウンロードして
 * 生の行配列(未パース)を返す。パースは呼び出し側で `ads-report-transform.ts` を使う。
 */
export async function fetchReportRows(
  creds: AmazonAdsCreds,
  startDate: string,
  endDate: string,
  config: CreateReportConfig,
  sleep: (ms: number) => Promise<void>,
): Promise<unknown[]> {
  const host = REGION_HOSTS[creds.region] ?? REGION_HOSTS.fe;
  const accessToken = await refreshAccessToken(creds);
  const reportId = await createReport(host, creds, accessToken, startDate, endDate, config);
  let url: string | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(10_000);
    const r = await getReportStatus(host, creds, accessToken, reportId);
    if (r.status === 'COMPLETED' && r.url) {
      url = r.url;
      break;
    }
    if (r.status === 'FAILURE' || r.status === 'CANCELLED') throw new Error(`report ${r.status}`);
  }
  if (!url) throw new Error('report did not complete in time');
  return downloadReportRows(url);
}

const SP_CAMPAIGN_COLUMNS = [
  'date',
  'campaignId',
  'campaignName',
  'campaignStatus',
  'impressions',
  'clicks',
  'cost',
  'sales14d',
  'purchases14d',
];

const SP_PRODUCT_COLUMNS = [
  'date',
  'campaignId',
  'campaignName',
  'adGroupId',
  'adGroupName',
  'advertisedAsin',
  'advertisedSku',
  'impressions',
  'clicks',
  'cost',
  'sales14d',
  'purchases14d',
  'unitsSoldClicks14d',
];

/** キャンペーン粒度 (spCampaigns / best-effort sbCampaigns・sdCampaigns) の生レポート行を返す。 */
export function campaignReportConfig(kind: AdProductKind): CreateReportConfig {
  const c = AD_PRODUCT_CONFIG[kind];
  return { adProduct: c.adProduct, reportTypeId: c.campaignReportTypeId, groupBy: ['campaign'], columns: SP_CAMPAIGN_COLUMNS };
}

/** ASIN 粒度 (spAdvertisedProduct) の生レポート行を返す。SP のみ (F-090拡張の対象は SP)。 */
export function productReportConfig(): CreateReportConfig {
  return {
    adProduct: AD_PRODUCT_CONFIG.SP.adProduct,
    reportTypeId: 'spAdvertisedProduct',
    groupBy: ['advertiser'],
    columns: SP_PRODUCT_COLUMNS,
  };
}

// ---------------------------------------------------------------------------
// キャンペーン一覧 (name/state/budget メタ, SP のみ)
// ---------------------------------------------------------------------------

const CAMPAIGNS_LIST_CONTENT_TYPE = 'application/vnd.spCampaign.v3+json';
const MAX_CAMPAIGNS_LIST_PAGES = 10;

/** `POST /sp/campaigns/list` を nextToken でページングしながら全件取得する (最大 10 ページ)。 */
export async function fetchCampaignsListRaw(
  creds: AmazonAdsCreds,
  sleep: (ms: number) => Promise<void>,
): Promise<unknown[]> {
  const host = REGION_HOSTS[creds.region] ?? REGION_HOSTS.fe;
  const accessToken = await refreshAccessToken(creds);
  const pages: unknown[] = [];
  let nextToken: string | undefined;
  for (let i = 0; i < MAX_CAMPAIGNS_LIST_PAGES; i++) {
    const res = await fetch(`https://${host}/sp/campaigns/list`, {
      method: 'POST',
      headers: adsHeaders(creds, accessToken, CAMPAIGNS_LIST_CONTENT_TYPE),
      body: JSON.stringify(nextToken ? { maxResults: 100, nextToken } : { maxResults: 100 }),
    });
    const json = (await res.json()) as { campaigns?: unknown[]; nextToken?: string; message?: string };
    if (!res.ok) throw new Error(`sp/campaigns/list failed ${res.status}: ${json.message ?? ''}`);
    pages.push(json);
    if (!json.nextToken) break;
    nextToken = json.nextToken;
    if (i < MAX_CAMPAIGNS_LIST_PAGES - 1) await sleep(200);
  }
  return pages;
}

// ---------------------------------------------------------------------------
// プロファイル通貨 (best-effort。取得できなければ region 既定通貨にフォールバック)
// ---------------------------------------------------------------------------

const REGION_DEFAULT_CURRENCY: Record<AdsRegion, string> = { na: 'USD', eu: 'EUR', fe: 'JPY' };

/**
 * `GET /v2/profiles` から対象 profileId の `currencyCode` を取得する。
 * JP マーケットプレイス(region=fe)は常に JPY のはずだが、取得失敗時/未一致時は
 * region 既定通貨(fe=JPY)へ安全側フォールバックする(非致命)。
 */
export async function fetchProfileCurrency(creds: AmazonAdsCreds): Promise<string> {
  const host = REGION_HOSTS[creds.region] ?? REGION_HOSTS.fe;
  const fallback = REGION_DEFAULT_CURRENCY[creds.region] ?? 'JPY';
  try {
    const accessToken = await refreshAccessToken(creds);
    const res = await fetch(`https://${host}/v2/profiles`, { headers: adsHeaders(creds, accessToken) });
    if (!res.ok) return fallback;
    const json = (await res.json()) as Array<{ profileId?: number | string; currencyCode?: string }>;
    if (!Array.isArray(json)) return fallback;
    const match = json.find((p) => String(p.profileId) === creds.profileId);
    return match?.currencyCode ?? fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// env → creds
// ---------------------------------------------------------------------------

/** env から creds を組み立てる。不足があれば null (=未接続、タスクはスキップ)。 */
export function adsCredsFromEnv(env: Record<string, string | undefined>): AmazonAdsCreds | null {
  const clientId = env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = env.AMAZON_ADS_CLIENT_SECRET;
  const refreshToken = env.AMAZON_ADS_REFRESH_TOKEN;
  const profileId = env.AMAZON_ADS_PROFILE_ID;
  const region = (env.AMAZON_ADS_REGION as AdsRegion | undefined) ?? 'fe';
  if (!clientId || !clientSecret || !refreshToken || !profileId) return null;
  return { clientId, clientSecret, refreshToken, profileId, region };
}
