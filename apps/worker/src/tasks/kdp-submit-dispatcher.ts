/**
 * `kdp.submit.dispatch` タスク (F-041 Phase3 自動運用)。
 *
 * cron (既定 30 分毎) で起動し、`AppSettings.kdp_auto_submit_enabled=true` のとき
 * 入稿キュー(`books.kdp_publish_queued=true AND publish_status NOT IN (published,submitted,retracted)`)から
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
      select: { kdp_auto_submit_enabled: true; kdp_submit_dry_run: true; kdp_creation_paused_until: true };
    }): Promise<{ kdp_auto_submit_enabled: boolean; kdp_submit_dry_run: boolean; kdp_creation_paused_until: Date | null } | null>;
  };
  book: {
    findMany(args: {
      where: {
        kdp_publish_queued: true;
        publish_status: { notIn: string[] };
        OR: Array<{ kdp_submit_cooldown_until: null } | { kdp_submit_cooldown_until: { lte: Date } }>;
        covers: { some: { status: string } };
        artifacts: { some: { kind: string } };
      };
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
    select: { kdp_auto_submit_enabled: true, kdp_submit_dry_run: true, kdp_creation_paused_until: true },
  });
  if (!settings?.kdp_auto_submit_enabled) {
    return { enabled: false, enqueued: 0, bookId: null };
  }
  // 日次作成上限に到達して全体停止中なら、翌 JST 0 時まで何も投入しない（枠の浪費防止）。
  if (settings.kdp_creation_paused_until && settings.kdp_creation_paused_until.getTime() > Date.now()) {
    log.info(
      { pausedUntil: settings.kdp_creation_paused_until.toISOString() },
      'KDP日次作成上限で全体停止中 — dispatch skip',
    );
    return { enabled: true, enqueued: 0, bookId: null };
  }

  // 同時 1 冊: キュー先頭の 1 冊のみ enqueue する。次の tick で次の 1 冊。
  // creation_limit/no_draft でクールダウン中の本は翌日まで除外(枠の浪費・永久ループ防止)。
  const books = await db.book.findMany({
    where: {
      kdp_publish_queued: true,
      // 既にKDPにある本(submitted=審査中/公開, published, retracted)は二度と選ばない(二重出版防止)。
      // 'published' だけ除外だと submitted を再入稿して重複listingを作る事故になる(2026-08 実害)。
      publish_status: { notIn: ['published', 'submitted', 'retracted'] },
      OR: [{ kdp_submit_cooldown_until: null }, { kdp_submit_cooldown_until: { lte: new Date() } }],
      // 資産(採用カバー＋docx)が揃った本のみ対象にする。揃わない本を先頭で拾うと
      // kdp.submit が「資産不足」で skip したまま queue が進まず、後続の準備完了本が
      // 永久に出版されない head-of-line ブロッキングになる（実際に1冊で24冊が止まっていた）。
      covers: { some: { status: 'adopted' } },
      artifacts: { some: { kind: 'docx' } },
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
