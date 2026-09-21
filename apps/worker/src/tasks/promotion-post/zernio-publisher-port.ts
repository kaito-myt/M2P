/**
 * Zernio (getlate) 経由の PublisherPort 実装 — Instagram(画像) / TikTok(動画)。
 *
 * Zernio は複数SNSを1APIで扱う投稿代行(アカウント課金制・最初の2アカウント無料)。
 * TikTok は公式 Content Posting API の自前アプリ審査が「個人/社内利用不可」で恒久却下されたため、
 * 審査済みパートナーである Zernio に間借りして公開投稿する。IG も Make(webhook) から本ポートへ移行し、
 * 署名付き画像URLを渡すだけで公開できる(Make のシナリオ自動停止トラブルを回避)。
 *
 * 契約: `POST https://zernio.com/api/v1/posts`（Bearer ZERNIO_API_KEY）。
 *   body: { content, publishNow:true, profileId, platforms:[{platform, accountId}],
 *           mediaItems:[{type:'image'|'video', url}], tiktokSettings? }
 *   accountId/profileId は `GET /v1/accounts` から channel→platform で解決(初回のみ取得しメモ化)。
 *
 * 失敗は例外にせず PublishResult の判別ユニオンで返す。
 */
import { createLogger, type Logger } from '@a2p/contracts/logger';

import type { PublishFailureReason, PublishInput, PublishResult, PublisherPort } from './publisher-port.js';

const ZERNIO_API_BASE = 'https://zernio.com/api/v1';

/** channel → Zernio platform 名。 */
function zernioPlatform(channel: string): 'instagram' | 'tiktok' | null {
  if (channel === 'instagram') return 'instagram';
  if (channel === 'tiktok') return 'tiktok';
  return null;
}

interface ZernioAccount {
  _id: string;
  platform: string;
  profileId?: { _id: string } | string | null;
  profileUrl?: string | null;
  needsReconnection?: boolean;
}

export interface ZernioPublisherDeps {
  apiKey?: string;
  fetchFn?: typeof fetch;
  logger?: Logger;
}

export function createZernioPublisherPort(deps: ZernioPublisherDeps = {}): PublisherPort {
  const apiKey = deps.apiKey ?? process.env.ZERNIO_API_KEY ?? '';
  const doFetch = deps.fetchFn ?? fetch;
  const log = deps.logger ?? createLogger('worker.promotion.zernio');

  // アカウント一覧のメモ化(ポート寿命内)。1回の GET で IG/TikTok 両方が取れる。
  let accountsCache: ZernioAccount[] | null = null;
  async function loadAccounts(): Promise<ZernioAccount[]> {
    if (accountsCache) return accountsCache;
    const res = await doFetch(`${ZERNIO_API_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`zernio GET /accounts ${res.status}`);
    const json = (await res.json()) as { accounts?: ZernioAccount[] };
    accountsCache = json.accounts ?? [];
    return accountsCache;
  }

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      if (!apiKey) {
        return { ok: false, reason: 'not_connected', message: 'ZERNIO_API_KEY 未設定' };
      }
      const platform = zernioPlatform(input.channel);
      if (!platform) {
        return { ok: false, reason: 'invalid', message: `zernio 未対応チャンネル: ${input.channel}` };
      }
      const mediaUrl = input.mediaUrls?.[0];
      if (!mediaUrl) {
        // IG は画像、TikTok は動画が必須。
        return {
          ok: false,
          reason: 'invalid',
          message: `${input.channel} は Zernio 投稿にメディア(画像/動画)が必須です`,
        };
      }

      // 接続アカウントを解決。[F-ANP-33] 台帳 (promotion_accounts.config_json.zernio_account_id) で
      // 特定の Zernio アカウントが指定されていればそれを使う (note アカウントごとに SNS アカウントが違う)。
      // 指定があるのに見つからない場合は既定へ落とさず not_connected にする (別アカウントへの誤投稿防止)。
      const wanted = typeof input.config.extra['zernio_account_id'] === 'string' ? (input.config.extra['zernio_account_id'] as string) : '';
      let account: ZernioAccount | undefined;
      try {
        const accounts = await loadAccounts();
        account = wanted ? accounts.find((a) => a._id === wanted && a.platform === platform) : accounts.find((a) => a.platform === platform);
      } catch (err) {
        return { ok: false, reason: 'unknown', message: `zernio accounts 取得失敗: ${String(err)}` };
      }
      if (!account) {
        return {
          ok: false,
          reason: 'not_connected',
          message: wanted ? `Zernio に指定の ${platform} アカウント (${wanted}) が見つかりません` : `Zernio に ${platform} 未接続`,
        };
      }
      if (account.needsReconnection) {
        return { ok: false, reason: 'auth', message: `Zernio ${platform} 再接続が必要です` };
      }
      const profileId =
        typeof account.profileId === 'string' ? account.profileId : account.profileId?._id ?? undefined;

      // [F-084] 動画メディアなら IG も Reel(type:'video')で投稿する。TikTok動画を IG リールに流用。
      const isVideo = platform === 'tiktok' || /\.mp4(\?|$)/i.test(mediaUrl);
      const body: Record<string, unknown> = {
        content: input.body,
        publishNow: true,
        ...(profileId ? { profileId } : {}),
        platforms: [{ platform, accountId: account._id }],
        // 2026-09-18 IG カルーセル: 静止画が複数枚あれば全て渡す (Zernio は 2〜10 枚でカルーセル化、
        // docs.zernio.com/platforms/instagram)。動画(Reel/TikTok)は 1 本のみ。
        mediaItems: isVideo
          ? [{ type: 'video', url: mediaUrl }]
          : (input.mediaUrls ?? [])
              .filter((u): u is string => typeof u === 'string' && u.length > 0)
              .slice(0, 10)
              .map((url) => ({ type: 'image', url })),
      };
      if (platform === 'tiktok') {
        // TikTok 公開投稿の必須フラグ(Content Posting API 準拠)。
        body.tiktokSettings = {
          privacy_level: 'PUBLIC_TO_EVERYONE',
          allow_comment: true,
          allow_duet: true,
          allow_stitch: true,
          content_preview_confirmed: true,
          express_consent_given: true,
        };
      }

      let res: Response;
      try {
        res = await doFetch(`${ZERNIO_API_BASE}/posts`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        return { ok: false, reason: 'unknown', message: `zernio POST 失敗: ${String(err)}` };
      }

      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // 非JSON応答
      }

      if (!res.ok) {
        const errMsg = typeof json.error === 'string' ? json.error : text.slice(0, 300);
        const reason: PublishFailureReason =
          res.status === 401 || res.status === 403
            ? 'auth'
            : res.status === 429
              ? 'rate_limit'
              : /aspect ratio|invalid|duration|too (long|large)|format/i.test(errMsg)
                ? 'invalid'
                : 'unknown';
        return { ok: false, reason, message: `zernio ${input.channel}: ${errMsg}` };
      }

      // 成功。即時応答には最終パーマリンクが無いことが多いので、プロフィールURLを外部URLとして返す。
      const post = json.post as
        | { platforms?: Array<{ accountId?: { profileUrl?: string } | string }> }
        | undefined;
      const first = post?.platforms?.[0]?.accountId;
      const profileUrl =
        first && typeof first === 'object' ? (first.profileUrl ?? null) : account.profileUrl ?? null;
      log.info({ channel: input.channel, platform, accountId: account._id }, 'zernio post published');
      return { ok: true, externalUrl: profileUrl };
    },
  };
}
