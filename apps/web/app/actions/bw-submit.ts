'use server';

/**
 * BOOK☆WALKER 自動入稿キュー Server Actions (F-094)。
 *
 * `Book.bw_publish_queued` を立てる/降ろすだけの薄いラッパ。実際の申請は
 * サーバーの `bw.submit.dispatch` cron → `bw.submit` タスクが保存済みセッションで実行する。
 * 業務ロジックは `lib/bw-submit-core.ts` 側。
 */
import { revalidatePath } from 'next/cache';

import { isA2PError, fail, type ActionResult } from '@a2p/contracts';
import { prisma } from '@a2p/db';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { messages } from '@/lib/messages';
import {
  queueToBwCore,
  unqueueFromBwCore,
  type BwSubmitDeps,
  type QueueToBwOutput,
  type UnqueueFromBwOutput,
} from '@/lib/bw-submit-core';

async function buildDeps(): Promise<BwSubmitDeps> {
  const session = await getSessionOrThrow();
  return {
    bookRepo: prisma.book as unknown as BwSubmitDeps['bookRepo'],
    revisionCommentRepo: prisma.revisionComment as unknown as BwSubmitDeps['revisionCommentRepo'],
    auditLogRepo: prisma.auditLog,
    session,
  };
}

function authFail(err: unknown): ActionResult<never> {
  if (isA2PError(err)) return err.toActionResult();
  return fail('unknown', messages.bwSubmit.errors.unknown);
}

export async function queueToBw(input: unknown): Promise<ActionResult<QueueToBwOutput>> {
  let deps: BwSubmitDeps;
  try {
    deps = await buildDeps();
  } catch (err) {
    return authFail(err);
  }
  const result = await queueToBwCore(input, deps);
  if (result.ok) revalidatePath('/bookwalker');
  return result;
}

export async function unqueueFromBw(input: unknown): Promise<ActionResult<UnqueueFromBwOutput>> {
  let deps: BwSubmitDeps;
  try {
    deps = await buildDeps();
  } catch (err) {
    return authFail(err);
  }
  const result = await unqueueFromBwCore(input, deps);
  if (result.ok) revalidatePath('/bookwalker');
  return result;
}
