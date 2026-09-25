import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import { judgeNoteArticle as defaultJudgeNoteArticle } from '@a2p/agents/anp/judge';
import {
  NOTE_JUDGE_PASS_THRESHOLD,
  routeByJudgeScore,
  type NoteJudgeInput,
  type NoteJudgeOutput,
} from '@a2p/contracts/agents/anp';
import { parseNoteAccountSettings } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { applyNoteArticleCostFromJob, type NoteArticleCostPrisma } from './lib/note-article-cost.js';
import type { NoteArticleRepo } from './lib/note-article-repo.js';
import { PIPELINE_NOTE_EDITOR_TASK_NAME } from './pipeline-note-editor.js';
import { PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME } from './pipeline-note-writer-outline.js';

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

/**
 * judge 不合格時に自動で差し戻す最大回数。
 *
 * 2026-09-25: 合格ライン 85 + judge を gpt-6-sol(high) に上げた直後の実測で、前夜に生成した
 * 10 本が **すべて 1 回の差し戻しでは 85 に届かず** needs_human_review に溜まった (平均 75)。
 * 「修正は自動でやってほしい」という運営者の意図に合わせ、自動リトライを 2 回に増やす
 * (1 回目=スコア帯に応じて校閲 or 構成から、2 回目=同じ経路でもう一度)。
 * それでも届かなければ従来どおり人手 (UI から再判定/校閲やり直し/強制公開が選べる)。
 */
const RETRY_LIMIT = 2;

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
        paywall_line_pos: true;
      };
    }) => Promise<{
      id: string;
      note_account_id: string;
      title: string;
      lead: string | null;
      body_md: string | null;
      paid: boolean;
      price_jpy: number | null;
      paywall_line_pos: number | null;
    } | null>;
  } & NoteArticleRepo;
  tokenUsage: NoteArticleCostPrisma['tokenUsage'];
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; target_reader: true; editorial_policy?: true; settings_json?: true };
    }) => Promise<{ id: string; niche: string; target_reader: string | null; editorial_policy?: string | null; settings_json?: unknown } | null>;
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
      select: { id: true, niche: true, target_reader: true, editorial_policy: true, settings_json: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const input: NoteJudgeInput = {
      note_article_id: noteArticleId,
      job_id: jobId,
      account: { niche: account.niche, target_reader: account.target_reader, editorial_policy: account.editorial_policy ?? null },
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

    // F-ANP-16 (docs/11 申し送り8): note の本人確認(KYC)が未完了のため有料記事は公開できない。
    // 判定が確定するタイミング(ready / needs_human_review の終端状態)では `paid` を必ず false へ
    // 強制し、judge の提案があれば `price_jpy` に「提案価格」として保存する(UIで「提案: 有料 ¥xxx」
    // と表示するための下準備。KYC完了後に有料化する際の初期値になる)。paywall_line_pos も同時に
    // クリアする — paid=false のまま残すと `buildNoteBlocks` が有料エリア以降の本文を publish 時に
    // 破棄してしまう(内容欠落)ため。
    // [F-ANP-16b] アカウント設定で有料公開が許可されていれば judge の判断どおり有料のまま確定する。
    // 許可されていない (= note の本人確認が未完了) 間は従来どおり paid=false に落として価格だけ提案として残す。
    const paidAllowed = parseNoteAccountSettings(account.settings_json).paid_publish_enabled === true;
    const finalPricing = resolveFinalPricing(article, judged, paidAllowed);

    // F-ANP-44: 85 以上=公開 / 70〜84=校閲へ / 69 以下=構成から書き直し / 差し戻し上限=人手。
    const route = routeByJudgeScore(judged.score_total, retryCount, RETRY_LIMIT);

    if (route === 'ready') {
      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: {
          quality_score: judged.score_total,
          status: 'ready',
          paid: finalPricing.paid,
          price_jpy: finalPricing.price_jpy,
          // 無料化するときだけ有料ラインを消す (paid=false のまま残すと publish 時に有料本文が破棄される)。
          paywall_line_pos: finalPricing.paid ? article.paywall_line_pos : null,
        },
      });
      phase = 'ready';
      log.info(
        { task: PIPELINE_NOTE_JUDGE_TASK_NAME, jobId, noteArticleId, scoreTotal: judged.score_total },
        'score >= threshold — NoteArticle status=ready',
      );
    } else if (route === 'editor' || route === 'writer') {
      const nextRetryCount = retryCount + 1;
      const feedbackItems = toFeedbackItems(judged);
      // 69 点以下は校閲では直らない (構成・切り口の問題) ので outline からやり直す。
      const targetTask =
        route === 'writer' ? PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME : PIPELINE_NOTE_EDITOR_TASK_NAME;

      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: {
          quality_score: judged.score_total,
          status: route === 'writer' ? 'writing' : 'editing',
        },
      });

      const editorJob = await prisma.job.create({
        data: {
          kind: targetTask,
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
        targetTask,
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
        `score < threshold — ${targetTask} re-kicked`,
      );
    } else {
      await prisma.noteArticle.update({
        where: { id: noteArticleId },
        data: {
          quality_score: judged.score_total,
          status: 'needs_human_review',
          paid: finalPricing.paid,
          price_jpy: finalPricing.price_jpy,
          paywall_line_pos: finalPricing.paid ? article.paywall_line_pos : null,
        },
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

/**
 * F-ANP-16: judge の有料化提案から「保存する price_jpy」を決める。
 * 有料化を推奨しない(false)場合は null にクリアする — theme 生成時点の推奨が残っていても、
 * 最終コンテンツを見た judge の判断を優先する。
 */
function resolveFinalPricing(
  article: { paid: boolean; price_jpy: number | null; paywall_line_pos?: number | null },
  judged: NoteJudgeOutput,
  paidAllowed: boolean,
): { paid: boolean; price_jpy: number | null } {
  const recommendPaid = judged.recommend_paid ?? article.paid;
  if (!recommendPaid) return { paid: false, price_jpy: null };
  const price = judged.suggested_price_jpy ?? article.price_jpy ?? null;
  // 有料にできるのは「アカウントが許可」かつ「有料ラインが本文にある」かつ「価格が決まっている」ときだけ。
  const canPaid = paidAllowed && price !== null && price > 0 && (article.paywall_line_pos ?? null) !== null;
  return { paid: canPaid, price_jpy: price };
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
