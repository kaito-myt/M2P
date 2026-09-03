'use server';

/**
 * 楽天Kobo / BOOTH 入稿キュー Server Actions (F-095/F-096)。
 *
 * `Book.{kobo,booth}_publish_queued` を立てる/降ろすだけの薄い SA。
 * 自動入稿エンジン (worker タスク) は後続実装 — キューはその稼働開始時に消化される。
 * ブロック判定は BW (lib/bw-submit-core.ts) と同基準。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isA2PError, fail, ok, type ActionResult } from '@a2p/contracts';
import { Prisma, prisma } from '@a2p/db';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { messages } from '@/lib/messages';

const inputSchema = z.object({
  channel: z.enum(['kobo', 'booth']),
  book_ids: z.array(z.string().min(1)).min(1).max(100),
});

const SUBMITTABLE_STATUSES = ['done', 'needs_human_review'];

export interface ChannelQueueOutput {
  queued: Array<{ book_id: string }>;
  blocked: Array<{ book_id: string; reason: string }>;
}

export async function queueToChannel(input: unknown): Promise<ActionResult<ChannelQueueOutput>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('validation', messages.bwSubmit.errors.validation, parsed.error.flatten().fieldErrors);
  }
  const { channel, book_ids } = parsed.data;
  try {
    const session = await getSessionOrThrow();
    const books = await prisma.book.findMany({
      where: { id: { in: book_ids } },
      select: {
        id: true,
        status: true,
        kobo_publish_status: true,
        booth_publish_status: true,
        kdpMetadata: { select: { id: true } },
        revisionComments: { select: { id: true }, where: { priority: 'must', status: 'pending' } },
      },
    });
    const bookMap = new Map(books.map((b) => [b.id, b]));
    const r = messages.bwSubmit.blockedReasons;

    const queued: Array<{ book_id: string }> = [];
    const blocked: Array<{ book_id: string; reason: string }> = [];
    for (const bookId of book_ids) {
      const book = bookMap.get(bookId);
      if (!book) {
        blocked.push({ book_id: bookId, reason: r.notFound });
        continue;
      }
      const channelStatus = channel === 'kobo' ? book.kobo_publish_status : book.booth_publish_status;
      if (book.revisionComments.length > 0) {
        blocked.push({ book_id: bookId, reason: r.hasBlockingComments });
        continue;
      }
      if (channelStatus === 'submitted' || channelStatus === 'published') {
        blocked.push({ book_id: bookId, reason: r.alreadySubmitted });
        continue;
      }
      if (!SUBMITTABLE_STATUSES.includes(book.status)) {
        blocked.push({ book_id: bookId, reason: r.notSubmittableStatus });
        continue;
      }
      if (!book.kdpMetadata) {
        blocked.push({ book_id: bookId, reason: r.metadataMissing });
        continue;
      }
      queued.push({ book_id: bookId });
    }

    if (queued.length > 0) {
      const data =
        channel === 'kobo'
          ? { kobo_publish_queued: true, kobo_publish_queued_at: new Date() }
          : { booth_publish_queued: true, booth_publish_queued_at: new Date() };
      await prisma.book.updateMany({ where: { id: { in: queued.map((q) => q.book_id) } }, data });
    }

    await prisma.auditLog.create({
      data: {
        actor_id: session.user.id,
        action: `${channel}.queue`,
        target_kind: 'book',
        target_id: queued.length === 1 && blocked.length === 0 ? queued[0]!.book_id : 'bulk',
        after_json: {
          queued: queued.map((q) => q.book_id),
          blocked,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    revalidatePath(`/${channel}`);
    return ok({ queued, blocked });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.bwSubmit.errors.unknown);
  }
}

export async function unqueueFromChannel(
  input: unknown,
): Promise<ActionResult<{ unqueued: Array<{ book_id: string }> }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return fail('validation', messages.bwSubmit.errors.validation, parsed.error.flatten().fieldErrors);
  }
  const { channel, book_ids } = parsed.data;
  try {
    const session = await getSessionOrThrow();
    const data =
      channel === 'kobo'
        ? { kobo_publish_queued: false, kobo_publish_queued_at: null }
        : { booth_publish_queued: false, booth_publish_queued_at: null };
    await prisma.book.updateMany({ where: { id: { in: book_ids } }, data });
    await prisma.auditLog.create({
      data: {
        actor_id: session.user.id,
        action: `${channel}.unqueue`,
        target_kind: 'book',
        target_id: book_ids.length === 1 ? book_ids[0]! : 'bulk',
        after_json: { book_ids } as unknown as Prisma.InputJsonValue,
      },
    });
    revalidatePath(`/${channel}`);
    return ok({ unqueued: book_ids.map((id) => ({ book_id: id })) });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.bwSubmit.errors.unknown);
  }
}
