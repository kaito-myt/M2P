/**
 * @a2p/credentials — 疎通テスト (ポータル「疎通テスト」ボタンから)。公式 SDK は持ち込まず fetch のみ。
 *   - r2:         HeadBucket (`@a2p/storage` の `testR2Connection`)
 *   - line:       GET https://api.line.me/v2/bot/info (bot 名を返す)
 *   - amazon_ads: LwA refresh_token → access token、続けて /v2/profiles で profile_id の存在確認
 */
import { testR2Connection } from '@a2p/storage/client';

import { toAmazonAdsCredentials, toLineCredentials, toR2Credentials, type AmazonAdsRegion, type ServiceFields, type ServiceProvider } from './spec.js';

export interface ServiceTestResult {
  ok: boolean;
  message: string;
  http_status?: number;
  latency_ms?: number;
}

const TIMEOUT_MS = 15_000;

const LWA_TOKEN_URLS: Record<AmazonAdsRegion, string> = {
  na: 'https://api.amazon.com/auth/o2/token',
  eu: 'https://api.amazon.co.uk/auth/o2/token',
  fe: 'https://api.amazon.co.jp/auth/o2/token',
};
const LWA_TOKEN_URL_FALLBACK = 'https://api.amazon.com/auth/o2/token';
const ADS_HOSTS: Record<AmazonAdsRegion, string> = {
  na: 'advertising-api.amazon.com',
  eu: 'advertising-api-eu.amazon.com',
  fe: 'advertising-api-fe.amazon.com',
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function testLine(fields: ServiceFields, fetchFn: typeof fetch): Promise<ServiceTestResult> {
  const creds = toLineCredentials(fields);
  if (!creds) return { ok: false, message: '必須項目が不足しています' };
  const started = Date.now();
  try {
    const res = await fetchFn('https://api.line.me/v2/bot/info', {
      headers: { authorization: `Bearer ${creds.channelAccessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latency_ms = Date.now() - started;
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}`, http_status: res.status, latency_ms };
    const json = (await res.json().catch(() => ({}))) as { displayName?: string; basicId?: string };
    const name = json.displayName ? ` bot=${json.displayName}${json.basicId ? ` (${json.basicId})` : ''}` : '';
    return { ok: true, message: `疎通 OK (${latency_ms}ms)${name}`, http_status: res.status, latency_ms };
  } catch (err) {
    return { ok: false, message: errMsg(err), latency_ms: Date.now() - started };
  }
}

interface LwaResult {
  ok: boolean;
  status: number;
  token?: string;
  error?: string;
}

async function lwaRefresh(url: string, c: NonNullable<ReturnType<typeof toAmazonAdsCredentials>>, fetchFn: typeof fetch): Promise<LwaResult> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  return { ok: res.ok && !!json.access_token, status: res.status, token: json.access_token, error: json.error_description ?? json.error };
}

async function testAmazonAds(fields: ServiceFields, fetchFn: typeof fetch): Promise<ServiceTestResult> {
  const creds = toAmazonAdsCredentials(fields);
  if (!creds) return { ok: false, message: '必須項目が不足しています' };
  const started = Date.now();
  try {
    const primary = LWA_TOKEN_URLS[creds.region] ?? LWA_TOKEN_URL_FALLBACK;
    let tok: LwaResult = await lwaRefresh(primary, creds, fetchFn).catch((err: unknown) => ({ ok: false, status: 0, error: errMsg(err) }));
    if (!tok.ok && primary !== LWA_TOKEN_URL_FALLBACK) tok = await lwaRefresh(LWA_TOKEN_URL_FALLBACK, creds, fetchFn);
    if (!tok.ok || !tok.token) {
      return { ok: false, message: `LwA トークン更新に失敗: HTTP ${tok.status} ${tok.error ?? ''}`.trim(), http_status: tok.status, latency_ms: Date.now() - started };
    }
    const res = await fetchFn(`https://${ADS_HOSTS[creds.region]}/v2/profiles`, {
      headers: { authorization: `Bearer ${tok.token}`, 'Amazon-Advertising-API-ClientId': creds.clientId },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const latency_ms = Date.now() - started;
    if (!res.ok) return { ok: false, message: `トークンは有効ですが /v2/profiles が HTTP ${res.status}`, http_status: res.status, latency_ms };
    const profiles = (await res.json().catch(() => [])) as Array<{ profileId?: number | string; countryCode?: string; accountInfo?: { name?: string } }>;
    const match = Array.isArray(profiles) ? profiles.find((p) => String(p.profileId) === creds.profileId) : undefined;
    if (!match) {
      return {
        ok: false,
        message: `トークンは有効ですが profile_id=${creds.profileId} が見つかりません (候補: ${Array.isArray(profiles) ? profiles.map((p) => `${p.profileId}/${p.countryCode ?? '?'}`).join(', ') || 'なし' : '不明'})`,
        http_status: res.status,
        latency_ms,
      };
    }
    const label = [match.countryCode, match.accountInfo?.name].filter(Boolean).join(' ');
    return { ok: true, message: `疎通 OK (${latency_ms}ms)${label ? ` profile=${label}` : ''}`, http_status: res.status, latency_ms };
  } catch (err) {
    return { ok: false, message: errMsg(err), latency_ms: Date.now() - started };
  }
}

export interface TestServiceDeps {
  fetch?: typeof fetch;
  testR2?: typeof testR2Connection;
}

/** provider の資格情報 (項目 JSON) で疎通テストを行う。例外は投げず結果に畳む。 */
export async function testServiceCredentials(provider: ServiceProvider, fields: ServiceFields, deps: TestServiceDeps = {}): Promise<ServiceTestResult> {
  const fetchFn = deps.fetch ?? fetch;
  switch (provider) {
    case 'r2': {
      const creds = toR2Credentials(fields);
      if (!creds) return { ok: false, message: '必須項目が不足しています' };
      const r = await (deps.testR2 ?? testR2Connection)(creds);
      return { ok: r.ok, message: r.ok ? `${r.message} (${r.latency_ms}ms)` : r.message, latency_ms: r.latency_ms };
    }
    case 'line':
      return testLine(fields, fetchFn);
    case 'amazon_ads':
      return testAmazonAds(fields, fetchFn);
  }
}
