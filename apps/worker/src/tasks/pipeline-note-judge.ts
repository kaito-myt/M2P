import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import { judgeNoteArticle as defaultJudgeNoteArticle } from '@a2p/agents/anp/judge';
import { NOTE_JUDGE_PASS_THRESHOLD, type NoteJudgeInput, type NoteJudgeOutput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_EDITOR_TASK_NAME } from './pipeline-note-editor.js';

/**
 * `pipeline.note.judge` タスク (docs/11-anp-design.md §7, F-ANP-15).
 *
 * note Quality Judge が 4 軸採点 (フック強度/可読性/有料転換見込み/検索流入見込み) を行い、
 * 合格 (>= 80) なら `NoteArticle.status='ready'` (公開ゲート待ち。note 公開自体は Phase 2)。
 * 不合格は `pipeline.note.editor` へ 1 回だけ差し戻す (A2P Judge の RETRY_LIMIT=1 と同じ)。
 * 2 回目も不合格なら `NoteArticle.status='needs_human_review'` に遷移する
 * (note_articles.status の取りうる値に Phase 1 で追加。docs/11 §6 に追記)。
 *
 * NOTE: `eval_results` テーブルは `book_id` NOT NULL FK (Book 専用) のため ANP では使えない。
 * 代わりに `NoteArticle.quality_score` に最終スコアのみ保持し、内訳/コメントは
 * `Job.result_json` に残す (Phase 1 の簡略化。詳細は docs/11 §6/§7 に記載)。
 */

export const PIPELINE_NOTE_JUDGE_TASK_NAME = 'pipeline.note.judge';

/** judge 不合格時に editor へ差し戻す最大回数 (A2P と同じ 1 回)。 */
const RETRY_LIMIT = 1;

export const PipelineNoteJudgePayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  retry_count: z.number().int().min(0).default(0),
});
export type PipelineNoteJudgePayload = z.infer<typeof PipelineNoteJudgePayloadSchema>;

export interface PipelineNoteJudgePrisma {
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
        price_jpy: true;
      };
    }) => Promise<{
      id: string;
      note_account_id: string;
      title: string;
      lead: string | null;
      body_md: string | null;
      paid: boolean;
      price_jpy: number | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; target_reader: true };
    }) => Promise<{ id: string; niche: string; target_reader: string | null } | null>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNoteJudgeDeps {
  prisma?: PipelineNoteJudgePrisma;
  logger?: Logger;
  judgeArticle?: (input: NoteJudgeInput) => Promise<NoteJudgeOutput>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

export async function runPipelineNoteJudge(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteJudgeDeps = {},
): Promise<void> {
  const parsed = PipelineNoteJudgePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.judge payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId, retry_count: retryCount } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_JUDGE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteJudgePrisma);
  const judgeArticle = deps.judgeArticle ?? defaultJudgeNoteArticle;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
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
        price_jpy: true,
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
      select: { id: true, niche: true, target_reader: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const input: NoteJudgeInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: { niche: account.niche, target_reader: account.target_reader },
      title: article.title,
      lead: article.lead,
      body_md: article.body_md,
      paid: article.paid,
    };
    if (article.paid && article.price_jpy !== null) input.price_jpy = article.price_jpy;

    const judged = await judgeArticle(input);

    try {
      await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
    } catch (costErr) {
      log.warn(
        { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, err: costErr },
        'applyNoteArticleCostFromJob failed — continuing (cost_jpy_total may undercount)',
      );
    }

    let phase: string;
    let nextJobId: string | null = null;

    if (judged.score_total >= NOTE_JUDGE_PASS_THRESHOLD) {
      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: { quality_score: judged.score_total, status: 'ready' },
      });
      phase = 'ready';
      log.info(
        { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, scoreTotal: judged.score_total },
        'score >= threshold — NoteArticle status=ready',
      );
    } else if (retryCount < RETRY_LIMIT) {
      const nextRetryCount = retryCount + 1;
      const feedbackItems = toFeedbackItems(judged);

      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: { quality_score: judged.score_total, status: 'editing' },
      });

      const editorJob = await prisma.job.create({
        data: {
          kind: PIPELINE_NOTE_EDITOR_TASK_NAME,
          status: 'queued',
          parent_job_id: jobId,
          payload_json: {
            note_article_id: noteArticleId,
            feedback: feedbackItems,
            retry_count: nextRetryCount,
          },
        },
      });
      // retry_count は editor → eyecatch → judge へそのまま forward され、次回
      // pipeline.note.judge の RETRY_LIMIT 判定に使われる (無限ループ防止)。
      await addJob(
        PIPELINE_NOTE_EDITOR_TASK_NAME,
        {
          note_article_id: noteArticleId,
          job_id: editorJob.id,
          feedback: feedbackItems,
          retry_count: nextRetryCount,
        },
        { maxAttempts: 2 },
      );
      nextJobId = editorJob.id;
      phase = 'retry';

      log.info(
        {
          task: PIPELINE_NOTE_JUDGE_TASK_NAME,
          jobId,
          noteArticleId,
          scoreTotal: judged.score_total,
          nextRetryCount,
          editorJobId: editorJob.id,
        },
        'score < threshold — pipeline.note.editor re-kicked',
      );
    } else {
      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: { quality_score: judged.score_total, status: 'needs_human_review' },
      });
      phase = 'needs_human_review';
      log.warn(
        { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, scoreTotal: judged.score_total, retryCount },
        'score < threshold and retry_count exhausted — needs_human_review',
      );
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: {
          score_total: judged.score_total,
          score_breakdown: judged.score_breakdown,
          judge_comments: judged.judge_comments,
          retry_count: retryCount,
          phase,
          next_job_id: nextJobId,
        },
      },
    });

    log.info(
      { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, phase, scoreTotal: judged.score_total },
      'pipeline.note.judge done',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

function toFeedbackItems(output: NoteJudgeOutput): string[] {
  const bd = output.score_breakdown;
  const axisNames: Record<keyof typeof bd, string> = {
    hook_strength: 'フック強度',
    readability: '可読性',
    paid_conversion: '有料転換見込み',
    search_inflow: '検索流入見込み',
  };
  const items: string[] = [`品質スコア: ${output.score_total}/100`];
  for (const [key, label] of Object.entries(axisNames) as [keyof typeof bd, string][]) {
    const score = bd[key];
    const comment = output.judge_comments[key];
    if (score < NOTE_JUDGE_PASS_THRESHOLD) {
      items.push(`${label} (${score}/100)${comment ? `: ${comment}` : ''}`.slice(0, 2000));
    }
  }
  if (output.judge_comments['overall']) {
    items.push(`総評: ${output.judge_comments['overall']}`.slice(0, 2000));
  }
  return items.length > 0 ? items : ['品質基準未達のため全体的に改善してください。'];
}

async function failJob(
  prisma: { job: PipelineNoteJudgePrisma['job'] },
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
      { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, err: jobUpdateErr },
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

export const pipelineNoteJudgeTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineNoteJudge(payload, helpers.addJob as unknown as AddJobLike);
};
