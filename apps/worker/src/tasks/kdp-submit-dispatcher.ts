/**
 * `kdp.submit.dispatch` タスク (F-041 Phase3 自動運用)。
 *
 * cron (既定 30 分毎) で起動し、`AppSettings.kdp_auto_submit_enabled=true` のとき
 * 入稿キュー(`books.kdp_publish_queued=true AND publish_status<>'published'`)から
 * **1 冊だけ** `kdp.submit` へ enqueue する（同時 1 冊で多重出版を防止）。
 * `kdp_submit_dry_run=true` なら出版直前で止めるドライランを渡す。
 *
 * job_key で同一書籍の重複投入を防ぐ。`AMAZON_EMAIL`/`AMAZON_PASSWORD` 未設定時は起動しない。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const KDP_SUBMIT_DISPATCHER_TASK_NAME = 'kdp.submit.dispatch';

export interface KdpSubmitDispatcherPrisma {
  appSettings: {
    findUnique(args: {
      where: { id: string };
      select: { kdp_auto_submit_enabled: true; kdp_submit_dry_run: true };
    }): Promise<{ kdp_auto_submit_enabled: boolean; kdp_submit_dry_run: boolean } | null>;
  };
  book: {
    findMany(args: {
      where: { kdp_publish_queued: true; publish_status: { not: string } };
      select: { id: true };
      orderBy: { updated_at: 'asc' };
      take: number;
    }): Promise<Array<{ id: string }>>;
  };
}

export interface KdpSubmitDispatcherDeps {
  prisma?: KdpSubmitDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
  /** creds 未設定チェックのバイパス(テスト用)。 */
  hasCreds?: boolean;
}

export interface KdpSubmitDispatcherResult {
  enabled: boolean;
  enqueued: number;
  bookId: string | null;
}

export async function runKdpSubmitDispatcher(
  deps: KdpSubmitDispatcherDeps = {},
): Promise<KdpSubmitDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${KDP_SUBMIT_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as KdpSubmitDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${KDP_SUBMIT_DISPATCHER_TASK_NAME}: addJob must be provided`);

  const hasCreds = deps.hasCreds ?? Boolean(process.env.AMAZON_EMAIL && process.env.AMAZON_PASSWORD);
  if (!hasCreds) {
    log.info('AMAZON_EMAIL/PASSWORD 未設定 — kdp.submit.dispatch skip');
    return { enabled: false, enqueued: 0, bookId: null };
  }

  const settings = await db.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { kdp_auto_submit_enabled: true, kdp_submit_dry_run: true },
  });
  if (!settings?.kdp_auto_submit_enabled) {
    return { enabled: false, enqueued: 0, bookId: null };
  }

  // 同時 1 冊: キュー先頭の 1 冊のみ enqueue する。次の tick で次の 1 冊。
  const books = await db.book.findMany({
    where: { kdp_publish_queued: true, publish_status: { not: 'published' } },
    select: { id: true },
    orderBy: { updated_at: 'asc' },
    take: 1,
  });
  if (books.length === 0) {
    return { enabled: true, enqueued: 0, bookId: null };
  }
  const bookId = books[0]!.id;
  await addJob(
    'kdp.submit',
    { book_id: bookId, dry_run: settings.kdp_submit_dry_run },
    { jobKey: `kdp-submit-${bookId}`, jobKeyMode: 'preserve_run_at' },
  );
  log.info({ bookId, dry_run: settings.kdp_submit_dry_run }, 'kdp.submit.dispatch enqueued 1 book');
  return { enabled: true, enqueued: 1, bookId };
}

export const kdpSubmitDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runKdpSubmitDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
