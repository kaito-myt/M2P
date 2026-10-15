'use server';

/**
 * `needs_human_review` 記事の人間判断導線 (docs/11-anp-design.md §7 申し送り6 / F-ANP-57)。
 *
 * `pipeline.note.judge` が差し戻しを使い切っても公開下限 (`NOTE_JUDGE_PUBLISH_FLOOR`) に
 * 届かなかった記事は `NoteArticle.status='needs_human_review'` で止まる。これに対し
 * 運営者が以下を選べるようにする:
 *   - `retryJudge`  : 品質判定だけをもう一度やり直す (本文はそのまま)
 *   - `retryEditor` : 校閲からやり直す (editor→eyecatch→judge を再連結)
 *   - `retryOutline`: 構成からやり直す (切り口そのものを変える。69 点以下はこちらが本筋)
 *   - `forceReady`  : AI 判定を無視してそのまま公開可 (ready) にする
 *   - `forceReadyMany`: 上記の一括版 (滞留が溜まったときに 1 件ずつ開かずに片付ける)
 *
 * いずれも `status='needs_human_review'` の記事のみを対象にした CAS 更新で二重実行を防ぐ
 * (`app/actions/publish.ts` と同型)。
 *
 * [2026-10-15] 差し戻し系に **judge の実際の指摘を渡す** ようにした。それまでは
 * 「運営者による手動差し戻し: 内容を見直してください。」という中身の無い 1 行だけを渡しており、
 * 何を直せばいいか伝わらないまま同じ点数で戻ってきていた
 * (運営者指摘「スコアが足りない理由をちゃんとライターに伝達してない」)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { loadJudgeFeedback, toFeedbackItems } from '@/lib/judge-feedback';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PIPELINE_NOTE_JUDGE_TASK_NAME = 'pipeline.note.judge';
const PIPELINE_NOTE_EDITOR_TASK_NAME = 'pipeline.note.editor';
const PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME = 'pipeline.note.writer.outline';

/**
 * 手動リトライは judge の自動差し戻しを 1 回消費した状態から再開する
 * (`RETRY_LIMIT`=2 なので、手動リトライ後も自動の差し戻しが 1 回だけ残る)。
 * 0 から再開すると editor↔judge を際限なく往復しうるため、必ず消費済みで渡す。
 */
const MANUAL_RETRY_COUNT = 1;

const ArticleIdSchema = z.object({ note_article_id: z.string().min(1) });
const ArticleIdsSchema = z.object({ note_article_ids: z.array(z.string().min(1)).min(1).max(200) });

async function findReviewArticle(articleId: string) {
  return prisma.noteArticle.findUnique({
    where: { id: articleId },
    select: { id: true, note_account_id: true, status: true },
  });
}

/** 一覧 (`/articles`) と該当アカウント詳細の両方を更新する。要確認の節は一覧側にも出る。 */
function revalidateReviewViews(noteAccountId?: string | null) {
  revalidatePath('/articles');
  if (noteAccountId) revalidatePath(`/accounts/${noteAccountId}`);
}

/**
 * 手動差し戻し時にエージェントへ渡す指摘。
 * 直近の judge 結果があればその内訳を、無ければ従来の汎用文を使う。
 */
async function buildManualFeedback(articleId: string): Promise<string[]> {
  const items = toFeedbackItems(await loadJudgeFeedback(articleId));
  if (items.length > 0) {
    return ['運営者による手動差し戻し。前回の品質判定の指摘は以下。', ...items];
  }
  return ['運営者による手動差し戻し: 内容を見直してください。'];
}

export async function retryJudge(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArticleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accountDetail.errors.retryJudgeFailed };
  const { note_article_id: articleId } = parsed.data;

  try {
    const guard = await prisma.noteArticle.updateMany({
      where: { id: articleId, status: 'needs_human_review' },
      data: { status: 'judging' },
    });
    if (guard.count === 0) {
      return { ok: false, error: messages.accountDetail.errors.retryJudgeFailed };
    }
    const article = await findReviewArticle(articleId);
    if (!article) return { ok: false, error: messages.accountDetail.errors.retryJudgeFailed };

    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_JUDGE_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: articleId, retry_count: MANUAL_RETRY_COUNT },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_JUDGE_TASK_NAME,
      { note_article_id: articleId, job_id: job.id, retry_count: MANUAL_RETRY_COUNT },
      { maxAttempts: 2 },
    );

    revalidateReviewViews(article.note_account_id);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.retryJudgeFailed,
    };
  }
}

/** 校閲 (editor) からやり直す。文章の直しで届く見込みがある 70〜84 点帯向け。 */
export async function retryEditor(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  return retryFrom(input, {
    task: PIPELINE_NOTE_EDITOR_TASK_NAME,
    nextStatus: 'editing',
    errorMessage: messages.accountDetail.errors.retryEditorFailed,
  });
}

/**
 * 構成 (outline) からやり直す。
 * judge は 69 点以下を「構成・切り口の問題」として自動でもこの経路に流すので、
 * 低スコアで止まった記事を手動で蹴り直すときもこちらが本筋。
 */
export async function retryOutline(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  return retryFrom(input, {
    task: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
    nextStatus: 'writing',
    errorMessage: messages.accountDetail.errors.retryOutlineFailed,
  });
}

async function retryFrom(
  input: unknown,
  opts: { task: string; nextStatus: string; errorMessage: string },
): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArticleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: opts.errorMessage };
  const { note_article_id: articleId } = parsed.data;

  try {
    // 指摘は status を動かす前に読む (CAS 後に失敗しても記事が宙に浮かないよう、
    // 読み取りだけ先に済ませる)。
    const feedback = await buildManualFeedback(articleId);

    const guard = await prisma.noteArticle.updateMany({
      where: { id: articleId, status: 'needs_human_review' },
      data: { status: opts.nextStatus },
    });
    if (guard.count === 0) return { ok: false, error: opts.errorMessage };

    const article = await findReviewArticle(articleId);
    if (!article) return { ok: false, error: opts.errorMessage };

    const job = await prisma.job.create({
      data: {
        kind: opts.task,
        status: 'queued',
        payload_json: { note_article_id: articleId, feedback, retry_count: MANUAL_RETRY_COUNT },
      },
    });
    await enqueueJob(
      opts.task,
      { note_article_id: articleId, job_id: job.id, feedback, retry_count: MANUAL_RETRY_COUNT },
      { maxAttempts: 2 },
    );

    revalidateReviewViews(article.note_account_id);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : opts.errorMessage };
  }
}

export async function forceReady(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArticleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accountDetail.errors.forceReadyFailed };
  const { note_article_id: articleId } = parsed.data;

  try {
    const guard = await prisma.noteArticle.updateMany({
      where: { id: articleId, status: 'needs_human_review' },
      data: { status: 'ready' },
    });
    if (guard.count === 0) {
      return { ok: false, error: messages.accountDetail.errors.forceReadyFailed };
    }
    const article = await findReviewArticle(articleId);
    revalidateReviewViews(article?.note_account_id ?? null);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.forceReadyFailed,
    };
  }
}

/**
 * 一括承認。`status='needs_human_review'` のものだけを `ready` にする。
 *
 * 1 件ずつ画面を開いて承認するのは現実的でない (実測で 24 本滞留) ため、
 * A2P の品質判定ゲート (F-099) と同じく一覧から直接片付けられるようにする。
 * 返すのは実際に変わった件数 — 既に他の操作で動いていた分は黙って除かれる。
 */
export async function forceReadyMany(input: unknown): Promise<ActionResult<{ approved: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArticleIdsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accountDetail.errors.forceReadyFailed };
  const ids = [...new Set(parsed.data.note_article_ids)];

  try {
    const targets = await prisma.noteArticle.findMany({
      where: { id: { in: ids }, status: 'needs_human_review' },
      select: { id: true, note_account_id: true },
    });
    if (targets.length === 0) {
      return { ok: false, error: messages.accountDetail.errors.forceReadyFailed };
    }

    const updated = await prisma.noteArticle.updateMany({
      where: { id: { in: targets.map((t) => t.id) }, status: 'needs_human_review' },
      data: { status: 'ready' },
    });

    revalidatePath('/articles');
    for (const accountId of new Set(targets.map((t) => t.note_account_id))) {
      revalidatePath(`/accounts/${accountId}`);
    }
    return { ok: true, data: { approved: updated.count } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.forceReadyFailed,
    };
  }
}
