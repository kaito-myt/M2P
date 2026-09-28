'use server';

/**
 * 公開済み記事の表を画像に直す Server Action (F-ANP-48)。
 *
 * 運営者報告 (2026-09-28)「表がこんな感じで表示されてるからちゃんと表で出力されるようにして」。
 * note のエディタには表を作る機能が無いため、初期の記事は Markdown の表がパイプ記号のまま
 * 公開されている。`pipeline.note.fix-tables` を投入して表画像に差し替える。
 * `app/actions/monetize.ts` と同型 — 内部 `Job` を先に作ってから `job.id` を worker へ渡す。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PIPELINE_NOTE_FIX_TABLES_TASK_NAME = 'pipeline.note.fix-tables';

const FixTablesSchema = z.object({
  note_article_id: z.string().min(1),
  /** 省略時は安全側の true (差し替えるところまでで「更新する」は押さない)。 */
  dry_run: z.boolean().default(true),
});

export async function fixArticleTables(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = FixTablesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.articles.detail.fixTables.errors.failed };
  const { note_article_id: articleId, dry_run: dryRun } = parsed.data;

  try {
    // 実更新はグローバルのドライラン設定が OFF のときだけ (worker 側と二重で塞ぐ)。
    if (!dryRun) {
      const settings = await prisma.appSettings.findUnique({
        where: { id: 'singleton' },
        select: { anp_publish_dry_run: true },
      });
      if (settings?.anp_publish_dry_run ?? true) {
        return { ok: false, error: messages.accountDetail.errors.dryRunEnforced };
      }
    }

    const article = await prisma.noteArticle.findUnique({
      where: { id: articleId },
      select: { id: true, status: true, note_url: true, note_account_id: true },
    });
    if (!article || article.status !== 'published' || !article.note_url) {
      return { ok: false, error: messages.articles.detail.fixTables.errors.notEligible };
    }

    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_FIX_TABLES_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: articleId, dry_run: dryRun },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_FIX_TABLES_TASK_NAME,
      { note_article_id: articleId, job_id: job.id, dry_run: dryRun },
      { jobKey: `note-fix-tables-${articleId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );

    revalidatePath(`/articles/${articleId}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.articles.detail.fixTables.errors.failed,
    };
  }
}
