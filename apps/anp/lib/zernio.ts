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
