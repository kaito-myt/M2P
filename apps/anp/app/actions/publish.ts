'use server';

/**
 * NoteArticle 公開 Server Action (docs/11-anp-design.md §7 Phase2, F-ANP-20)。
 *
 * `note_articles.status='ready'` の記事を `pipeline.note.publish` へ enqueue する。
 * A2P の `bw.submit`/`kdp.submit` UI ボタンと同型 — 内部 `Job` を先に作ってから
 * `job.id` を worker タスクへ渡す(冪等性のための規約、`app/actions/themes.ts` と同じ)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PIPELINE_NOTE_PUBLISH_TASK_NAME = 'pipeline.note.publish';

const PublishArticleSchema = z.object({
  note_article_id: z.string().min(1),
  dry_run: z.boolean().default(true),
});

export async function publishArticle(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = PublishArticleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.accountDetail.errors.publishFailed };
  }
  const { note_article_id: articleId, dry_run: dryRun } = parsed.data;

  try {
    // グローバルなドライラン設定(既定ON=安全側)が有効な間は、実公開(dry_run:false)要求を拒否する
    // (worker 側の effectiveDryRun 強制と二重で塞ぐ — code review #1)。
    if (!dryRun) {
      const settings = await prisma.appSettings.findUnique({
        where: { id: 'singleton' },
        select: { anp_publish_dry_run: true },
      });
      if (settings?.anp_publish_dry_run ?? true) {
        return { ok: false, error: messages.accountDetail.errors.dryRunEnforced };
      }
    }

    // 二重クリック対策: status='ready' の記事のみ対象(公開済み/実行中への誤投入を防ぐ)。
    const article = await prisma.noteArticle.findUnique({
      where: { id: articleId },
      select: { id: true, status: true, note_account_id: true },
    });
    if (!article || (article.status !== 'ready' && article.status !== 'needs_human_review')) {
      return { ok: false, error: messages.accountDetail.errors.publishFailed };
    }

    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_PUBLISH_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: articleId, dry_run: dryRun },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_PUBLISH_TASK_NAME,
      { note_article_id: articleId, job_id: job.id, dry_run: dryRun },
      { jobKey: `note-publish-${articleId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );

    revalidatePath(`/accounts/${article.note_account_id}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.publishFailed,
    };
  }
}
