/**
 * `promotion.note.article.video` タスク (docs/11-anp-design.md §3.4/§7 Phase4, F-ANP-30 続き)。
 *
 * `promotion.note.article` の公開成功時、当該記事のアカウントが `settings_json.tiktok_enabled=true`
 * (既定 OFF、コスト保護) のときだけ enqueue される。既存の TikTok スライド動画生成経路
 * (`createTikTokVideoScript` / `renderSlideVideo`、`promotion-video-generate.ts` と同型) に
 * note 記事のタイトル/リードを「宣伝する本」相当の入力として差し替えて乗せる — 新しい生成器は
 * 作らない。CTA は「プロフィールの note で全文」を明示的に付加する。
 *
 * `promotion_posts` に `kind='anp_article', channel='tiktok', note_article_id=<article>,
 * media_key=<mp4>` で登録し、既存の `promotion.dispatch`/投稿処理にそのまま乗せる。
 */
import type { Task } from 'graphile-worker';
import { z } from 'zod';

import { createTikTokVideoScript as defaultCreateScript } from '@a2p/agents';
import { AccountStrategyProfileSchema, type TikTokVideoInput, type VideoScript } from '@a2p/contracts/agents';
import { appendHashtags, resolveHashtags } from '@a2p/contracts/promotion/channels';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';
import { promotionPostVideo } from '@a2p/storage/keys';

import { offpeakScheduledForUtc } from './lib/promo-schedule.js';
import { renderSlideVideo, type RenderVideoDeps } from './promotion-post/video-render.js';

export const PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME = 'promotion.note.article.video';

export const PromotionNoteArticleVideoPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type PromotionNoteArticleVideoPayload = z.infer<typeof PromotionNoteArticleVideoPayloadSchema>;

/** 既存 TikTok value 投稿(20:00 JST 予約)と衝突しない枠外時刻。 */
const SCHEDULED_MINUTE_JST = 18 * 60;

interface NoteArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  lead: string | null;
  body_md: string | null;
  note_url: string | null;
  publish_status: string;
}
interface NoteAccountRow {
  id: string;
  niche: string;
  tone: string | null;
}

export interface PromotionNoteArticleVideoPrisma {
  job: {
    findUnique: (args: { where: { id: string }; select: { status: true } }) => Promise<{ status: string } | null>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; started_at?: Date };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; finished_at?: Date; error?: string | null; result_json?: unknown };
    }) => Promise<unknown>;
  };
  noteArticle: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        note_account_id: true;
        title: true;
        lead: true;
        body_md: true;
        note_url: true;
        publish_status: true;
      };
    }) => Promise<NoteArticleRow | null>;
  };
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; tone: true };
    }) => Promise<NoteAccountRow | null>;
  };
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { strategy_json: true };
    }) => Promise<{ strategy_json: unknown } | null>;
  };
  promotionPost: {
    findFirst: (args: {
      where: { note_article_id: string; kind: string; channel: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
}

interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<{ key: string }>;
}

export interface PromotionNoteArticleVideoDeps {
  prisma?: PromotionNoteArticleVideoPrisma;
  logger?: Logger;
  now?: () => Date;
  createScript?: (input: TikTokVideoInput) => Promise<VideoScript>;
  renderVideo?: (script: VideoScript) => Promise<Buffer>;
  renderDeps?: RenderVideoDeps;
  uploadBuffer?: UploadBufferFn;
}

export interface PromotionNoteArticleVideoResult {
  ok: boolean;
  status: 'created' | 'skipped';
  reason?: string;
  post_id?: string;
}

/** CTA が既に含まれていなければ「プロフィールの note で全文」を明示的に付加する。 */
export function ensureNoteCta(caption: string): string {
  if (caption.includes('note')) return caption;
  return `${caption.trim()}\nプロフィールの note で全文`;
}

async function defaultUploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer(key, buffer, contentType);
}

export async function runPromotionNoteArticleVideo(
  payload: unknown,
  deps: PromotionNoteArticleVideoDeps = {},
): Promise<PromotionNoteArticleVideoResult> {
  const parsed = PromotionNoteArticleVideoPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('promotion.note.article.video payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: articleId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionNoteArticleVideoPrisma);
  const now = deps.now ?? (() => new Date());
  const createScript = deps.createScript ?? ((input: TikTokVideoInput) => defaultCreateScript(input));
  const uploadBuffer = deps.uploadBuffer ?? defaultUploadBuffer;

  const existingJob = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existingJob) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, articleId } });
  }
  if (existingJob.status === 'done') {
    return { ok: true, status: 'skipped', reason: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    return { ok: true, status: 'skipped', reason: 'not_queued' };
  }

  try {
    const article = await prisma.noteArticle.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        note_account_id: true,
        title: true,
        lead: true,
        body_md: true,
        note_url: true,
        publish_status: true,
      },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${articleId}`, { details: { articleId, jobId } });
    }
    if (article.publish_status !== 'published' || !article.note_url) {
      await finishJob(prisma, jobId, now(), { status: 'skipped', reason: 'not_published' });
      return { ok: false, status: 'skipped', reason: 'not_published' };
    }

    // 冪等性: 既に同一記事の tiktok 告知投稿が生成済みなら再生成しない。
    const dup = await prisma.promotionPost.findFirst({
      where: { note_article_id: articleId, kind: 'anp_article', channel: 'tiktok' },
      select: { id: true },
    });
    if (dup) {
      await finishJob(prisma, jobId, now(), { status: 'skipped', reason: 'already_generated' });
      return { ok: false, status: 'skipped', reason: 'already_generated' };
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: { id: true, niche: true, tone: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const setting = await prisma.promotionChannelSetting.findUnique({
      where: { channel: 'tiktok' },
      select: { strategy_json: true },
    });
    const profile = setting?.strategy_json ? AccountStrategyProfileSchema.safeParse(setting.strategy_json) : null;
    const coreTags = profile?.success ? profile.data.hashtag_strategy.core : [];

    // 「宣伝する本」入力に記事のタイトル/リード(要点の種)を差し替える(既存台本パイプラインを流用)。
    const hookSource = (article.lead ?? article.body_md ?? '').slice(0, 380);
    const script = await createScript({
      channel: 'tiktok',
      concept: account.niche,
      tone_of_voice: account.tone ?? '',
      topic: article.title,
      sample_titles: [],
      book: { title: article.title, hook: hookSource || undefined },
      core_hashtags: coreTags,
      target_seconds: 30,
    });

    const captionWithCta = ensureNoteCta(script.caption.trim());
    const tags = resolveHashtags([...new Set([...(script.hashtags ?? []), ...coreTags])]);
    const body = appendHashtags('tiktok', captionWithCta, tags);

    const post = await prisma.promotionPost.create({
      data: {
        book_id: null,
        channel: 'tiktok',
        kind: 'anp_article',
        account_id: null,
        note_article_id: articleId,
        title: null,
        body,
        scheduled_for: offpeakScheduledForUtc(now(), 1, SCHEDULED_MINUTE_JST),
        status: 'draft',
      },
      select: { id: true },
    });

    try {
      const video = deps.renderVideo
        ? await deps.renderVideo(script)
        : (await renderSlideVideo(script.scenes, deps.renderDeps)).video;
      const mediaKey = promotionPostVideo(post.id);
      await uploadBuffer(mediaKey, video, 'video/mp4');
      await prisma.promotionPost.update({ where: { id: post.id }, data: { media_key: mediaKey, status: 'scheduled' } });

      await finishJob(prisma, jobId, now(), { status: 'created', post_id: post.id });
      log.info({ task: PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME, articleId, postId: post.id }, 'note article tiktok video generated');
      return { ok: true, status: 'created', post_id: post.id };
    } catch (err) {
      await prisma.promotionPost.delete({ where: { id: post.id } }).catch(() => {});
      throw err;
    }
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  }
}

async function finishJob(
  prisma: { job: PromotionNoteArticleVideoPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  resultJson: Record<string, unknown>,
): Promise<void> {
  await prisma.job
    .update({ where: { id: jobId }, data: { status: 'done', finished_at: finishedAt, error: null, result_json: resultJson } })
    .catch(() => {});
}

async function failJob(
  prisma: { job: PromotionNoteArticleVideoPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  err: unknown,
  log: Logger,
): Promise<void> {
  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'failed', finished_at: finishedAt, error: serializeError(err) },
    });
  } catch (jobUpdateErr) {
    log.warn({ task: PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export const promotionNoteArticleVideoTask: Task = async (payload: unknown) => {
  await runPromotionNoteArticleVideo(payload);
};
