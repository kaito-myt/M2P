/**
 * BOOK☆WALKER 自動入稿キュー登録/取消 コアロジック (F-094)。
 *
 * `lib/kdp-submit-core.ts` と同型。SA は `Book.bw_publish_queued` を立てる/降ろすだけで、
 * 実際の申請はサーバーの `bw.submit.dispatch` cron → `bw.submit` タスクが行う
 * (KDP と異なり BW は再認証要求が無く、保存済みセッションでサーバーから完結する)。
 *
 * 仕様根拠: docs/02 F-094 / docs/05 §5.3.15c / packages/db/schema.prisma Book.bw_publish_queued
 */
import { z } from 'zod';

import { isA2PError, fail, ok, type ActionResult } from '@a2p/contracts';
import { Prisma } from '@a2p/db';

import type { AuthenticatedSession } from './auth-helpers';
import { messages } from './messages';

export const queueToBwInputSchema = z.object({
  /** 対象の書籍 ID リスト (1〜100 件)。 */
  book_ids: z.array(z.string().min(1)).min(1).max(100),
});
export type QueueToBwInput = z.infer<typeof queueToBwInputSchema>;

export interface BwQueuedItem {
  book_id: string;
}

export interface BwBlockedItem {
  book_id: string;
  reason: string;
}

export interface QueueToBwOutput {
  queued: BwQueuedItem[];
  blocked: BwBlockedItem[];
}

export interface UnqueueFromBwOutput {
  unqueued: BwQueuedItem[];
}

// 入稿可能な Book.status (KDP と同基準 — done か要確認のみ)
const SUBMITTABLE_STATUSES = ['done', 'needs_human_review'];

// ---------------------------------------------------------------------------
// DI boundary
// ---------------------------------------------------------------------------

export interface BwSubmitBookRow {
  id: string;
  status: string;
  bw_publish_status: string;
  kdpMetadata: { id: string } | null;
}

export interface BwSubmitBookRepo {
  findMany(args: {
    where: { id: { in: string[] } };
    select: {
      id: true;
      status: true;
      bw_publish_status: true;
      kdpMetadata: { select: { id: true } };
    };
  }): Promise<BwSubmitBookRow[]>;

  updateMany(args: {
    where: { id: { in: string[] } };
    data: { bw_publish_queued: boolean; bw_publish_queued_at: Date | null };
  }): Promise<{ count: number }>;
}

export interface BwSubmitRevisionCommentRepo {
  findMany(args: {
    where: { book_id: { in: string[] }; priority: 'must'; status: 'pending' };
    select: { book_id: true };
  }): Promise<Array<{ book_id: string }>>;
}

export interface BwSubmitAuditLogRepo {
  create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
}

export interface BwSubmitDeps {
  bookRepo: BwSubmitBookRepo;
  revisionCommentRepo: BwSubmitRevisionCommentRepo;
  auditLogRepo: BwSubmitAuditLogRepo;
  session: AuthenticatedSession;
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// queueToBw — キューに登録する
// ---------------------------------------------------------------------------

export async function queueToBwCore(
  raw: unknown,
  deps: BwSubmitDeps,
): Promise<ActionResult<QueueToBwOutput>> {
  const parsed = queueToBwInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fail('validation', messages.bwSubmit.errors.validation, parsed.error.flatten().fieldErrors);
  }
  const { book_ids } = parsed.data;
  const now = (deps.now ?? (() => new Date()))();

  try {
    const books = await deps.bookRepo.findMany({
      where: { id: { in: book_ids } },
      select: {
        id: true,
        status: true,
        bw_publish_status: true,
        kdpMetadata: { select: { id: true } },
      },
    });
    const bookMap = new Map(books.map((b) => [b.id, b]));

    const blockingRows = await deps.revisionCommentRepo.findMany({
      where: { book_id: { in: book_ids }, priority: 'must', status: 'pending' },
      select: { book_id: true },
    });
    const blockingSet = new Set(blockingRows.map((r) => r.book_id));

    const queued: BwQueuedItem[] = [];
    const blocked: BwBlockedItem[] = [];

    for (const bookId of book_ids) {
      const book = bookMap.get(bookId);
      if (!book) {
        blocked.push({ book_id: bookId, reason: messages.bwSubmit.blockedReasons.notFound });
        continue;
      }
      if (blockingSet.has(bookId)) {
        blocked.push({ book_id: bookId, reason: messages.bwSubmit.blockedReasons.hasBlockingComments });
        continue;
      }
      if (book.bw_publish_status === 'submitted' || book.bw_publish_status === 'published') {
        blocked.push({ book_id: bookId, reason: messages.bwSubmit.blockedReasons.alreadySubmitted });
        continue;
      }
      if (!SUBMITTABLE_STATUSES.includes(book.status)) {
        blocked.push({ book_id: bookId, reason: messages.bwSubmit.blockedReasons.notSubmittableStatus });
        continue;
      }
      if (!book.kdpMetadata) {
        blocked.push({ book_id: bookId, reason: messages.bwSubmit.blockedReasons.metadataMissing });
        continue;
      }
      queued.push({ book_id: bookId });
    }

    if (queued.length > 0) {
      await deps.bookRepo.updateMany({
        where: { id: { in: queued.map((q) => q.book_id) } },
        data: { bw_publish_queued: true, bw_publish_queued_at: now },
      });
    }

    await deps.auditLogRepo.create({
      data: {
        actor_id: deps.session.user.id,
        action: 'bw.queue',
        target_kind: 'book',
        target_id: queued.length === 1 && blocked.length === 0 ? queued[0]!.book_id : 'bulk',
        after_json: {
          queued: queued.map((q) => q.book_id),
          blocked: blocked.map((b) => ({ book_id: b.book_id, reason: b.reason })),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return ok({ queued, blocked });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.bwSubmit.errors.unknown);
  }
}

// ---------------------------------------------------------------------------
// unqueueFromBw — キューから取り消す
// ---------------------------------------------------------------------------

export async function unqueueFromBwCore(
  raw: unknown,
  deps: BwSubmitDeps,
): Promise<ActionResult<UnqueueFromBwOutput>> {
  const parsed = queueToBwInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fail('validation', messages.bwSubmit.errors.validation, parsed.error.flatten().fieldErrors);
  }
  const { book_ids } = parsed.data;

  try {
    await deps.bookRepo.updateMany({
      where: { id: { in: book_ids } },
      data: { bw_publish_queued: false, bw_publish_queued_at: null },
    });

    await deps.auditLogRepo.create({
      data: {
        actor_id: deps.session.user.id,
        action: 'bw.unqueue',
        target_kind: 'book',
        target_id: book_ids.length === 1 ? book_ids[0]! : 'bulk',
        after_json: { book_ids } as unknown as Prisma.InputJsonValue,
      },
    });

    return ok({ unqueued: book_ids.map((id) => ({ book_id: id })) });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.bwSubmit.errors.unknown);
  }
}
