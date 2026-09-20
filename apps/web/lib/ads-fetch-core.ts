/**
 * triggerAdsFetch SA のコアロジック (F-090拡張 `/ads` の「今すぐ取得」ボタン)。
 *
 * `app/actions/ads.ts` (SA ラッパ) から呼ばれる業務ロジック。依存は DI で受け取り
 * Vitest でユニットテスト可能にする (model-catalog-core.ts と同パターン)。
 * `ads.spend.fetch` には run 追跡テーブルが無い (worker 側は creds 未接続時 no-op skip
 * するだけ) ため、ここでは enqueue + audit_log 記録のみを行う。
 */
import { Prisma } from '@a2p/db';

import { isA2PError, fail, ok, type ActionResult } from '@a2p/contracts';

import type { AuthenticatedSession } from './auth-helpers';
import { messages } from './messages';

export interface AuditLogRepo {
  create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
}

export type EnqueueJobFn = (taskName: string, payload: unknown) => Promise<string>;

export interface AdsFetchDeps {
  auditLogRepo: AuditLogRepo;
  session: AuthenticatedSession;
  enqueueJob: EnqueueJobFn;
}

export interface TriggerAdsFetchResult {
  job_id: string;
}

export async function triggerAdsFetchCore(
  deps: AdsFetchDeps,
): Promise<ActionResult<TriggerAdsFetchResult>> {
  try {
    const jobId = await deps.enqueueJob('ads.spend.fetch', { trigger: 'manual' });

    await deps.auditLogRepo.create({
      data: {
        actor_id: deps.session.user.id,
        action: 'ads.spend.fetch.trigger',
        target_kind: 'ad_spend',
        target_id: jobId,
        before_json: Prisma.JsonNull,
        after_json: { trigger: 'manual', job_id: jobId } as unknown as Prisma.InputJsonValue,
      },
    });

    return ok({ job_id: jobId });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.ads.errors.enqueueFailed);
  }
}
