import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { decryptApiKey } from '@a2p/crypto';
import { amazonUrlForAsin, appendPurchaseLink, type PromotionChannel } from '@a2p/contracts/promotion/channels';
import { ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import {
  createHttpPublisherPort,
  type HttpPublisherDeps,
} from './promotion-post/http-publisher-port.js';
import {
  createStubPublisherPort,
  type PublishChannelConfig,
  type PublisherPort,
} from './promotion-post/publisher-port.js';
import { pushLine } from './lib/line-auth-relay.js';
import { createBlogPublisherPort } from './promotion-post/blog-publisher-port.js';
import { createAyrsharePublisherPort } from './promotion-post/ayrshare-publisher-port.js';
import { createTikTokPublisherPort } from './promotion-post/tiktok-publisher-port.js';
import { createZernioPublisherPort } from './promotion-post/zernio-publisher-port.js';
import { createNotePublisherPort } from './promotion-post/note-publisher-port.js';
import { ensureBookPromoImage, generateValuePostImage, generateBookEyecatchImage2 } from './promotion-post/promo-image.js';
import { buildInstagramCarouselKeys } from './promotion-post/carousel.js';

/**
 * `promotion.post.publish` タスク (F-052)
 *
 * `promotion_posts` の 1 行を該当チャンネルへ実投稿する。dispatcher から
 * 期限到来分に対して起動される。
 *
 * ガード:
 *   - post が scheduled でなければスキップ (二重投稿防止)。
 *   - チャンネルの auto_enabled が false ならスキップ (実投稿しない)。
 * 状態遷移: scheduled → posting → posted / failed。
 */

export const PROMOTION_POST_PUBLISH_TASK_NAME = 'promotion.post.publish';

export const PromotionPostPublishPayloadSchema = z.object({
  post_id: z.string().min(1),
  /** 運営者の手動「今すぐ投稿」。true なら auto_enabled ガードを無視する (接続は必要)。 */
  force: z.boolean().optional(),
});

export interface PromotionPostPublishPrisma {
  promotionPost: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        book_id: true;
        channel: true;
        account_id: true;
        title: true;
        body: true;
        status: true;
        media_key: true;
      };
    }) => Promise<{
      id: string;
      book_id: string | null;
      channel: string;
      account_id: string | null;
      title: string | null;
      body: string;
      status: string;
      media_key: string | null;
    } | null>;
    updateMany: (args: {
      where: { id: string; status: string };
      data: { status: string };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: {
        status?: string;
        external_url?: string | null;
        error?: string | null;
        posted_at?: Date | null;
      };
    }) => Promise<unknown>;
  };
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { auto_enabled: true; handle: true; token_enc: true; config_json: true };
    }) => Promise<{
      auto_enabled: boolean;
      handle: string | null;
      token_enc: string | null;
      config_json: unknown;
    } | null>;
  };
  // promo 投稿の購入 URL を投稿時に現在の ASIN で確実に付与するための参照。
  book?: {
    findUnique: (args: {
      where: { id: string };
      select: { asin: true };
    }) => Promise<{ asin: string | null } | null>;
  };
  // P4 増分2: 投稿が特定の台帳アカウントに紐づく場合、その資格情報で投稿する。
  promotionAccount?: {
    findUnique: (args: {
      where: { id: string };
      select: { status: true; handle: true; token_enc: true; config_json: true };
    }) => Promise<{ status: string; handle: string | null; token_enc: string | null; config_json: unknown } | null>;
  };
}

export interface PromotionPostPublishDeps {
  prisma?: PromotionPostPublishPrisma;
  logger?: Logger;
  /** チャンネル→ポート解決 (テスト差し替え)。既定は env で stub/http/ayrshare を選ぶ。 */
  /** channel (＋台帳アカウントの config) からポートを選ぶ。config は F-ANP-33b の X→Zernio 判定に使う。 */
  resolvePort?: (channel: string, config?: PublishChannelConfig) => PublisherPort;
  /** token_enc 復号関数 (テスト差し替え)。 */
  decryptToken?: (enc: string) => string;
  /** F-058/F-059/F-060: IG/TikTok の添付メディア(公開URL)を用意する。既定は事前mp4→本の販促画像→投稿ごと画像。 */
  buildMediaUrls?: (
    channel: string,
    bookId: string | null,
    postId: string,
    body: string,
    mediaKey: string | null,
  ) => Promise<string[]>;
  now?: () => Date;
}

export type PromotionPostPublishResult =
  | { status: 'posted'; externalUrl: string | null }
  | { status: 'failed'; reason: string; message: string }
  | { status: 'skipped'; reason: string };

function defaultResolvePort(channel: string, config?: PublishChannelConfig): PublisherPort {
  if (process.env.PROMOTION_PUBLISHER === 'stub') {
    return createStubPublisherPort();
  }
  // [F-ANP-33b] X: 台帳アカウントが Zernio 接続 (config_json.zernio_account_id) なら Zernio 経由で投稿する
  //   (運営者要望 2026-09-22「X も Zernio にしたい」)。それ以外の X は従来どおり OAuth1 直叩き (http port)。
  if (channel === 'x' && process.env.ZERNIO_API_KEY && typeof config?.extra['zernio_account_id'] === 'string' && config.extra['zernio_account_id']) {
    return createZernioPublisherPort();
  }
  // 所有ブログは第三者接続不要 — ツール自身の blog_posts に公開する。
  if (channel === 'blog') {
    return createBlogPublisherPort();
  }
  // Zernio(getlate) 経由: IG(画像) / TikTok(動画) を審査済みパートナーで公開投稿。
  //   TikTok は自前API審査が恒久却下のため、また IG は Make(webhook) から移行するため、
  //   ZERNIO_API_KEY があれば最優先でこの経路を使う(Make/Ayrshare/自前TikTokより先)。
  if ((channel === 'instagram' || channel === 'tiktok') && process.env.ZERNIO_API_KEY) {
    return createZernioPublisherPort();
  }
  // F-063: TikTok は Content Posting API を直接叩く（動画を下書き投稿）。creds が無ければ
  //   publish 側で not_connected を返す。
  if (channel === 'tiktok') {
    return createTikTokPublisherPort();
  }
  // F-058: IG は Ayrshare 経由 (API キーがある場合)。無ければ http(webhook)にフォールバック。
  if (channel === 'instagram' && process.env.AYRSHARE_API_KEY) {
    return createAyrsharePublisherPort();
  }
  // F-058 (note): note は公式 API が無いため、認証情報があればブラウザ自動化で投稿。無ければ webhook。
  if (channel === 'note' && process.env.NOTE_EMAIL && process.env.NOTE_PASSWORD) {
    return createNotePublisherPort();
  }
  const httpDeps: HttpPublisherDeps = {};
  return createHttpPublisherPort(httpDeps);
}

/**
 * IG/TikTok の添付メディア既定実装。
 *  - 事前レンダリング済み media_key(TikTok 動画 mp4 等)があればそれを最優先。
 *  - 宣伝(本あり): その本の販促画像を生成し署名 URL を返す。
 *  - 育成(book_id=null): 投稿ごとにユニークな画像を生成する(同一画像の連投を避ける)。
 */
/**
 * 販促メディア署名 URL の有効期限(秒)。中継(Make等)がシナリオ停止/リトライでキュー滞留し、
 * 数時間〜数日後に画像を取得しにくることがある。1h では期限切れで R2 が XML/HTML エラーを返し、
 * 中継側の JSON パースが「Unexpected token '<'」で落ちる(→シナリオ自動停止)ため、7 日に延長する。
 */
const MEDIA_URL_TTL_SEC = 7 * 24 * 3600;

async function defaultBuildMediaUrls(
  channel: string,
  bookId: string | null,
  postId: string,
  body: string,
  mediaKey: string | null,
): Promise<string[]> {
  // IG/TikTok は画像/動画必須。note はアイキャッチ。X は画像添付でインプレを伸ばす(任意だが標準化)。
  // book=表紙入り販促画像 / value(良書紹介)=バリューカード。blog は本文内で完結するので画像は付けない。
  if (channel !== 'instagram' && channel !== 'tiktok' && channel !== 'note' && channel !== 'x') return [];
  const storage = await import('@a2p/storage');
  // 事前生成メディア(動画等)を優先。
  if (mediaKey) {
    return [await storage.getSignedDownloadUrl(mediaKey, MEDIA_URL_TTL_SEC)];
  }
  // TikTok は動画が本命。未レンダリングなら投稿時にオンデマンドで動画を1本作る
  // (重い処理・失敗時は下の画像フォールバックへ)。
  if (channel === 'tiktok') {
    try {
      const { ensureTikTokVideoForPost } = await import('./promotion-post/tiktok-video.js');
      const videoKey = await ensureTikTokVideoForPost(postId, bookId);
      if (videoKey) return [await storage.getSignedDownloadUrl(videoKey, MEDIA_URL_TTL_SEC)];
    } catch {
      // 動画生成失敗
    }
    // TikTok は動画のみ。動画が用意できなければメディア無しで返し、投稿側でスキップさせる。
    // 画像を渡すと Zernio が「写真投稿(スライドショー)」として扱い、本文がタイトル長制限に当たって
    // spam/長さエラーで失敗するため、画像フォールバックはしない。
    return [];
  }
  // IG は複数枚のカルーセル(見出しフック→本文の要点カード→固定テンプレ枚)にする
  // (運営者要望 2026-09: 保存/シェアを稼ぐ勝ち型。docs/08-promo-playbook.md §1/§9)。
  if (channel === 'instagram') {
    const keys = await buildInstagramCarouselKeys(bookId, postId, body);
    if (keys.length === 0) return [];
    return Promise.all(keys.map((k) => storage.getSignedDownloadUrl(k, MEDIA_URL_TTL_SEC)));
  }

  // note のアイキャッチは gpt-image-2 で「画像＋文字」を一発生成する(合成しない)。
  // x の promo/value 投稿は従来どおり単一の販促画像/バリューカード。
  let key: string | null;
  if (bookId && channel === 'note') {
    key = await generateBookEyecatchImage2(postId, bookId);
  } else if (bookId) {
    key = await ensureBookPromoImage(bookId);
  } else {
    key = await generateValuePostImage(postId, body);
  }
  if (!key) return [];
  return [await storage.getSignedDownloadUrl(key, MEDIA_URL_TTL_SEC)];
}

export async function runPromotionPostPublish(
  payload: unknown,
  deps: PromotionPostPublishDeps = {},
): Promise<PromotionPostPublishResult> {
  const parsed = PromotionPostPublishPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('promotion.post.publish payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { post_id: postId, force } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PROMOTION_POST_PUBLISH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionPostPublishPrisma);
  const resolvePort = deps.resolvePort ?? defaultResolvePort;
  const decrypt = deps.decryptToken ?? ((enc: string) => decryptApiKey(enc));
  const buildMediaUrls = deps.buildMediaUrls ?? defaultBuildMediaUrls;
  const now = deps.now ?? (() => new Date());

  const post = await prisma.promotionPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      book_id: true,
      channel: true,
      account_id: true,
      title: true,
      body: true,
      status: true,
      media_key: true,
    },
  });
  if (!post) {
    log.warn({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId }, 'post not found — skip');
    return { status: 'skipped', reason: 'not_found' };
  }
  if (post.status !== 'scheduled') {
    log.info({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, status: post.status }, 'not scheduled — skip');
    return { status: 'skipped', reason: `status_${post.status}` };
  }

  const setting = await prisma.promotionChannelSetting.findUnique({
    where: { channel: post.channel },
    select: { auto_enabled: true, handle: true, token_enc: true, config_json: true },
  });
  if (!setting) {
    log.info({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, channel: post.channel }, 'channel not configured — skip');
    return { status: 'skipped', reason: 'not_configured' };
  }
  // 自動ディスパッチ経路は auto_enabled 必須。手動 force はガードを無視 (接続は下で必要)。
  if (!setting.auto_enabled && !force) {
    log.info({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, channel: post.channel }, 'channel auto disabled — skip');
    return { status: 'skipped', reason: 'auto_disabled' };
  }

  // scheduled → posting (二重投稿防止の CAS)
  const cas = await prisma.promotionPost.updateMany({
    where: { id: postId, status: 'scheduled' },
    data: { status: 'posting' },
  });
  if (cas.count === 0) {
    return { status: 'skipped', reason: 'already_taken' };
  }

  // P4 増分2: 投稿が台帳アカウントに紐づく場合、そのアカウントの資格情報で投稿する
  // （多アカウント routing）。接続済みでなければ投稿しない。null なら channel 既定設定を使う。
  let credSource: { handle: string | null; token_enc: string | null; config_json: unknown } = setting;
  if (post.account_id && prisma.promotionAccount) {
    const account = await prisma.promotionAccount.findUnique({
      where: { id: post.account_id },
      select: { status: true, handle: true, token_enc: true, config_json: true },
    });
    if (!account || account.status !== 'connected') {
      await prisma.promotionPost.update({
        where: { id: postId },
        data: { status: 'failed', error: 'routed account not connected'.slice(0, 500) },
      });
      log.info(
        { task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, accountId: post.account_id },
        'routed account not connected — fail',
      );
      return { status: 'failed', reason: 'account_not_connected', message: 'routed account not connected' };
    }
    credSource = account;
  }

  let token: string | null = null;
  if (credSource.token_enc) {
    try {
      token = decrypt(credSource.token_enc);
    } catch (err) {
      log.warn({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, err }, 'token decrypt failed');
      token = null;
    }
  }

  const config: PublishChannelConfig = {
    token,
    handle: credSource.handle,
    extra: (credSource.config_json as Record<string, unknown> | null) ?? {},
  };

  try {
    // F-058: IG/TikTok は画像/動画が必須。販促画像の署名 URL を用意する。
    let mediaUrls: string[] = [];
    try {
      mediaUrls = await buildMediaUrls(post.channel, post.book_id, post.id, post.body, post.media_key);
    } catch (err) {
      log.warn({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, err }, 'media build failed — publishing without media');
    }

    // TikTok は動画必須。動画が用意できなかった投稿は写真フォールバックせず canceled でスキップする
    // (失敗として溜めない。動画が生成できるようになれば再スケジュールで拾える)。
    if (post.channel === 'tiktok' && mediaUrls.length === 0) {
      await prisma.promotionPost.update({
        where: { id: postId },
        data: { status: 'canceled', error: 'tiktok: no video — skipped (photo fallback disabled)'.slice(0, 500) },
      });
      log.info({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId }, 'tiktok skipped — no video available');
      return { status: 'skipped', reason: 'tiktok_no_video' };
    }

    // promo 投稿(本あり)は、投稿直前に **現在の book.asin から正規 Amazon URL** を本文へ付与する。
    // (生成時に ASIN 未確定だと URL が入らないため。既に正しい URL を含む場合は二重付与しない。)
    let bodyToPost = post.body;
    if (post.book_id && prisma.book) {
      try {
        const bk = await prisma.book.findUnique({ where: { id: post.book_id }, select: { asin: true } });
        const url = amazonUrlForAsin(bk?.asin);
        if (url && !bodyToPost.includes(url)) {
          bodyToPost = appendPurchaseLink(post.channel, bodyToPost, bk?.asin);
        }
      } catch (err) {
        log.warn({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, err }, 'purchase link injection skipped');
      }
    }

    const port = resolvePort(post.channel, config);
    const result = await port.publish({
      channel: post.channel as PromotionChannel,
      title: post.title,
      body: bodyToPost,
      config,
      ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    });

    if (result.ok) {
      await prisma.promotionPost.update({
        where: { id: postId },
        data: { status: 'posted', external_url: result.externalUrl, error: null, posted_at: now() },
      });
      log.info({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, channel: post.channel }, 'post published');
      return { status: 'posted', externalUrl: result.externalUrl };
    }

    await prisma.promotionPost.update({
      where: { id: postId },
      data: { status: 'failed', error: `${result.reason}: ${result.message}`.slice(0, 500) },
    });
    log.warn(
      { task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, channel: post.channel, reason: result.reason },
      'post publish failed',
    );
    // 黙って止まらないよう、実投稿の失敗は LINE に通知する(中継/接続の失効を早期検知)。
    await pushLine(
      `⚠️ A2P: ${post.channel} の自動投稿に失敗 (${result.reason}). ${result.message.slice(0, 120)}`,
    ).catch(() => {});
    return { status: 'failed', reason: result.reason, message: result.message };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await prisma.promotionPost.update({
      where: { id: postId },
      data: { status: 'failed', error: message.slice(0, 500) },
    });
    log.error({ task: PROMOTION_POST_PUBLISH_TASK_NAME, postId, err }, 'post publish threw');
    return { status: 'failed', reason: 'unknown', message };
  }
}

export const promotionPostPublishTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionPostPublish(payload);
};
