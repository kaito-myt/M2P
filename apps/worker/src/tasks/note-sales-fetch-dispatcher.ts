/**
 * `note.sales.fetch.dispatch` タスク (docs/11-anp-design.md §3.5 F-ANP-40 / §7 Phase3)。
 *
 * cron (日次 JST 06:00・常時ON) で起動し、`note_accounts.status='active'` の全アカウントに
 * `note.sales.fetch` を enqueue する (`note.publish.dispatch` と同型: 内部 Job を作って
 * job_id を渡し、job_key で同日の重複投入を防ぐ)。READ-ONLY のため AppSettings トグルは無い。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

export const NOTE_SALES_FETCH_DISPATCHER_TASK_NAME = 'note.sales.fetch.dispatch';

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface NoteSalesFetchDispatcherPrisma {
  noteAccount: {
    findMany(args: {
      where: { status: string };
      select: { id: true };
      orderBy: { created_at: 'asc' };
    }): Promise<Array<{ id: string }>>;
  };
  job: {
    create(args: { data: { kind: string; status: string; payload_json: unknown } }): Promise<{ id: string }>;
  };
}

export interface NoteSalesFetchDispatcherDeps {
  prisma?: NoteSalesFetchDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
  now?: () => Date;
}

export interface NoteSalesFetchDispatcherResult {
  enqueued: number;
  accountIds: string[];
}

export async function runNoteSalesFetchDispatcher(
  deps: NoteSalesFetchDispatcherDeps = {},
): Promise<NoteSalesFetchDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_SALES_FETCH_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as NoteSalesFetchDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${NOTE_SALES_FETCH_DISPATCHER_TASK_NAME}: addJob must be provided`);
  const now = deps.now ?? (() => new Date());

  const accounts = await db.noteAccount.findMany({
    where: { status: 'active' },
    select: { id: true },
    orderBy: { created_at: 'asc' },
  });

  // JST の暦日 (job_key に使い、同日の重複投入を防ぐ)。
  const jst = new Date(now().getTime() + 9 * 3600_000);
  const ymd = `${jst.getUTCFullYear()}${String(jst.getUTCMonth() + 1).padStart(2, '0')}${String(jst.getUTCDate()).padStart(2, '0')}`;

  const accountIds: string[] = [];
  for (const account of accounts) {
    try {
      const job = await db.job.create({
        data: { kind: 'note.sales.fetch', status: 'queued', payload_json: { note_account_id: account.id } },
      });
      await addJob(
        'note.sales.fetch',
        { note_account_id: account.id, job_id: job.id },
        { jobKey: `note-sales-fetch-${account.id}-${ymd}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
      );
      accountIds.push(account.id);
    } catch (err) {
      log.warn({ accountId: account.id, err }, 'failed to enqueue note.sales.fetch — continuing');
    }
  }

  log.info({ enqueued: accountIds.length }, 'note.sales.fetch.dispatch tick done');
  return { enqueued: accountIds.length, accountIds };
}

export const noteSalesFetchDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runNoteSalesFetchDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
