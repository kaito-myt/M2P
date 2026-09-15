import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import {
  editNoteArticle as defaultEditNoteArticle,
  type EditNoteArticleResult,
} from '@a2p/agents/anp/editor';
import type { NoteEditorInput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_EYECATCH_TASK_NAME } from './pipeline-note-eyecatch.js';

/**
 * `pipeline.note.editor` タスク (docs/11-anp-design.md §7, F-ANP-13).
 *
 * note Editor で校閲 (短段落・リード文最適化) を行い、`pipeline.note.eyecatch` を自動連結する。
 * `pipeline.note.judge` からの不合格差し戻し (`feedback` 付き) もこのタスクで受ける
 * (docs/11 §7: judge 不合格 → editor 1 回まで差し戻し)。
 */

export const PIPELINE_NOTE_EDITOR_TASK_NAME = 'pipeline.note.editor';

export const PipelineNoteEditorPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  feedback: z.array(z.string().max(2000)).max(20).optional(),
  /**
   * judge から差し戻された回数。editor 自体はこれを判定に使わないが、
   * eyecatch → judge へそのまま forward し、judge の RETRY_LIMIT 判定に使う
   * (docs/11 §7: editor→eyecatch→judge の 1 周を通して retry_count を運ぶ)。
   */
  retry_count: z.number().int().min(0).default(0),
});
export type PipelineNoteEditorPayload = z.infer<typeof PipelineNoteEditorPayloadSchema>;

export interface PipelineNoteEditorPrisma {
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
      select: {
        id: true;
        note_account_id: true;
        title: true;
        lead: true;
        body_md: true;
        paid: true;
        paywall_line_pos: true;
      };
    }) => Promise<{
      id: string;
      note_account_id: string;
      title: string;
      lead: string | null;
      body_md: string | null;
      paid: boolean;
      paywall_line_pos: number | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; tone: true; target_reader: true };
    }) => Promise<{
      id: string;
      niche: string;
      tone: string | null;
      target_reader: string | null;
    } | null>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNoteEditorDeps {
  prisma?: PipelineNoteEditorPrisma;
  logger?: Logger;
  editArticle?: (input: NoteEditorInput) => Promise<EditNoteArticleResult>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

export async function runPipelineNoteEditor(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteEditorDeps = {},
): Promise<void> {
  const parsed = PipelineNoteEditorPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.editor payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId, feedback, retry_count: retryCount } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_EDITOR_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteEditorPrisma);
  const editArticle = deps.editArticle ?? defaultEditNoteArticle;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
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
      select: {
        id: true,
        note_account_id: true,
        title: true,
        lead: true,
        body_md: true,
        paid: true,
        paywall_line_pos: true,
      },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }
    if (!article.body_md || !article.lead) {
      throw new NotFoundError(`NoteArticle has no body_md/lead yet: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: { id: true, niche: true, tone: true, target_reader: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const input: NoteEditorInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: { niche: account.niche, tone: account.tone, target_reader: account.target_reader },
      title: article.title,
      lead: article.lead,
      body_md: article.body_md,
      paid: article.paid,
    };
    if (article.paid && article.paywall_line_pos !== null) {
      input.paywall_line_pos = article.paywall_line_pos;
    }
    if (feedback && feedback.length > 0) input.feedback = feedback;

    const edited = await editArticle(input);

    if (article.paid && edited.paywall_line_pos === undefined) {
      // フォールバックで古い paywall_line_pos を引き継ぐと、校閲で本文が変わった後の
      // ズレた位置のまま「有料ライン確定」扱いになる (code-reviewer 指摘)。
      // editNoteArticle は marker 保持指示時は必ず再試行後に位置を返す契約のため、
      // それでも undefined ということは想定外の入力/契約違反として fail させる。
      throw new ValidationError(
        `pipeline.note.editor: paid article edited without paywall_line_pos: ${noteArticleId}`,
        { details: { noteArticleId, jobId } },
      );
    }

    await prisma.noteArticle.update({
      where: { id: noteArticleId },
      data: {
        lead: edited.lead,
        body_md: edited.body_md,
        paywall_line_pos: article.paid ? edited.paywall_line_pos! : null,
        status: 'eyecatch',
      },
    });

    try {
      await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
    } catch (costErr) {
      log.warn(
        { task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId, noteArticleId, err: costErr },
        'applyNoteArticleCostFromJob failed — continuing (cost_jpy_total may undercount)',
      );
    }

    const childJob = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_EYECATCH_TASK_NAME,
        status: 'queued',
        parent_job_id: jobId,
        payload_json: { note_article_id: noteArticleId, retry_count: retryCount },
      },
    });
    await addJob(
      PIPELINE_NOTE_EYECATCH_TASK_NAME,
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
        result_json: { next_job_id: childJob.id },
      },
    });

    log.info(
      { task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId, noteArticleId, nextJobId: childJob.id },
      'pipeline.note.editor done — pipeline.note.eyecatch enqueued',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

async function failJob(
  prisma: { job: PipelineNoteEditorPrisma['job'] },
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
      { task: PIPELINE_NOTE_EDITOR_TASK_NAME, jobId, err: jobUpdateErr },
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

export const pipelineNoteEditorTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineNoteEditor(payload, helpers.addJob as unknown as AddJobLike);
};
