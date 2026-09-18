'use server';

/**
 * `needs_human_review` 記事の再審査導線 (docs/11-anp-design.md §7 申し送り6)。
 *
 * `pipeline.note.judge` の 2 回目不合格で `NoteArticle.status='needs_human_review'` に
 * 遷移した記事に対し、運営者が以下いずれかを選べるようにする:
 *   - `retryJudge`: 品質判定だけをもう一度やり直す (本文はそのまま)
 *   - `retryEditor`: 校閲からやり直す (editor→eyecatch→judge を再連結)
 *   - `forceReady`: AI 判定を無視してそのまま公開可 (ready) にする
 *
 * いずれも `status='needs_human_review'` の記事のみを対象にした CAS 更新で二重実行を防ぐ
 * (`app/actions/publish.ts` と同型)。`retryJudge`/`retryEditor` は `retry_count=1` を渡し、
 * judge の RETRY_LIMIT(=1) を再度使い切った状態から再開する — 手動リトライが際限なく
 * editor↔judge を往復する事故を防ぐため(1回のみの追加チャンスとして扱う)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PIPELINE_NOTE_JUDGE_TASK_NAME = 'pipeline.note.judge';
const PIPELINE_NOTE_EDITOR_TASK_NAME = 'pipeline.note.editor';

/** 手動リトライは judge の RETRY_LIMIT(=1) を使い切った状態から再開する。 */
const MANUAL_RETRY_COUNT = 1;

const ArticleIdSchema = z.object({ note_article_id: z.string().min(1) });

async function findReviewArticle(articleId: string) {
  return prisma.noteArticle.findUnique({
    where: { id: articleId },
    select: { id: true, note_account_id: true, status: true },
  });
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

    revalidatePath(`/accounts/${article.note_account_id}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.retryJudgeFailed,
    };
  }
}

export async function retryEditor(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArticleIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accountDetail.errors.retryEditorFailed };
  const { note_article_id: articleId } = parsed.data;

  try {
    const guard = await prisma.noteArticle.updateMany({
      where: { id: articleId, status: 'needs_human_review' },
      data: { status: 'editing' },
    });
    if (guard.count === 0) {
      return { ok: false, error: messages.accountDetail.errors.retryEditorFailed };
    }
    const article = await findReviewArticle(articleId);
    if (!article) return { ok: false, error: messages.accountDetail.errors.retryEditorFailed };

    const feedback = ['運営者による手動差し戻し: 内容を見直してください。'];
    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_EDITOR_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: articleId, feedback, retry_count: MANUAL_RETRY_COUNT },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_EDITOR_TASK_NAME,
      { note_article_id: articleId, job_id: job.id, feedback, retry_count: MANUAL_RETRY_COUNT },
      { maxAttempts: 2 },
    );

    revalidatePath(`/accounts/${article.note_account_id}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.retryEditorFailed,
    };
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
    if (article) revalidatePath(`/accounts/${article.note_account_id}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.forceReadyFailed,
    };
  }
}
