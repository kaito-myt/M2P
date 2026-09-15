import type { JobHelpers, Task } from 'graphile-worker';

import {
  sweepExpiredLocks,
  sweepExpiredNoteLocks,
  type BookLockDeps,
  type BookLockLogger,
  type NoteLockDeps,
} from '@a2p/agents';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultJobPrisma } from '@a2p/db';

/**
 * 内部 `jobs` 行が running/queued のまま取り残される閾値（分）。
 * worker のデプロイ/再起動で実行中タスクが中断されると、graphile 側はリトライ上限で
 * 諦める一方、内部 Job 行は running のまま残り、UI（例: テーマ「生成中」バナー）が
 * 永久に生成中を表示してしまう。どの単一ステップも 2 時間は走らないため、
 * これを超えて running/queued の行は孤児とみなし failed に落とす。
 */
const STALE_JOB_MINUTES = 120;

interface StaleJobPrisma {
  job: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
}

/**
 * running/queued のまま閾値を超えた内部 Job を failed に落とす（孤児掃除）。
 * 長時間の正当なジョブを誤って殺さないよう閾値は十分大きく取る。
 */
export async function sweepStaleJobs(deps: {
  prisma?: StaleJobPrisma;
  logger?: Logger;
  now?: () => Date;
} = {}): Promise<{ sweptCount: number }> {
  const log = deps.logger ?? createLogger(`worker.${LOCKS_SWEEP_TASK_NAME}.jobs`);
  const prisma = deps.prisma ?? (defaultJobPrisma as unknown as StaleJobPrisma);
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - STALE_JOB_MINUTES * 60_000);

  const res = await prisma.job.updateMany({
    where: {
      status: { in: ['running', 'queued'] },
      created_at: { lt: cutoff },
    },
    data: {
      status: 'failed',
      finished_at: now,
      error: `orphaned: worker restart or lost job — swept after ${STALE_JOB_MINUTES}min`,
    },
  });
  if (res.count > 0) {
    log.warn(
      { task: LOCKS_SWEEP_TASK_NAME, sweptCount: res.count, staleMinutes: STALE_JOB_MINUTES },
      'swept orphaned internal jobs stuck in running/queued',
    );
  }
  return { sweptCount: res.count };
}

/**
 * `locks.sweep` タスク (T-02-07, docs/05 OQ-D-05)
 *
 * `expires_at` 超過の `book_locks` を一括削除する cron 専用タスク。
 * crontab.ts で `0 * * * *` (毎時 0 分) に発火させる。docs/05 §14 #4 で
 * 「BookLock は expires_at 自動解放」と定めたが、PostgreSQL 自体に TTL 機構は無いため
 * 本タスクが運用的な自動解放を担う。
 *
 * 失敗時は throw して graphile-worker のリトライ機構に委譲する。
 */

export const LOCKS_SWEEP_TASK_NAME = 'locks.sweep';

export interface LocksSweepDeps {
  /** 差し替え用 (テスト)。本番は `@a2p/db` のシングルトン経由 (sweepExpiredLocks 既定値)。 */
  prisma?: BookLockDeps['prisma'];
  /** ロガー差し替え。 */
  logger?: Logger;
  /** 「今」を固定するフック (テスト用)。 */
  now?: () => Date;
  /** 孤児ジョブ掃除の prisma 差し替え (テスト用)。未指定なら @a2p/db 既定。 */
  jobPrisma?: StaleJobPrisma;
  /** NoteLock 掃除の prisma 差し替え (テスト用)。未指定なら @a2p/db 既定。 */
  noteLockPrisma?: NoteLockDeps['prisma'];
}

/**
 * Pino Logger を BookLockLogger 形状にアダプトする。BookLockLogger は
 * `(payload, msg?) => void` の最小サブセットだけ要求するため、Pino の
 * `info`/`warn` をそのまま渡せる。
 */
function adaptLogger(log: Logger): BookLockLogger {
  return {
    info: (payload, msg) => log.info(payload, msg),
    warn: (payload, msg) => log.warn(payload, msg),
  };
}

/** テストから直接呼べるよう Task ラッパと分離。 */
export async function runLocksSweep(
  deps: LocksSweepDeps = {},
): Promise<{ deletedCount: number }> {
  const log = deps.logger ?? createLogger(`worker.${LOCKS_SWEEP_TASK_NAME}`);
  const sweepDeps: BookLockDeps = { logger: adaptLogger(log) };
  if (deps.prisma !== undefined) sweepDeps.prisma = deps.prisma;
  if (deps.now !== undefined) sweepDeps.now = deps.now;

  log.info({ task: LOCKS_SWEEP_TASK_NAME }, 'locks sweep start');
  const result = await sweepExpiredLocks(sweepDeps);

  // docs/11-anp-design.md §7 — NoteLock (ANP) も同じ毎時 tick で掃除する。
  // BookLock と同型の TTL 期限切れ掃除のため、失敗してもタスク全体は継続 (warn のみ)。
  try {
    const noteLockDeps: NoteLockDeps = { logger: adaptLogger(log) };
    if (deps.noteLockPrisma !== undefined) noteLockDeps.prisma = deps.noteLockPrisma;
    if (deps.now !== undefined) noteLockDeps.now = deps.now;
    await sweepExpiredNoteLocks(noteLockDeps);
  } catch (err) {
    log.warn({ task: LOCKS_SWEEP_TASK_NAME, err }, 'sweepExpiredNoteLocks failed — continuing');
  }

  // ロック掃除と同じ毎時 tick で、孤児化した内部 Job も掃除する。
  // ジョブ掃除の失敗はロック掃除の成功を巻き戻さない(非致命・ログのみ)。
  try {
    const staleDeps: Parameters<typeof sweepStaleJobs>[0] = { logger: log };
    if (deps.now !== undefined) staleDeps.now = deps.now;
    if (deps.jobPrisma !== undefined) staleDeps.prisma = deps.jobPrisma;
    await sweepStaleJobs(staleDeps);
  } catch (err) {
    log.warn({ task: LOCKS_SWEEP_TASK_NAME, err }, 'sweepStaleJobs failed — continuing');
  }
  log.info(
    { task: LOCKS_SWEEP_TASK_NAME, deletedCount: result.deletedCount },
    'locks sweep done',
  );
  return result;
}

export const locksSweepTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  // sweepExpiredLocks の既定 prisma (@a2p/db シングルトン) を使う。
  await runLocksSweep();
};
