'use server';

/**
 * ペーパーバック化キューの Server Actions (F-097)。
 *
 * `Book.pb_publish_queued` を立てる/降ろすだけの薄いラッパ。実際の入稿・出版は
 * KDP の再認証壁のためサーバーからは行えず、ローカルアシスト
 * (`bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-auto.sh all`) が
 * このキューを読んで実行し、結果を `books.pb_*` に書き戻す。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isA2PError, fail, ok, type ActionResult } from '@a2p/contracts';
import { prisma } from '@a2p/db';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { messages } from '@/lib/messages';

const InputSchema = z.object({ book_ids: z.array(z.string().min(1)).min(1).max(200) });

export interface PaperbackQueueOutput {
  count: number;
}

function authFail(err: unknown): ActionResult<never> {
  if (isA2PError(err)) return err.toActionResult();
  return fail('unknown', messages.paperback.errors.unknown);
}

async function setQueued(input: unknown, queued: boolean): Promise<ActionResult<PaperbackQueueOutput>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    return authFail(err);
  }
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return fail('validation', messages.paperback.errors.validation);

  try {
    const res = await prisma.book.updateMany({
      where: {
        id: { in: parsed.data.book_ids },
        // 既に出版済みの本はキューに載せない (二重出版防止)。
        ...(queued ? { pb_publish_status: { notIn: ['published'] } } : {}),
      },
      data: queued
        ? { pb_publish_queued: true, pb_publish_queued_at: new Date(), pb_submit_cooldown_until: null }
        : { pb_publish_queued: false },
    });
    revalidatePath('/paperback');
    return ok({ count: res.count });
  } catch {
    return fail('unknown', messages.paperback.errors.unknown);
  }
}

export async function queuePaperback(input: unknown): Promise<ActionResult<PaperbackQueueOutput>> {
  return setQueued(input, true);
}

export async function unqueuePaperback(input: unknown): Promise<ActionResult<PaperbackQueueOutput>> {
  return setQueued(input, false);
}
