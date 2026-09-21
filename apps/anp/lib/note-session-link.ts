/**
 * note アカウント連携 (F-ANP-20, docs/11-anp-design.md §3.1/§7) — Cookie 貼り付けによるセッション取込。
 *
 * 運営者要望 (2026-09-21)「アカウント戦略 → note でアカウント作成 → ANP 側から note のアカウントを
 * 連携できるようにして」への対応。note のログインは reCAPTCHA があるためサーバー側で自動ログイン
 * できない (docs/11 §2.1)。そこで、運営者がブラウザで note にログインした状態の Cookie
 * (`note_gql_auth_token` 等) を ANP の画面に貼り付け、それを Playwright の storageState 形式に
 * 組み立てて `note_accounts.session_state_enc` に保存する (ローカルスクリプト
 * `scripts/anp/note-session-capture.mjs` と同じ保存形式・同じ暗号鍵)。
 *
 * 保存前に `GET https://note.com/api/v2/current_user` を Cookie 付きで叩いてログイン状態を検証し、
 * `urlname` (= note ハンドル) と `nickname` を取得して `note_accounts.handle` に反映する。
 * この API は未認証だと 401 `{"data":"認証に失敗しました"}` を返す (2026-09-21 実測)。
 *
 * このモジュールは DB/暗号に触れない純関数 + fetch のみ (Server Action `linkNoteAccountSession` から使う)。
 */

/** note のログイン判定に必須の Cookie。GraphQL/REST API の認証トークン。 */
export const NOTE_AUTH_COOKIE = 'note_gql_auth_token';
/** あると望ましい Cookie (Web セッション)。無くても API 認証は通る。 */
export const NOTE_OPTIONAL_COOKIES = ['_note_session_v5', 'note_gql_auth_token_v2'] as const;
/** 取り込む Cookie の許可リスト (値が長すぎる無関係 Cookie や広告系を落とす)。 */
const NOTE_COOKIE_ALLOW = new Set<string>([NOTE_AUTH_COOKIE, ...NOTE_OPTIONAL_COOKIES, 'XSRF-TOKEN', 'note_lsid']);

export const NOTE_CURRENT_USER_URL = 'https://note.com/api/v2/current_user';

export type NoteCookieMap = Record<string, string>;

/**
 * 貼り付けテキストから note の Cookie を抜き出す。受け付ける形:
 *   1. `name=value; name2=value2` (Cookie ヘッダ / document.cookie 形式)
 *   2. 1 行 1 件の `name<TAB>value` または `name=value` (DevTools のテーブルをコピーした形)
 *   3. トークン値だけ (`=` を含まない 1 行) → `note_gql_auth_token` として扱う
 */
export function parseNoteCookies(input: string): NoteCookieMap {
  const out: NoteCookieMap = {};
  const text = (input ?? '').trim();
  if (!text) return out;

  const put = (name: string, value: string) => {
    const n = name.trim();
    const v = value.trim().replace(/^"|"$/g, '');
    if (!n || !v) return;
    if (!NOTE_COOKIE_ALLOW.has(n)) return;
    out[n] = v;
  };

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 1 && !lines[0]!.includes('=') && !lines[0]!.includes('\t') && !lines[0]!.includes(';')) {
    // 3. トークン値だけ
    put(NOTE_AUTH_COOKIE, lines[0]!);
    return out;
  }

  for (const line of lines) {
    // `Cookie:` プレフィックス付きのヘッダ丸ごと貼り付けにも対応。
    const body = line.replace(/^cookie:\s*/i, '');
    if (body.includes(';') || (body.includes('=') && !body.includes('\t'))) {
      for (const pair of body.split(';')) {
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        put(pair.slice(0, eq), pair.slice(eq + 1));
      }
      continue;
    }
    // 2. DevTools テーブル (name \t value \t domain ...)
    const cols = body.split('\t');
    if (cols.length >= 2) put(cols[0]!, cols[1]!);
  }
  return out;
}

export interface NoteStorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface NoteStorageState {
  cookies: NoteStorageStateCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/**
 * Cookie マップ → Playwright storageState。domain は `.note.com` (note.com / editor.note.com の両方で
 * 送られる)。expires=-1 はセッション Cookie 扱い (Playwright は期限切れ判定をしない)。
 */
export function buildNoteStorageState(cookies: NoteCookieMap): NoteStorageState {
  const list: NoteStorageStateCookie[] = Object.entries(cookies).map(([name, value]) => ({
    name,
    value,
    domain: '.note.com',
    path: '/',
    expires: -1,
    httpOnly: name !== 'XSRF-TOKEN',
    secure: true,
    sameSite: 'Lax',
  }));
  return { cookies: list, origins: [] };
}

export function toCookieHeader(cookies: NoteCookieMap): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export type VerifyNoteSessionResult =
  | { ok: true; urlname: string; nickname: string; userId: string | null }
  | { ok: false; reason: 'unauthorized' | 'network' | 'unexpected'; message: string };

/**
 * Cookie でログイン状態を検証し、note のユーザー情報を返す。
 * `GET /api/v2/current_user` は `{ data: { id, urlname, nickname, ... } }` を返す想定
 * (未認証は 401)。レスポンス形が想定と違っても `urlname` が拾えれば OK とする。
 */
export async function verifyNoteSession(
  cookies: NoteCookieMap,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyNoteSessionResult> {
  let res: Response;
  try {
    res = await fetchImpl(NOTE_CURRENT_USER_URL, {
      method: 'GET',
      headers: {
        cookie: toCookieHeader(cookies),
        accept: 'application/json',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, reason: 'network', message: err instanceof Error ? err.message : String(err) };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: 'unauthorized', message: `note API ${res.status}` };
  }
  if (!res.ok) {
    return { ok: false, reason: 'unexpected', message: `note API ${res.status}` };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'unexpected', message: 'note API の応答が JSON ではありません' };
  }
  const data = (json as { data?: unknown })?.data;
  const user = (typeof data === 'object' && data !== null ? data : json) as Record<string, unknown>;
  const urlname = typeof user.urlname === 'string' ? user.urlname : '';
  if (!urlname) {
    return { ok: false, reason: 'unauthorized', message: 'note API の応答に urlname がありません (未ログイン?)' };
  }
  const nickname = typeof user.nickname === 'string' ? user.nickname : urlname;
  const id = user.id;
  return { ok: true, urlname, nickname, userId: id === undefined || id === null ? null : String(id) };
}
