/**
 * F-052 — PublisherPort の実 HTTP 実装 (隔離)。
 *
 * 2 つの投稿経路をサポートする:
 *   1. **Webhook 経由 (汎用)**: チャンネル設定に `webhook_url` があれば、そこへ
 *      `{ channel, title, body, handle }` を POST する。note/ブログのように公式 API が
 *      無い/複雑なチャンネルは、運営者が用意した中継 (自前 API / Zapier / Make 等) に
 *      流すのが最も現実的。レスポンス JSON に `url` があれば公開 URL として採用。
 *   2. **X API v2 (SNS)**: `webhook_url` が無く channel='sns' でトークンがある場合、
 *      `POST https://api.twitter.com/2/tweets` に Bearer 認証で投稿する。
 *
 * どちらも失敗は例外にせず PublishResult の判別ユニオンで返す (dispatcher が記録)。
 */
import { buildXAuthHeader, parseXCredentials } from '@a2p/crypto';
import { weightedTweetLength, truncateToWeight, X_MAX_WEIGHT } from '@a2p/contracts/promotion/channels';
import { createLogger } from '@a2p/contracts/logger';

import type {
  PublishInput,
  PublishResult,
  PublisherPort,
} from './publisher-port.js';

const log = createLogger('worker.promotion.http-publisher');

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface HttpPublisherDeps {
  /** テスト差し替え用の fetch。既定は global fetch。 */
  fetchImpl?: FetchLike;
}

const X_API_TWEETS_URL = 'https://api.twitter.com/2/tweets';
const X_MEDIA_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

/**
 * X の v1.1 media/upload に画像(署名付きURL)を上げて media_id を返す。
 * OAuth1 で multipart/form-data 送信(body params は署名対象外なので oauth のみで署名)。
 * 画像取得と upload は実ネットワークが要るため global fetch を使う(narrow FetchLike は string body 前提)。
 * 画像添付でインプレッションを伸ばす狙い。失敗は呼出側で握りテキストのみ投稿にフォールバックする。
 */
async function uploadXMedia(creds: ReturnType<typeof parseXCredentials>, imageUrl: string): Promise<string> {
  if (!creds || creds.kind !== 'oauth1') throw new Error('media upload requires OAuth1 creds');
  const gfetch = globalThis.fetch;
  const imgRes = await gfetch(imageUrl);
  if (!imgRes.ok) throw new Error(`fetch media ${imgRes.status}`);
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  const authHeader = buildXAuthHeader('POST', X_MEDIA_UPLOAD_URL, creds);
  const form = new FormData();
  form.append('media', new Blob([bytes]), 'image.jpg');
  const res = await gfetch(X_MEDIA_UPLOAD_URL, { method: 'POST', headers: { authorization: authHeader }, body: form });
  const raw = await res.text();
  if (!res.ok) throw new Error(`media/upload ${res.status}: ${raw.slice(0, 200)}`);
  const j = JSON.parse(raw) as { media_id_string?: string; media_id?: number };
  const id = j.media_id_string || (j.media_id != null ? String(j.media_id) : null);
  if (!id) throw new Error('no media_id in upload response');
  return id;
}

export function createHttpPublisherPort(deps: HttpPublisherDeps = {}): PublisherPort {
  const doFetch: FetchLike = deps.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      const webhookUrl = readString(input.config.extra['webhook_url']);

      // 1. Webhook 経由 (汎用)
      if (webhookUrl) {
        return publishViaWebhook(doFetch, webhookUrl, input);
      }

      // 2. X API v2 (X 専用)。Instagram/TikTok は公式 API の要件が重いため Webhook 経由を推奨。
      if (input.channel === 'x') {
        if (!input.config.token) {
          return { ok: false, reason: 'not_connected', message: 'X token not configured' };
        }
        return publishViaXApi(doFetch, input);
      }

      // それ以外は接続手段なし
      return {
        ok: false,
        reason: 'not_connected',
        message: `channel ${input.channel} needs a webhook_url or token to publish`,
      };
    },
  };
}

async function publishViaWebhook(
  doFetch: FetchLike,
  url: string,
  input: PublishInput,
): Promise<PublishResult> {
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(input.config.token ? { authorization: `Bearer ${input.config.token}` } : {}),
      },
      body: JSON.stringify({
        channel: input.channel,
        title: input.title,
        body: input.body,
        handle: input.config.handle,
        // F-058: IG/TikTok 用に AI 生成した販促画像の公開URL。中継(Make/Zapier)が
        // これを投稿メディアに使う。無ければ空配列。
        mediaUrls: input.mediaUrls ?? [],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : 'unknown',
        message: `webhook responded ${res.status}: ${text.slice(0, 300)}`,
      };
    }
    // 中継(Make等)の応答を解釈する。Make 既定は 2xx+"Accepted" で「受理しただけ」を返し、実投稿の
    // 成否は分からない。シナリオ末尾に Webhook Response を足して JSON({url}/{ok:false,error}) を返す
    // 運用にすれば、ここで **本当に投稿できた時だけ url 付き posted / 明示エラーは failed** に判定できる。
    const verdict = interpretWebhookBody(text);
    if (verdict.failed) {
      return { ok: false, reason: 'unknown', message: `webhook reported failure: ${verdict.message}`.slice(0, 300) };
    }
    return { ok: true, externalUrl: verdict.url };
  } catch (err) {
    log.warn({ err, channel: input.channel }, 'webhook publish failed');
    return { ok: false, reason: 'unknown', message: errMessage(err) };
  }
}

async function publishViaXApi(doFetch: FetchLike, input: PublishInput): Promise<PublishResult> {
  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'invalid', message: 'empty tweet body' };
  }
  // X は重み付き文字数(日本語=2)で 280。超過は弾かず末尾を丸めて確実に投稿する
  // (弾くと売上機会を失うため)。生成側でも収めているので通常は無加工。
  const text =
    weightedTweetLength(trimmed) > X_MAX_WEIGHT ? truncateToWeight(trimmed, X_MAX_WEIGHT) : trimmed;
  // 資格情報を解釈: OAuth1(4値, 無期限) を優先、レガシー Bearer もサポート。
  const creds = parseXCredentials(input.config.token);
  if (!creds) {
    return { ok: false, reason: 'not_connected', message: 'X credentials not configured' };
  }
  // 画像があれば media/upload して tweet に添付(インプレ向上)。失敗時はテキストのみ投稿。
  let mediaIds: string[] = [];
  const imageUrl = (input.mediaUrls ?? []).find((u) => typeof u === 'string' && u.length > 0);
  if (imageUrl) {
    try {
      mediaIds = [await uploadXMedia(creds, imageUrl)];
    } catch (err) {
      log.warn({ err }, 'X media upload failed — posting text only');
    }
  }
  // POST /2/tweets は JSON ボディ。OAuth1 では JSON ボディを署名に含めない。
  const authHeader = buildXAuthHeader('POST', X_API_TWEETS_URL, creds);
  try {
    const res = await doFetch(X_API_TWEETS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: authHeader,
      },
      body: JSON.stringify(mediaIds.length ? { text, media: { media_ids: mediaIds } } : { text }),
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : 'unknown',
        message: `X API responded ${res.status}: ${raw.slice(0, 300)}`,
      };
    }
    const id = extractTweetId(raw);
    const handle = input.config.handle?.replace(/^@/, '');
    const externalUrl = id && handle ? `https://x.com/${handle}/status/${id}` : id ? `https://x.com/i/status/${id}` : null;
    return { ok: true, externalUrl };
  } catch (err) {
    log.warn({ err }, 'X API publish failed');
    return { ok: false, reason: 'unknown', message: errMessage(err) };
  }
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function extractUrl(text: string): string | null {
  try {
    const j = JSON.parse(text) as { url?: unknown; external_url?: unknown };
    return readString(j.url) ?? readString(j.external_url);
  } catch {
    return null;
  }
}

/**
 * 中継の 2xx 応答 body を解釈する。
 *  - JSON で `ok:false` / `error` / `status:'error'|'failed'` があれば **明示失敗**。
 *  - `url`/`external_url`/`postUrl` があれば公開 URL として採用。
 *  - それ以外(例: "Accepted"、URL 無しの成功)は従来どおり成功扱い(URL 不明)。
 */
function interpretWebhookBody(text: string): { failed: boolean; message: string; url: string | null } {
  let j: { ok?: unknown; error?: unknown; status?: unknown; url?: unknown; external_url?: unknown; postUrl?: unknown };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    return { failed: false, message: '', url: null }; // JSON でない(例 "Accepted") → 成功扱い
  }
  const statusStr = typeof j.status === 'string' ? j.status.toLowerCase() : '';
  const explicitFail =
    j.ok === false || (j.error != null && j.error !== '' && j.error !== false) || statusStr === 'error' || statusStr === 'failed';
  if (explicitFail) {
    const msg = readString(j.error) ?? (statusStr || 'webhook reported failure');
    return { failed: true, message: msg, url: null };
  }
  return { failed: false, message: '', url: readString(j.url) ?? readString(j.external_url) ?? readString(j.postUrl) };
}

function extractTweetId(text: string): string | null {
  try {
    const j = JSON.parse(text) as { data?: { id?: unknown } };
    return readString(j.data?.id);
  } catch {
    return null;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
