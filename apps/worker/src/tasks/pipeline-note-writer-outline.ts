import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import { generateNoteOutline as defaultGenerateNoteOutline } from '@a2p/agents/anp/outline';
import type { NoteOutlineInput, NoteOutlineOutput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_WRITER_BODY_TASK_NAME } from './pipeline-note-writer-body.js';

/**
 * `pipeline.note.writer.outline` タスク (docs/11-anp-design.md §7, F-ANP-11).
 *
 * テーマ承認済みの `NoteArticle` に対し note Writer (outline) で「リード文 + 見出し構成」を
 * 生成し、`NoteArticle.lead` を確定 + status='writing' に遷移。見出し構成 (headings) は
 * NoteArticle に永続列を持たないため、後続 `pipeline.note.writer.body` の Job.payload_json
 * に乗せて forward する (headings は本文執筆にのみ使う一時情報)。
 *
 * フロー: A2P `pipeline.book.writer.outline` と同型 (冪等性 CAS + NoteLock + エラー方針)。
 * Phase 1 では人間承認ゲートを設けず、outline 完了で即座に writer.body へ自動連結する
 * (docs/11 §7: テーマ承認ゲートのみ人間/AI 判断、以降 outline→body→editor→eyecatch→judge は自動連結)。
 */

export const PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME = 'pipeline.note.writer.outline';

export const PipelineNoteWriterOutlinePayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type PipelineNoteWriterOutlinePayload = z.infer<
  typeof PipelineNoteWriterOutlinePayloadSchema
>;

/** note 記事 1 本あたりの既定目標文字数 (docs/11 §3.2 — 数千字)。 */
const DEFAULT_TARGET_CHARS = 4000;

export interface PipelineNoteWriterOutlinePrisma {
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
        theme_id: true;
        title: true;
        paid: true;
      };
    }) => Promise<{
      id: string;
      note_account_id: string;
      theme_id: string | null;
      title: string;
      paid: boolean;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; target_reader: true; tone: true; editorial_policy?: true };
    }) => Promise<{
      id: string;
      niche: string;
      target_reader: string | null;
      tone: string | null;
      editorial_policy?: string | null;
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

export interface PipelineNoteWriterOutlineDeps {
  prisma?: PipelineNoteWriterOutlinePrisma;
  logger?: Logger;
  generateOutline?: (input: NoteOutlineInput) => Promise<NoteOutlineOutput>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

export async function runPipelineNoteWriterOutline(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteWriterOutlineDeps = {},
): Promise<void> {
  const parsed = PipelineNoteWriterOutlinePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.writer.outline payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteWriterOutlinePrisma);
  const generateOutline = deps.generateOutline ?? defaultGenerateNoteOutline;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return;
  }

  try {
    await acquireLock({ noteArticleId, holder: `pipeline:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    await failJob(prisma, jobId, now(), lockErr, log, PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME);
    throw lockErr;
  }

  try {
    const article = await prisma.noteArticle.findUnique({
      where: { id: noteArticleId },
      select: { id: true, note_account_id: true, theme_id: true, title: true, paid: true },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: { id: true, niche: true, target_reader: true, tone: true, editorial_policy: true },
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

    const input: NoteOutlineInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: { niche: account.niche, target_reader: account.target_reader, tone: account.tone, editorial_policy: account.editorial_policy ?? null },
      theme: {
        title: article.title,
        hook: theme?.hook ?? article.title,
        target_reader: theme?.target_reader ?? account.target_reader ?? undefined,
      },
      paid: article.paid,
      target_chars: DEFAULT_TARGET_CHARS,
    };

    const outline = await generateOutline(input);

    await prisma.noteArticle.update({
      where: { id: noteArticleId },
      data: { lead: outline.lead, status: 'writing' },
    });

    try {
      await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
    } catch (costErr) {
      log.warn(
        { task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME, jobId, noteArticleId, err: costErr },
        'applyNoteArticleCostFromJob failed — continuing (cost_jpy_total may undercount)',
      );
    }

    const childJob = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_WRITER_BODY_TASK_NAME,
        status: 'queued',
        parent_job_id: jobId,
        payload_json: {
          note_article_id: noteArticleId,
          lead: outline.lead,
          headings: outline.headings,
        },
      },
    });
    await addJob(
      PIPELINE_NOTE_WRITER_BODY_TASK_NAME,
      {
        note_article_id: noteArticleId,
        job_id: childJob.id,
        lead: outline.lead,
        headings: outline.headings,
      },
      { maxAttempts: 3 },
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { headings_count: outline.headings.length, next_job_id: childJob.id },
      },
    });

    log.info(
      { task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME, jobId, noteArticleId, nextJobId: childJob.id },
      'pipeline.note.writer.outline done — pipeline.note.writer.body enqueued',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log, PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

async function failJob(
  prisma: { job: PipelineNoteWriterOutlinePrisma['job'] },
  jobId: string,
  finishedAt: Date,
  err: unknown,
  log: Logger,
  task: string,
): Promise<void> {
  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'failed', finished_at: finishedAt, error: serializeError(err) },
    });
  } catch (jobUpdateErr) {
    log.warn({ task, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

export const pipelineNoteWriterOutlineTask: Task = async (
  payload: unknown,
  helpers: JobHelpers,
) => {
  await runPipelineNoteWriterOutline(payload, helpers.addJob as unknown as AddJobLike);
};
