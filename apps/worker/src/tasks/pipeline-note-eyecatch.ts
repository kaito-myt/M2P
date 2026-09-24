import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import {
  generateNoteEyecatch as defaultGenerateNoteEyecatch,
  type GenerateNoteEyecatchInput,
  type GenerateNoteEyecatchResult,
} from '@a2p/agents/anp/eyecatch';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_JUDGE_TASK_NAME } from './pipeline-note-judge.js';

/**
 * `pipeline.note.eyecatch` タスク (docs/11-anp-design.md §7, F-ANP-14).
 *
 * note 記事のアイキャッチ画像を生成し R2 に保存、`pipeline.note.judge` を自動連結する。
 */

export const PIPELINE_NOTE_EYECATCH_TASK_NAME = 'pipeline.note.eyecatch';

export const PipelineNoteEyecatchPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  /** judge の RETRY_LIMIT 判定用。editor → eyecatch → judge へそのまま forward する。 */
  retry_count: z.number().int().min(0).default(0),
});
export type PipelineNoteEyecatchPayload = z.infer<typeof PipelineNoteEyecatchPayloadSchema>;

/**
 * F-ANP-14b: 同一アカウントの直近アイキャッチ 3 件で使った画風キー。`jobs.result_json.style_key` に
 * 保存しているので、記事 → アカウントの join を避けて記事 id の集合で引く。
 */
export async function defaultRecentStyleKeys(prisma: PipelineNoteEyecatchPrisma, noteAccountId: string): Promise<string[]> {
  const repo = (prisma as unknown as {
    noteArticle?: { findMany?: (args: unknown) => Promise<Array<{ id: string }>> };
    job?: { findMany?: (args: unknown) => Promise<Array<{ result_json: unknown }>> };
  });
  if (!repo.noteArticle?.findMany || !repo.job?.findMany) return [];
  const articles = await repo.noteArticle.findMany({
    where: { note_account_id: noteAccountId },
    orderBy: { created_at: 'desc' },
    take: 6,
    select: { id: true },
  });
  if (articles.length === 0) return [];
  const jobs = await repo.job.findMany({
    where: { kind: PIPELINE_NOTE_EYECATCH_TASK_NAME, status: 'done', payload_json: { path: ['note_article_id'], in: articles.map((a) => a.id) } },
    orderBy: { created_at: 'desc' },
    take: 3,
    select: { result_json: true },
  });
  const keys: string[] = [];
  for (const j of jobs) {
    const r = (j.result_json ?? {}) as { style_key?: unknown };
    if (typeof r.style_key === 'string' && r.style_key.length > 0 && !keys.includes(r.style_key)) keys.push(r.style_key);
  }
  return keys;
}

export interface PipelineNoteEyecatchPrisma {
  job: {
    findUnique: (args: {
      where: { id: string };
      select: { status: true };
    }) => Promise<{ status: string } | null>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; started_at?: Date };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; finished_at?: Date; error?: string | null; result_json?: unknown };
    }) => Promise<unknown>;
    create: (args: {
      data: { kind: string; status: string; payload_json: unknown; parent_job_id?: string };
    }) => Promise<{ id: string }>;
  };
  noteArticle: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; note_account_id: true; theme_id: true; title: true; eyecatch_r2_key: true };
    }) => Promise<{
      id: string;
      note_account_id: string;
      theme_id: string | null;
      title: string;
      eyecatch_r2_key: string | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; editorial_policy?: true };
    }) => Promise<{ id: string; niche: string; editorial_policy?: string | null } | null>;
  };
  noteTheme: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; hook: true };
    }) => Promise<{ id: string; hook: string } | null>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNoteEyecatchDeps {
  prisma?: PipelineNoteEyecatchPrisma;
  logger?: Logger;
  generateEyecatch?: (input: GenerateNoteEyecatchInput) => Promise<GenerateNoteEyecatchResult>;
  /** F-ANP-14b: 直近の画風キーを取得する (既定は同一アカウントの直近 job の result_json から)。 */
  recentStyleKeys?: (noteAccountId: string) => Promise<string[]>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

export async function runPipelineNoteEyecatch(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteEyecatchDeps = {},
): Promise<void> {
  const parsed = PipelineNoteEyecatchPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.eyecatch payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId, retry_count: retryCount } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_EYECATCH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteEyecatchPrisma);
  const generateEyecatch = deps.generateEyecatch ?? defaultGenerateNoteEyecatch;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return;
  }

  try {
    await acquireLock({ noteArticleId, holder: `pipeline:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    await failJob(prisma, jobId, now(), lockErr, log);
    throw lockErr;
  }

  try {
    const article = await prisma.noteArticle.findUnique({
      where: { id: noteArticleId },
      select: { id: true, note_account_id: true, theme_id: true, title: true, eyecatch_r2_key: true },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }

    // judge 差し戻し (retry_count > 0) 経由で本タスクが再度呼ばれた場合、本文はエディタで
    // 変わりうるが挿絵の作り直しは通常不要 — 既に生成済みなら再生成せず画像コストの
    // 重複を避ける (code-reviewer 任意提案)。
    let r2Key: string;
    let styleKey: string | null = null;
    if (retryCount > 0 && article.eyecatch_r2_key) {
      r2Key = article.eyecatch_r2_key;
      log.info(
        { task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId, noteArticleId, retryCount },
        'retry with existing eyecatch — skipping regeneration',
      );
    } else {
      const account = await prisma.noteAccount.findUnique({
        where: { id: article.note_account_id },
        select: { id: true, niche: true, editorial_policy: true },
      });
      if (!account) {
        throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
          details: { noteAccountId: article.note_account_id, jobId },
        });
      }

      const theme = article.theme_id
        ? await prisma.noteTheme.findUnique({ where: { id: article.theme_id }, select: { id: true, hook: true } })
        : null;

      // F-ANP-14b: 直近 (同一アカウント) で使った画風を避ける → 連続する記事のサムネが揃わない。
      const recent = deps.recentStyleKeys
        ? await deps.recentStyleKeys(article.note_account_id).catch(() => [])
        : await defaultRecentStyleKeys(prisma, article.note_account_id).catch(() => []);

      const result = await generateEyecatch({
        noteArticleId,
        jobId,
        title: article.title,
        hook: theme?.hook ?? article.title,
        niche: account.niche,
        recentStyleKeys: recent,
        ...(account.editorial_policy ? { editorialPolicy: account.editorial_policy } : {}),
      });
      r2Key = result.r2Key;
      styleKey = result.styleKey;

      try {
        await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
      } catch (costErr) {
        log.warn(
          { task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId, noteArticleId, err: costErr },
          'applyNoteArticleCostFromJob failed — continuing (cost_jpy_total may undercount)',
        );
      }
    }

    await prisma.noteArticle.update({
      where: { id: noteArticleId },
      data: { eyecatch_r2_key: r2Key, status: 'judging' },
    });

    const childJob = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_JUDGE_TASK_NAME,
        status: 'queued',
        parent_job_id: jobId,
        payload_json: { note_article_id: noteArticleId, retry_count: retryCount },
      },
    });
    await addJob(
      PIPELINE_NOTE_JUDGE_TASK_NAME,
      {
        note_article_id: noteArticleId,
        job_id: childJob.id,
        retry_count: retryCount,
      },
      { maxAttempts: 3 },
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { r2_key: r2Key, next_job_id: childJob.id, skipped_regeneration: retryCount > 0 && !!article.eyecatch_r2_key, style_key: styleKey },
      },
    });

    log.info(
      { task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId, noteArticleId, nextJobId: childJob.id },
      'pipeline.note.eyecatch done — pipeline.note.judge enqueued',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

async function failJob(
  prisma: { job: PipelineNoteEyecatchPrisma['job'] },
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
    log.warn(
      { task: PIPELINE_NOTE_EYECATCH_TASK_NAME, jobId, err: jobUpdateErr },
      'failed to mark internal Job as failed',
    );
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

export const pipelineNoteEyecatchTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineNoteEyecatch(payload, helpers.addJob as unknown as AddJobLike);
};
