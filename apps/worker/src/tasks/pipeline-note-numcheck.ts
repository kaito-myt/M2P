import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import {
  checkNoteNumbers as defaultCheckNoteNumbers,
  type CheckNoteNumbersResult,
} from '@a2p/agents/anp/numcheck';
import type { NoteNumCheckInput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_EYECATCH_TASK_NAME } from './pipeline-note-eyecatch.js';

/**
 * `pipeline.note.numcheck` タスク (docs/11-anp-design.md §7, 2026-10-09).
 *
 * 校閲 (`pipeline.note.editor`) の後、アイキャッチ生成の前に、**本文内の数値の自己整合**
 * だけを確かめて直す。
 *
 * なぜ必要か (2026-10-09 実測):
 *   judge は本文の表を実際に再計算して不一致を指摘してくる。差し戻し例は
 *   「下位区分の合計が147件で記載の148件と不一致」「無料部分の『準備20分』と
 *   有料部分の表の『準備25分』が食い違う」。writer のプロンプトに整合を要求しても
 *   消えなかったので、工程として分離した (A2P の namecheck/contcheck と同じ考え方)。
 *
 * 安全側の設計:
 *   - エージェント側で「訂正の範囲を超えた出力」(見出しが変わる・本文長が ±15% 超) は
 *     採用せず**入力本文を素通し**する。数値の不整合は judge が拾うので検出網は残る。
 *   - この工程が失敗しても**パイプラインは止めない**: 本文をそのままにして eyecatch へ進む。
 *     「数字を直す」工程の失敗で記事全体を落とすのは割に合わない。
 *   - 直した内容・直せなかった内容は `Job.result_json` に残し、運営者が追えるようにする。
 */

export const PIPELINE_NOTE_NUMCHECK_TASK_NAME = 'pipeline.note.numcheck';

export const PipelineNoteNumcheckPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  /** judge の RETRY_LIMIT 判定用。editor → eyecatch → judge へそのまま運ぶ。 */
  retry_count: z.number().int().min(0).default(0),
});
export type PipelineNoteNumcheckPayload = z.infer<typeof PipelineNoteNumcheckPayloadSchema>;

export interface PipelineNoteNumcheckPrisma {
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
        body_md: true;
        paid: true;
        paywall_line_pos: true;
      };
    }) => Promise<{
      id: string;
      note_account_id: string;
      title: string;
      body_md: string | null;
      paid: boolean;
      paywall_line_pos: number | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; tone: true; target_reader: true; editorial_policy?: true };
    }) => Promise<{
      id: string;
      niche: string;
      tone: string | null;
      target_reader: string | null;
      editorial_policy?: string | null;
    } | null>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNoteNumcheckDeps {
  prisma?: PipelineNoteNumcheckPrisma;
  logger?: Logger;
  checkNumbers?: (input: NoteNumCheckInput) => Promise<CheckNoteNumbersResult>;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
}

export async function runPipelineNoteNumcheck(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineNoteNumcheckDeps = {},
): Promise<void> {
  const parsed = PipelineNoteNumcheckPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.numcheck payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: noteArticleId, job_id: jobId, retry_count: retryCount } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_NUMCHECK_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteNumcheckPrisma);
  const checkNumbers = deps.checkNumbers ?? defaultCheckNoteNumbers;
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteArticleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId }, 'job already done — skipping');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
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
    if (!article.body_md) {
      throw new NotFoundError(`NoteArticle has no body_md yet: ${noteArticleId}`, {
        details: { noteArticleId, jobId },
      });
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: { id: true, niche: true, tone: true, target_reader: true, editorial_policy: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const input: NoteNumCheckInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: {
        niche: account.niche,
        tone: account.tone,
        target_reader: account.target_reader,
        editorial_policy: account.editorial_policy ?? null,
      },
      title: article.title,
      body_md: article.body_md,
      paid: article.paid,
    };
    if (article.paid && article.paywall_line_pos !== null) {
      input.paywall_line_pos = article.paywall_line_pos;
    }

    // この工程の失敗でパイプラインを止めない。数字を直せなくても記事は進める
    // (数値の不整合は judge が拾って差し戻す)。
    let checked: CheckNoteNumbersResult;
    try {
      checked = await checkNumbers(input);
    } catch (err) {
      log.warn(
        { task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId, noteArticleId, err },
        'numcheck failed — 本文はそのままで eyecatch へ進む',
      );
      checked = {
        body_md: article.body_md,
        fixes: [],
        unresolved: [`数値チェックが例外で終了: ${err instanceof Error ? err.message : String(err)}`],
        applied: false,
        ...(article.paid && article.paywall_line_pos !== null
          ? { paywall_line_pos: article.paywall_line_pos }
          : {}),
      };
    }

    // 有料記事で位置が取れなかった場合は本文を書き換えない。ズレた位置のまま
    // 「有料ライン確定」にすると、無料部分の途中で課金される事故になる。
    const paywallOk = !article.paid || checked.paywall_line_pos !== undefined;
    const shouldWrite = checked.applied && paywallOk && checked.body_md !== article.body_md;

    if (shouldWrite) {
      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: {
          body_md: checked.body_md,
          paywall_line_pos: article.paid ? checked.paywall_line_pos! : null,
          status: 'eyecatch',
        },
      });
    } else {
      await prisma.noteArticle.update({ where: { id: noteArticleId }, data: { status: 'eyecatch' } });
    }

    try {
      await applyNoteArticleCostFromJob(prisma, jobId, noteArticleId);
    } catch (costErr) {
      log.warn(
        { task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId, noteArticleId, err: costErr },
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
      { note_article_id: noteArticleId, job_id: childJob.id, retry_count: retryCount },
      { maxAttempts: 3 },
    );

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: {
          // accepted = エージェントの出力を採用できたか / changed = 本文を書き換えたか。
          // 「採用できたが直すところが無かった」(accepted=true, changed=false) と
          // 「出力を採用できなかった」(accepted=false) は別物なので分けて残す。
          accepted: checked.applied,
          changed: shouldWrite,
          fixes: checked.fixes,
          unresolved: checked.unresolved,
          next_job_id: childJob.id,
        },
      },
    });

    log.info(
      {
        task: PIPELINE_NOTE_NUMCHECK_TASK_NAME,
        jobId,
        noteArticleId,
        accepted: checked.applied,
        changed: shouldWrite,
        fixCount: checked.fixes.length,
        unresolvedCount: checked.unresolved.length,
        nextJobId: childJob.id,
      },
      'pipeline.note.numcheck done — pipeline.note.eyecatch enqueued',
    );
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId, noteArticleId, err: releaseErr },
        'failed to release NoteLock (will be swept by locks.sweep)',
      );
    }
  }
}

async function failJob(
  prisma: { job: PipelineNoteNumcheckPrisma['job'] },
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
      { task: PIPELINE_NOTE_NUMCHECK_TASK_NAME, jobId, err: jobUpdateErr },
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

export const pipelineNoteNumcheckTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineNoteNumcheck(payload, helpers.addJob as unknown as AddJobLike);
};
