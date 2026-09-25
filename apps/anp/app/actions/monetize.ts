'use server';

/**
 * 公開済み記事の有料化 Server Action (F-ANP-47)。
 *
 * 運営者要望 (2026-09-25)「有料化機能作って」。judge の格下げバグ (F-ANP-45) で無料公開されて
 * しまった記事を、note エディタ操作で後から有料に切り替える `pipeline.note.monetize` を投入する。
 * `app/actions/publish.ts` と同型 — 内部 `Job` を先に作ってから `job.id` を worker へ渡す。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PIPELINE_NOTE_MONETIZE_TASK_NAME = 'pipeline.note.monetize';

const MonetizeArticleSchema = z.object({
  note_article_id: z.string().min(1),
  /** 省略時は安全側の true (有料設定まで進めて「更新する」は押さない)。 */
  dry_run: z.boolean().default(true),
  /** 価格を指定する場合 (省略時は worker が記事の想定価格→価格帯→既定値で決める)。 */
  price_jpy: z.coerce.number().int().min(100).max(50000).optional(),
});

export async function monetizeArticle(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = MonetizeArticleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.articles.detail.monetize.errors.failed };
  const { note_article_id: articleId, dry_run: dryRun, price_jpy: priceJpy } = parsed.data;

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

    // 公開済み・無料の記事のみ対象 (下書き/有料への誤投入を防ぐ)。
    const article = await prisma.noteArticle.findUnique({
      where: { id: articleId },
      select: { id: true, status: true, paid: true, note_url: true, note_account_id: true },
    });
    if (!article || article.status !== 'published' || article.paid || !article.note_url) {
      return { ok: false, error: messages.articles.detail.monetize.errors.notEligible };
    }

    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_MONETIZE_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: articleId, dry_run: dryRun, price_jpy: priceJpy ?? null },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_MONETIZE_TASK_NAME,
      { note_article_id: articleId, job_id: job.id, dry_run: dryRun, ...(priceJpy ? { price_jpy: priceJpy } : {}) },
      { jobKey: `note-monetize-${articleId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );

    revalidatePath(`/articles/${articleId}`);
    revalidatePath(`/accounts/${article.note_account_id}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.articles.detail.monetize.errors.failed,
    };
  }
}
