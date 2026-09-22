/**
 * Zernio (getlate) の接続アカウント一覧 (F-ANP-33)。Instagram / TikTok の投稿は worker が Zernio 経由で行うため、
 * ANP の販促施策画面では「どの Zernio アカウントに投稿するか」を note アカウントごとに選ばせる。
 * API キーは env `ZERNIO_API_KEY` (worker と同じ)。未設定なら空配列 (UI は手入力にフォールバック)。
 */
export interface ZernioAccountView {
  id: string;
  platform: string;
  label: string;
  profileUrl: string | null;
  needsReconnection: boolean;
}

interface ZernioAccountRaw {
  _id?: string;
  platform?: string;
  username?: string;
  displayName?: string;
  name?: string;
  profileUrl?: string | null;
  needsReconnection?: boolean;
}

const ZERNIO_API_BASE = 'https://zernio.com/api/v1';

export function isZernioConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return typeof env.ZERNIO_API_KEY === 'string' && env.ZERNIO_API_KEY.length > 0;
}

/** ANP の媒体 → Zernio platform 名 (X は 'twitter')。 */
export function zernioPlatformOf(channel: 'x' | 'instagram' | 'tiktok'): 'twitter' | 'instagram' | 'tiktok' {
  return channel === 'x' ? 'twitter' : channel;
}

export async function listZernioAccounts(
  channel?: 'x' | 'instagram' | 'tiktok',
  deps: { fetch?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<ZernioAccountView[]> {
  const platform = channel ? zernioPlatformOf(channel) : undefined;
  const env = deps.env ?? process.env;
  const apiKey = env.ZERNIO_API_KEY;
  if (!apiKey) return [];
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(`${ZERNIO_API_BASE}/accounts`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`zernio GET /accounts ${res.status}`);
  const json = (await res.json()) as { accounts?: ZernioAccountRaw[] };
  return (json.accounts ?? [])
    .filter((a): a is ZernioAccountRaw & { _id: string; platform: string } => typeof a._id === 'string' && typeof a.platform === 'string')
    .filter((a) => !platform || a.platform === platform)
    .map((a) => ({
      id: a._id,
      platform: a.platform,
      label: a.username ? `@${a.username.replace(/^@/, '')}` : a.displayName || a.name || a.profileUrl || a._id,
      profileUrl: a.profileUrl ?? null,
      needsReconnection: a.needsReconnection === true,
    }));
}

// ---------------------------------------------------------------------------
// F-ANP-33c — ANP から Zernio のアカウント接続 (OAuth) を開始する
//   GET /v1/connect/{platform}?profileId&redirect_url → authUrl (docs.zernio.com/guides/connecting-accounts)。
//   認可後、Zernio が redirect_url に `connected, profileId, accountId, username` を付けて戻す (既存クエリは保持)。
//   profile は note アカウントごとに 1 つ (名前で一意、409 なら existingProfileId を再利用)。
// ---------------------------------------------------------------------------

export function zernioProfileNameFor(noteAccount: { id: string; display_name: string }): string {
  return `ANP ${noteAccount.display_name} (${noteAccount.id.slice(-6)})`;
}

async function zernioFetch(path: string, init: RequestInit, env: Record<string, string | undefined>): Promise<Response> {
  const apiKey = env.ZERNIO_API_KEY;
  if (!apiKey) throw new Error('ZERNIO_API_KEY is not configured');
  return fetch(`${ZERNIO_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

/** 名前で profile を取得、無ければ作成して id を返す。 */
export async function ensureZernioProfile(name: string, env: Record<string, string | undefined> = process.env): Promise<string> {
  const list = await zernioFetch(`/profiles?name=${encodeURIComponent(name)}`, { method: 'GET' }, env);
  if (list.ok) {
    const json = (await list.json()) as { profiles?: Array<{ _id?: string; name?: string }> };
    const hit = (json.profiles ?? []).find((p) => p.name === name && typeof p._id === 'string');
    if (hit?._id) return hit._id;
  }
  const created = await zernioFetch('/profiles', { method: 'POST', body: JSON.stringify({ name, description: 'M2P ANP note アカウント用 (自動作成)' }) }, env);
  if (created.status === 409) {
    const json = (await created.json().catch(() => ({}))) as { details?: { existingProfileId?: string } };
    if (json.details?.existingProfileId) return json.details.existingProfileId;
  }
  if (!created.ok) throw new Error(`zernio POST /profiles ${created.status}`);
  const json = (await created.json()) as { profile?: { _id?: string } };
  if (!json.profile?._id) throw new Error('zernio POST /profiles: no profile id');
  return json.profile._id;
}

/** OAuth 開始 URL を取得する。 */
export async function getZernioConnectUrl(
  channel: 'x' | 'instagram' | 'tiktok',
  profileId: string,
  redirectUrl: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const platform = zernioPlatformOf(channel);
  const q = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const res = await zernioFetch(`/connect/${platform}?${q.toString()}`, { method: 'GET' }, env);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`zernio GET /connect/${platform} ${res.status} ${text.slice(0, 200)}`.trim());
  }
  const json = (await res.json()) as { authUrl?: string };
  if (!json.authUrl) throw new Error('zernio connect: authUrl missing');
  return json.authUrl;
}
