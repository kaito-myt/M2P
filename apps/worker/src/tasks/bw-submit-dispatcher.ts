/**
 * `bw.submit.dispatch` タスク (F-094 自動運用)。
 *
 * cron (既定 30 分毎) で起動し、`AppSettings.bw_auto_submit_enabled=true` かつ
 * BW セッション保存済みのとき、入稿キュー
 * (`books.bw_publish_queued=true AND bw_publish_status NOT IN (submitted, published)`)
 * から **1 冊だけ** `bw.submit` へ enqueue する（同時 1 冊で多重申請を防止）。
 * `bw_submit_dry_run=true` なら販売申請直前で止めるドライランを渡す。
 * job_key で同一書籍の重複投入を防ぐ。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const BW_SUBMIT_DISPATCHER_TASK_NAME = 'bw.submit.dispatch';

export interface BwSubmitDispatcherPrisma {
  appSettings: {
    findUnique(args: {
      where: { id: string };
      select: { bw_auto_submit_enabled: true; bw_submit_dry_run: true; bw_session_state_enc: true };
    }): Promise<{
      bw_auto_submit_enabled: boolean;
      bw_submit_dry_run: boolean;
      bw_session_state_enc: string | null;
    } | null>;
  };
  book: {
    findMany(args: {
      where: {
        bw_publish_queued: true;
        bw_publish_status: { notIn: string[] };
        OR: Array<{ bw_submit_cooldown_until: null } | { bw_submit_cooldown_until: { lte: Date } }>;
        covers: { some: { status: string } };
        chapters: { some: object };
      };
      select: { id: true };
      orderBy: { updated_at: 'asc' };
      take: number;
    }): Promise<Array<{ id: string }>>;
  };
}

export interface BwSubmitDispatcherDeps {
  prisma?: BwSubmitDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
}

export interface BwSubmitDispatcherResult {
  enabled: boolean;
  enqueued: number;
  bookId: string | null;
}

export async function runBwSubmitDispatcher(
  deps: BwSubmitDispatcherDeps = {},
): Promise<BwSubmitDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${BW_SUBMIT_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as BwSubmitDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${BW_SUBMIT_DISPATCHER_TASK_NAME}: addJob must be provided`);

  const settings = await db.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { bw_auto_submit_enabled: true, bw_submit_dry_run: true, bw_session_state_enc: true },
  });
  if (!settings?.bw_auto_submit_enabled) {
    return { enabled: false, enqueued: 0, bookId: null };
  }
  if (!settings.bw_session_state_enc) {
    log.info('bw_session_state_enc 未保存 — bw.submit.dispatch skip (bw-session-push.mjs 実行待ち)');
    return { enabled: true, enqueued: 0, bookId: null };
  }

  // 同時 1 冊: キュー先頭の 1 冊のみ enqueue。既に申請済み/販売中は二度と選ばない(二重申請防止)。
  // 資産(採用表紙+章)が揃った本のみ対象 — head-of-line ブロッキング防止 (kdp.submit.dispatch と同方針)。
  const books = await db.book.findMany({
    where: {
      bw_publish_queued: true,
      bw_publish_status: { notIn: ['submitted', 'published'] },
      OR: [{ bw_submit_cooldown_until: null }, { bw_submit_cooldown_until: { lte: new Date() } }],
      covers: { some: { status: 'adopted' } },
      chapters: { some: {} },
    },
    select: { id: true },
    orderBy: { updated_at: 'asc' },
    take: 1,
  });
  if (books.length === 0) {
    return { enabled: true, enqueued: 0, bookId: null };
  }
  const bookId = books[0]!.id;
  await addJob(
    'bw.submit',
    { book_id: bookId, dry_run: settings.bw_submit_dry_run },
    { jobKey: `bw-submit-${bookId}`, jobKeyMode: 'preserve_run_at' },
  );
  log.info({ bookId, dry_run: settings.bw_submit_dry_run }, 'bw.submit.dispatch enqueued 1 book');
  return { enabled: true, enqueued: 1, bookId };
}

export const bwSubmitDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runBwSubmitDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
