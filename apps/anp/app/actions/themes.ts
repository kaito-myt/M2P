'use server';

/**
 * NoteTheme / NoteArticle 起点 Server Actions (docs/11-anp-design.md §7)。
 *
 * - `generateThemes`: `note.theme.generate` を enqueue (Job 行を作ってから addJob — 冪等性の
 *   ための内部 Job.id を worker タスクへ渡す規約は A2P `pipeline.theme.generate` と同型)。
 * - `approveTheme`: NoteTheme を status='accepted' にし、NoteArticle を作成、
 *   `pipeline.note.writer.outline` を enqueue する。
 * - `rejectTheme`: NoteTheme を status='rejected' にする。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOTE_THEME_GENERATE_TASK_NAME = 'note.theme.generate';
const PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME = 'pipeline.note.writer.outline';

const GenerateThemesSchema = z.object({
  note_account_id: z.string().min(1),
  count: z.coerce.number().int().min(1).max(20).default(5),
});

export async function generateThemes(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = GenerateThemesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.accountDetail.errors.generateFailed };
  }
  const { note_account_id: noteAccountId, count } = parsed.data;

  try {
    const account = await prisma.noteAccount.findUnique({ where: { id: noteAccountId } });
    if (!account) {
      return { ok: false, error: messages.accountDetail.errors.generateFailed };
    }

    const job = await prisma.job.create({
      data: {
        kind: NOTE_THEME_GENERATE_TASK_NAME,
        status: 'queued',
        payload_json: { note_account_id: noteAccountId, count },
      },
    });
    await enqueueJob(
      NOTE_THEME_GENERATE_TASK_NAME,
      {
        note_account_id: noteAccountId,
        job_id: job.id,
        count,
      },
      { maxAttempts: 3 },
    );

    revalidatePath(`/accounts/${noteAccountId}`);
    revalidatePath('/themes');
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.generateFailed,
    };
  }
}

const ApproveThemeSchema = z.object({ theme_id: z.string().min(1) });

export async function approveTheme(
  input: unknown,
): Promise<ActionResult<{ note_article_id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = ApproveThemeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.accountDetail.errors.approveFailed };
  }
  const { theme_id: themeId } = parsed.data;

  try {
    // 二重クリック/多重送信対策: status='pending' の行のみを対象にした CAS 更新。
    // count=0 (既に accepted/rejected 済み) なら NoteArticle を作らずに失敗を返す。
    const theme = await prisma.$transaction(async (tx) => {
      const guard = await tx.noteTheme.updateMany({
        where: { id: themeId, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (guard.count === 0) return null;
      return tx.noteTheme.findUnique({ where: { id: themeId } });
    });
    if (!theme) {
      return { ok: false, error: messages.accountDetail.errors.approveFailed };
    }

    const article = await prisma.noteArticle.create({
      data: {
        note_account_id: theme.note_account_id,
        theme_id: theme.id,
        title: theme.title,
        paid: theme.recommend_paid,
        price_jpy: theme.suggested_price ?? null,
        status: 'queued',
      },
      select: { id: true },
    });

    const job = await prisma.job.create({
      data: {
        kind: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
        status: 'queued',
        payload_json: { note_article_id: article.id },
      },
    });
    await enqueueJob(
      PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
      {
        note_article_id: article.id,
        job_id: job.id,
      },
      { maxAttempts: 3 },
    );

    revalidatePath(`/accounts/${theme.note_account_id}`);
    revalidatePath('/themes');
    revalidatePath('/articles');
    return { ok: true, data: { note_article_id: article.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.approveFailed,
    };
  }
}

const RejectThemeSchema = z.object({
  theme_id: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export async function rejectTheme(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = RejectThemeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.accountDetail.errors.rejectFailed };
  }
  const { theme_id: themeId, reason } = parsed.data;

  try {
    // 二重クリック対策: status='pending' の行のみを対象にした CAS 更新。
    const guard = await prisma.noteTheme.updateMany({
      where: { id: themeId, status: 'pending' },
      data: { status: 'rejected', rejected_reason: reason ?? null },
    });
    if (guard.count === 0) {
      return { ok: false, error: messages.accountDetail.errors.rejectFailed };
    }

    const theme = await prisma.noteTheme.findUnique({
      where: { id: themeId },
      select: { note_account_id: true },
    });
    if (theme) revalidatePath(`/accounts/${theme.note_account_id}`);
    revalidatePath('/themes');
    revalidatePath('/themes');
    revalidatePath('/articles');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accountDetail.errors.rejectFailed,
    };
  }
}
