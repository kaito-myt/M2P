'use server';

/**
 * 広告(Amazon Ads) Server Actions (F-090拡張, `/ads`).
 *
 * SA は薄いラッパに留め、業務ロジックは `lib/ads-fetch-core.ts`。
 *
 * 仕様根拠: docs/05 §追加 worker タスク (ads.spend.fetch 拡張) / docs/04 S-030
 */
import { revalidatePath } from 'next/cache';

import { isA2PError, fail, type ActionResult } from '@a2p/contracts';
import { prisma } from '@a2p/db';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';
import { triggerAdsFetchCore, type TriggerAdsFetchResult } from '@/lib/ads-fetch-core';

/**
 * `ads.spend.fetch` ジョブを手動で起動する [F-090拡張 S-030].
 */
export async function triggerAdsFetch(): Promise<ActionResult<TriggerAdsFetchResult>> {
  let session: Awaited<ReturnType<typeof getSessionOrThrow>>;
  try {
    session = await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.ads.errors.unknown);
  }

  const result = await triggerAdsFetchCore({
    auditLogRepo: prisma.auditLog,
    enqueueJob,
    session,
  });

  if (result.ok) {
    revalidatePath('/ads');
  }

  return result;
}
