/**
 * [F-090] Amazon Advertising API v3 クライアント (Sponsored Products の日次費用取得)。
 *
 * フロー: LwA refresh_token → access_token → v3 非同期レポート作成 → ポーリング →
 *   GZIP_JSON ダウンロード → 日次(date)集計。JP マーケットプレイス(region=fe)の cost は JPY。
 *
 * ※ 公式 API のため堅牢だが、実 creds が無いと E2E 検証できない。creds 到着後に 1 回実走で確認する。
 * 参考: https://advertising.amazon.com/API/docs (Reporting v3 / spCampaigns)
 */
import { gunzipSync } from 'node:zlib';

const TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

const REGION_HOSTS: Record<string, string> = {
  na: 'advertising-api.amazon.com',
  eu: 'advertising-api-eu.amazon.com',
  fe: 'advertising-api-fe.amazon.com',
};

export interface AmazonAdsCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  profileId: string;
  region: 'na' | 'eu' | 'fe';
}

export interface DailyAdSpendRow {
  date: string; // "YYYY-MM-DD"
  impressions: number;
  clicks: number;
  spend: number; // マーケットプレイス通貨 (JP=JPY)
  sales: number; // attributed sales
  orders: number;
}

async function refreshAccessToken(creds: AmazonAdsCreds): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`LwA token refresh failed ${res.status}: ${json.error_description ?? ''}`);
  }
  return json.access_token;
}

function adsHeaders(creds: AmazonAdsCreds, accessToken: string, contentType?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    'Amazon-Advertising-API-ClientId': creds.clientId,
    'Amazon-Advertising-API-Scope': creds.profileId,
  };
  if (contentType) h['content-type'] = contentType;
  return h;
}

/** v3 レポート作成 → reportId を返す。 */
async function createReport(host: string, creds: AmazonAdsCreds, accessToken: string, startDate: string, endDate: string): Promise<string> {
  const res = await fetch(`https://${host}/reporting/reports`, {
    method: 'POST',
    headers: adsHeaders(creds, accessToken, 'application/vnd.createasyncreportrequest.v3+json'),
    body: JSON.stringify({
      name: `sp-daily-spend-${startDate}-${endDate}`,
      startDate,
      endDate,
      configuration: {
        adProduct: 'SPONSORED_PRODUCTS',
        groupBy: ['campaign'],
        columns: ['date', 'impressions', 'clicks', 'cost', 'sales14d', 'purchases14d'],
        reportTypeId: 'spCampaigns',
        timeUnit: 'DAILY',
        format: 'GZIP_JSON',
      },
    }),
  });
  const json = (await res.json()) as { reportId?: string; message?: string };
  if (!res.ok || !json.reportId) throw new Error(`createReport failed ${res.status}: ${json.message ?? ''}`);
  return json.reportId;
}

async function getReport(host: string, creds: AmazonAdsCreds, accessToken: string, reportId: string): Promise<{ status: string; url: string | null }> {
  const res = await fetch(`https://${host}/reporting/reports/${reportId}`, {
    method: 'GET',
    headers: adsHeaders(creds, accessToken),
  });
  const json = (await res.json()) as { status?: string; url?: string };
  if (!res.ok) throw new Error(`getReport failed ${res.status}`);
  return { status: json.status ?? 'UNKNOWN', url: json.url ?? null };
}

async function downloadRows(url: string): Promise<Array<Record<string, unknown>>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`report download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  try {
    text = gunzipSync(buf).toString('utf8');
  } catch {
    text = buf.toString('utf8'); // 稀に非圧縮
  }
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 期間の Sponsored Products 費用を日次で取得する。creds が無い/不完全なら null。
 * ポーリングは最大 ~5 分 (10s x 30)。
 */
export async function fetchDailyAdSpend(
  creds: AmazonAdsCreds,
  startDate: string,
  endDate: string,
  sleep: (ms: number) => Promise<void>,
): Promise<DailyAdSpendRow[]> {
  const host = REGION_HOSTS[creds.region] ?? REGION_HOSTS.fe!;
  const accessToken = await refreshAccessToken(creds);
  const reportId = await createReport(host, creds, accessToken, startDate, endDate);
  let url: string | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(10_000);
    const r = await getReport(host, creds, accessToken, reportId);
    if (r.status === 'COMPLETED' && r.url) { url = r.url; break; }
    if (r.status === 'FAILURE' || r.status === 'CANCELLED') throw new Error(`report ${r.status}`);
  }
  if (!url) throw new Error('report did not complete in time');
  const rows = await downloadRows(url);
  // campaign×date の行を date で集計する。
  const byDate = new Map<string, DailyAdSpendRow>();
  for (const row of rows) {
    const date = String(row.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const cur = byDate.get(date) ?? { date, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    cur.impressions += num(row.impressions);
    cur.clicks += num(row.clicks);
    cur.spend += num(row.cost);
    cur.sales += num(row.sales14d);
    cur.orders += num(row.purchases14d);
    byDate.set(date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** env から creds を組み立てる。不足があれば null (=未接続、タスクはスキップ)。 */
export function adsCredsFromEnv(env: Record<string, string | undefined>): AmazonAdsCreds | null {
  const clientId = env.AMAZON_ADS_CLIENT_ID;
  const clientSecret = env.AMAZON_ADS_CLIENT_SECRET;
  const refreshToken = env.AMAZON_ADS_REFRESH_TOKEN;
  const profileId = env.AMAZON_ADS_PROFILE_ID;
  const region = (env.AMAZON_ADS_REGION as 'na' | 'eu' | 'fe' | undefined) ?? 'fe';
  if (!clientId || !clientSecret || !refreshToken || !profileId) return null;
  return { clientId, clientSecret, refreshToken, profileId, region };
}
