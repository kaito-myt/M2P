import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import { generateNoteBody as defaultGenerateNoteBody } from '@a2p/agents/anp/writer';
import type { NoteWriterInput, NoteWriterOutput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_EDITOR_TASK_NAME } from './pipeline-note-editor.js';

/**
 * `pipeline.note.writer.body` タスク (docs/11-anp-design.md §7, F-ANP-12).
 *
 * `pipeline.note.writer.outline` から連結される本文執筆タスク。無料/有料ラインを持つ
 * note 本文を生成し `NoteArticle.body_md` / `paywall_line_pos` を確定、`pipeline.note.editor`
 * を自動連結する。フロー/エラー方針は A2P `pipeline.book.writer.chapter` と同型。
 */

export const PIPELINE_NOTE_WRITER_BODY_TASK_NAME = 'pipeline.note.writer.body';

export const PipelineNoteWriterBodyPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  lead: z.string().min(1),
  headings: z.array(z.string().min(1)).min(1),
  feedback: z.array(z.string().max(2000)).max(20).optional(),
});
export type PipelineNoteWriterBodyPayload = z.infer<typeof PipelineNoteWriterBodyPayloadSchema>;

const DEFAULT_TARGET_CHARS = 4000;
const DEFAULT_FREE_RATIO = 0.3;

export interface PipelineNoteWriterBodyPrisma {
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
      select: { id: true; note_account_id: true; theme_id: true; title: true; paid: true; price_jpy: true };
    }) => Promise<{
      id: string;
      note_account_id: string;
      theme_id: string | null;
      title: string;
      paid: boolean;
      price_jpy: number | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; target_reader: true; tone: true; monetization_policy_json: true };
    }) => Promise<{
      id: string;
      niche: string;
      target_reader: string | null;
      tone: string | null;
      monetization_policy_json: unknown;
    } | null>;
  };
  noteTheme: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; hook: true; target_reader: true };
    }) => Promise<{ id: string; hook: string; target_reader: string | null } | null>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNoteWriterBodyDeps {
  prisma?: PipelineNoteWriterBodyPrisma;
  logger?: Logger;
  generateBody?: (input: NoteWriterInput) => Promise<NoteWriterOutput>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

function readFreeRatio(monetizationPolicyJson: unknown): number {
  if (
    monetizationPolicyJson &&
    typeof monetizationPolicyJson === 'object' &&
    'free_ratio' in monetizationPolicyJson
  ) {
    const v = (monetizationPolicyJson as { free_ratio?: unknown }).free_ratio;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1) return v;
  }
  return DEFAULT_FREE_RATIO;
}

export async function runPipelineNoteWriterBody(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteWriterBodyDeps = {},
): Promise<void> {
  const parsed = PipelineNoteWriterBodyPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.writer.body payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId, lead, headings, feedback } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_WRITER_BODY_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteWriterBodyPrisma);
  const generateBody = deps.generateBody ?? defaultGenerateNoteBody;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
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
        theme_id: true,
        title: true,
        paid: true,
        price_jpy: true,
      },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: {
        id: true,
        niche: true,
        target_reader: true,
        tone: true,
        monetization_policy_json: true,
      },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const theme = article.theme_id
      ? await prisma.noteTheme.findUnique({
          where: { id: article.theme_id },
          select: { id: true, hook: true, target_reader: true },
        })
      : null;

    const input: NoteWriterInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: { niche: account.niche, target_reader: account.target_reader, tone: account.tone },
      theme: {
        title: article.title,
        hook: theme?.hook ?? article.title,
        target_reader: theme?.target_reader ?? account.target_reader ?? undefined,
      },
      lead,
      headings,
      paid: article.paid,
      target_chars: DEFAULT_TARGET_CHARS,
      free_ratio: readFreeRatio(account.monetization_policy_json),
    };
    if (article.paid && article.price_jpy !== null) input.price_jpy = article.price_jpy;
    if (feedback && feedback.length > 0) input.feedback = feedback;

    const body = await generateBody(input);

    await prisma.noteArticle.update({
      where: { id: noteArticleId },
      data: {
        body_md: body.body_md,
        paywall_line_pos: body.paywall_line_pos ?? null,
        status: 'editing',
      },
    });

    try {
      await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
    } catch (costErr) {
      log.warn(
        { task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId, noteArticleId, err: costErr },
        'applyNoteArticleCostFromJob failed — continuing (cost_jpy_total may undercount)',
      );
    }

    const childJob = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_EDITOR_TASK_NAME,
        status: 'queued',
        parent_job_id: jobId,
        payload_json: { note_article_id: noteArticleId },
      },
    });
    await addJob(
      PIPELINE_NOTE_EDITOR_TASK_NAME,
      { note_article_id: noteArticleId, job_id: childJob.id },
      { maxAttempts: 3 },
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { char_count: body.char_count, next_job_id: childJob.id },
      },
    });

    log.info(
      { task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId, noteArticleId, nextJobId: childJob.id },
      'pipeline.note.writer.body done — pipeline.note.editor enqueued',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

async function failJob(
  prisma: { job: PipelineNoteWriterBodyPrisma['job'] },
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
      { task: PIPELINE_NOTE_WRITER_BODY_TASK_NAME, jobId, err: jobUpdateErr },
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

export const pipelineNoteWriterBodyTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineNoteWriterBody(payload, helpers.addJob as unknown as AddJobLike);
};
