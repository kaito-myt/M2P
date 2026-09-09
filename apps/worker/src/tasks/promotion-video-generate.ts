import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createTikTokVideoScript as defaultCreateScript } from '@a2p/agents';
import {
  AccountStrategyProfileSchema,
  type TikTokVideoInput,
  type VideoScript,
} from '@a2p/contracts/agents';
import { appendHashtags, resolveHashtags } from '@a2p/contracts/promotion/channels';
import { ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';
import { promotionPostVideo } from '@a2p/storage/keys';

import { renderSlideVideo, type RenderVideoDeps } from './promotion-post/video-render.js';
import { generateVeoClip, type VeoTier } from './promotion-post/veo-clip.js';

/**
 * `promotion.video.generate` タスク (F-060)
 *
 * TikTok 向けスライド動画を「多エージェント台本 → 画像+テロップ+TTS+ffmpeg レンダリング」で作り、
 * mp4 を R2 に保存、`promotion_posts`(channel='tiktok', media_key=mp4) を予約する。
 * 射幸心を煽る(続きが気になる)構成。value(育成)/promo(宣伝) の両対応。
 *
 * レンダリングは重い(画像複数+TTS+ffmpeg)ので 1 呼び出し 1 本。
 */

export const PROMOTION_VIDEO_GENERATE_TASK_NAME = 'promotion.video.generate';

export const PromotionVideoGeneratePayloadSchema = z.object({
  /** ネタの軸（発信の柱 name 等）。book_id 指定時は省略可。 */
  topic: z.string().max(200).optional(),
  /** 宣伝対象の本（promo）。省略時は value(育成)。 */
  book_id: z.string().optional(),
  /** 目標尺（秒）。 */
  target_seconds: z.number().int().min(10).max(90).optional(),
  /** 予約時刻(ISO)。未指定なら翌日 20:00 JST。 */
  scheduled_for: z.string().optional(),
  /** [F-084] 同じ動画を IG リールにも投稿するか（既定 true）。 */
  also_reels: z.boolean().optional(),
  /** [F-084] 冒頭フックを Veo 実写級動画にするか（未指定なら app_settings フラグに従う）。 */
  use_veo: z.boolean().optional(),
});

interface VideoGeneratePrisma {
  appSettings?: {
    findUnique: (args: { where: { id: string }; select: { video_use_veo_enabled: true } }) => Promise<{ video_use_veo_enabled: boolean } | null>;
  };
  promotionChannelSetting: {
    findUnique: (args: { where: { channel: string }; select: { strategy_json: true } }) => Promise<{ strategy_json: unknown } | null>;
  };
  book: {
    findMany: (args: { select: { title: true } }) => Promise<Array<{ title: string }>>;
    findUnique?: (args: {
      where: { id: string };
      select: { title: true; asin: true; theme: { select: { hook: true } } };
    }) => Promise<{ title: string; asin: string | null; theme: { hook: string | null } | null } | null>;
  };
  promotionPost: {
    create: (args: {
      data: Record<string, unknown>;
      select: { id: true };
    }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
}

interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<{ key: string }>;
}

export interface PromotionVideoGenerateDeps {
  prisma?: VideoGeneratePrisma;
  logger?: Logger;
  now?: () => Date;
  createScript?: (input: TikTokVideoInput) => Promise<VideoScript>;
  renderVideo?: (script: VideoScript) => Promise<Buffer>;
  renderDeps?: RenderVideoDeps;
  uploadBuffer?: UploadBufferFn;
  /** [F-084] Veo フッククリップ生成（テスト差し替え）。既定は Veo 3.1 fast。 */
  generateHookClip?: (prompt: string) => Promise<Buffer>;
  /** Veo ティア（既定 fast=ハイブリッド低コスト）。 */
  veoTier?: VeoTier;
}

/** scene[0] から Veo 用の動画プロンプトを組み立てる（動き・カメラ・縦型・文字なしを明示）。 */
export function buildVeoHookPrompt(imagePrompt: string): string {
  return (
    `${imagePrompt} ` +
    'Cinematic vertical 9:16 short clip, subtle camera motion (slow push-in or gentle pan), ' +
    'natural lighting, shallow depth of field, photoreal. ' +
    'Absolutely no text, no captions, no logos, no numbers on screen.'
  );
}

export interface PromotionVideoGenerateResult {
  post_id: string;
  media_key: string;
  scenes: number;
  /** [F-084] 同じ動画で作成した IG リール投稿の id（作成した場合）。 */
  reel_post_id?: string;
}

async function defaultUploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer(key, buffer, contentType);
}

const H = 3600_000;

/** 翌日 20:00 JST を UTC で返す。 */
function tomorrow20Jst(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * H);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1, 0, 1200) - 9 * H);
}

export async function runPromotionVideoGenerate(
  payload: unknown,
  deps: PromotionVideoGenerateDeps = {},
): Promise<PromotionVideoGenerateResult> {
  const parsed = PromotionVideoGeneratePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('promotion.video.generate payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { topic, book_id: bookId, target_seconds } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PROMOTION_VIDEO_GENERATE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as VideoGeneratePrisma);
  const now = deps.now ?? (() => new Date());
  const createScript = deps.createScript ?? ((input: TikTokVideoInput) => defaultCreateScript(input));
  const uploadBuffer = deps.uploadBuffer ?? defaultUploadBuffer;
  const veoTier = deps.veoTier ?? 'fast';
  const generateHookClip =
    deps.generateHookClip ?? ((prompt: string) => generateVeoClip(prompt, { tier: veoTier, seconds: 8 }));

  // 1. アカウント戦略(コンセプト/トーン/柱/ハッシュタグ)を取得。
  const setting = await prisma.promotionChannelSetting.findUnique({
    where: { channel: 'tiktok' },
    select: { strategy_json: true },
  });
  const profile = setting?.strategy_json ? AccountStrategyProfileSchema.safeParse(setting.strategy_json) : null;
  const concept = profile?.success ? profile.data.concept : '';
  const tone = profile?.success ? profile.data.tone_of_voice : '';
  const coreTags = profile?.success ? profile.data.hashtag_strategy.core : [];
  const pillarTopic =
    topic ?? (profile?.success && profile.data.content_pillars[0] ? profile.data.content_pillars[0].name : '今日の一言');

  // 2. 世界観の材料 + 宣伝対象の本。
  const books = await prisma.book.findMany({ select: { title: true } });
  const sampleTitles = books.slice(0, 15).map((b) => b.title);

  let bookInput: TikTokVideoInput['book'] | undefined;
  let asin: string | null = null;
  if (bookId && prisma.book.findUnique) {
    const b = await prisma.book.findUnique({
      where: { id: bookId },
      select: { title: true, asin: true, theme: { select: { hook: true } } },
    });
    if (b) {
      asin = b.asin;
      bookInput = { title: b.title, ...(b.theme?.hook ? { hook: b.theme.hook } : {}), asin: b.asin };
    }
  }

  // 3. 台本生成（多エージェント）。
  const script = await createScript({
    channel: 'tiktok',
    concept,
    tone_of_voice: tone,
    topic: pillarTopic,
    sample_titles: sampleTitles,
    ...(bookInput ? { book: bookInput } : {}),
    core_hashtags: coreTags,
    target_seconds: target_seconds ?? 30,
  });

  // 4. 投稿本文（キャプション + ハッシュタグ）。
  let body = script.caption.trim();
  const tags = resolveHashtags([...new Set([...(script.hashtags ?? []), ...coreTags])]);
  body = appendHashtags('tiktok', body, tags);

  // 5. 先に post を draft 作成 → id を得て mp4 キーにする。
  const post = await prisma.promotionPost.create({
    data: {
      book_id: bookId ?? null,
      channel: 'tiktok',
      kind: bookId ? 'promo' : 'value',
      account_id: null,
      title: null,
      body,
      scheduled_for: parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for) : tomorrow20Jst(now()),
      status: 'draft',
    },
    select: { id: true },
  });

  try {
    // 6. レンダリング → R2。ハイブリッド: フラグON かつ scene0 があれば冒頭を Veo 実写級に。
    let hookClip: Buffer | undefined;
    let useVeo = parsed.data.use_veo;
    if (useVeo === undefined && prisma.appSettings) {
      const s = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { video_use_veo_enabled: true } });
      useVeo = s?.video_use_veo_enabled ?? false;
    }
    if (useVeo && script.scenes[0]) {
      try {
        hookClip = await generateHookClip(buildVeoHookPrompt(script.scenes[0].image_prompt));
      } catch (err) {
        log.warn({ task: PROMOTION_VIDEO_GENERATE_TASK_NAME, err }, 'Veo フック生成失敗 — 画像スライドで続行');
      }
    }
    const video = deps.renderVideo
      ? await deps.renderVideo(script)
      : (await renderSlideVideo(script.scenes, deps.renderDeps, hookClip ? { hookClip } : {})).video;
    const mediaKey = promotionPostVideo(post.id);
    await uploadBuffer(mediaKey, video, 'video/mp4');

    // 7. media_key を付けて scheduled に。
    await prisma.promotionPost.update({
      where: { id: post.id },
      data: { media_key: mediaKey, status: 'scheduled' },
    });

    // 8. [F-084] 同じ動画を IG リールにも予約（別枠・TikTokより2時間ずらす）。
    //    同一 media_key(mp4)を参照。publish 側で .mp4 を検知し IG も Reel(video)で投稿する。
    let reelPostId: string | undefined;
    const alsoReels = parsed.data.also_reels ?? true;
    if (alsoReels) {
      try {
        const tiktokAt = parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for) : tomorrow20Jst(now());
        const reelAt = new Date(tiktokAt.getTime() + 2 * H);
        const reel = await prisma.promotionPost.create({
          data: {
            book_id: bookId ?? null,
            channel: 'instagram',
            kind: bookId ? 'promo' : 'value',
            account_id: null,
            title: null,
            body,
            scheduled_for: reelAt,
            status: 'scheduled',
            media_key: mediaKey,
          },
          select: { id: true },
        });
        reelPostId = reel.id;
      } catch (err) {
        log.warn({ task: PROMOTION_VIDEO_GENERATE_TASK_NAME, err }, 'IG リール投稿の作成に失敗（TikTokは成功）');
      }
    }

    log.info(
      { task: PROMOTION_VIDEO_GENERATE_TASK_NAME, postId: post.id, reelPostId, scenes: script.scenes.length, asin },
      'tiktok video generated',
    );
    return { post_id: post.id, media_key: mediaKey, scenes: script.scenes.length, ...(reelPostId ? { reel_post_id: reelPostId } : {}) };
  } catch (err) {
    // レンダリング失敗時は draft を掃除。
    await prisma.promotionPost.delete({ where: { id: post.id } }).catch(() => {});
    throw err;
  }
}

export const promotionVideoGenerateTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionVideoGenerate(payload);
};
