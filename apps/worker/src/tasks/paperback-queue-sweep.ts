/**
 * `paperback.queue.sweep` タスク (F-097)。
 *
 * 運営者指摘 (2026-09-24)「KDP の方ペーパーバックが結構売れてるから、確実に出版した本は
 * ペーパーバックも出版されるように A2P の実装よく確認して」への対応。
 *
 * 実態調査の結果: ペーパーバックの状態はローカルのテキスト台帳
 * (`scripts/paperback/pb-published.txt` 等) にしか無く、書籍のライフサイクルと繋がっていなかった。
 * そのため新刊は放っておくと永久にペーパーバック化されず、**KDP 出版済み 93 冊中 12 冊**しか
 * ペーパーバックが出ていなかった。
 *
 * 本タスクは日次で「Kindle は出したのにペーパーバックが未対応の本」を探し、
 * `books.pb_publish_queued=true` を立てるだけの軽いスイープ (LLM も外部 API も使わない)。
 * 実際の入稿・出版は KDP の再認証壁があるためローカルアシスト
 * (`bash scripts/paperback/pb-auto.sh`) が本キューを読んで実行し、結果を `pb_publish_status` に書き戻す。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

export const PAPERBACK_QUEUE_SWEEP_TASK_NAME = 'paperback.queue.sweep';

/** キュー対象にする PB 状態 (published/drafted/submitted は対象外)。 */
export const PB_QUEUEABLE_STATUSES = ['unlisted', 'failed'] as const;

export interface PaperbackQueueSweepPrisma {
  book: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; title: true };
      take: number;
    }): Promise<Array<{ id: string; title: string }>>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

export interface PaperbackQueueSweepDeps {
  prisma?: PaperbackQueueSweepPrisma;
  logger?: Logger;
  now?: () => Date;
  /** 1 回のスイープでキューに積む上限 (既定 50)。 */
  limit?: number;
}

export interface PaperbackQueueSweepResult {
  queued: number;
  alreadyQueued: number;
  publishedTotal: number;
  paperbackPublished: number;
}

/**
 * Kindle 出版済み (publish_status='published') で、ペーパーバックが未対応
 * (`pb_publish_status IN ('unlisted','failed')`) かつクールダウン中でない本をキューに積む。
 */
export async function runPaperbackQueueSweep(
  deps: PaperbackQueueSweepDeps = {},
): Promise<PaperbackQueueSweepResult> {
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PaperbackQueueSweepPrisma);
  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_QUEUE_SWEEP_TASK_NAME}`);
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? 50;

  const baseWhere = {
    publish_status: 'published',
    pb_publish_status: { in: [...PB_QUEUEABLE_STATUSES] },
  };

  const targets = await prisma.book.findMany({
    where: {
      ...baseWhere,
      pb_publish_queued: false,
      OR: [{ pb_submit_cooldown_until: null }, { pb_submit_cooldown_until: { lte: now() } }],
    },
    select: { id: true, title: true },
    take: limit,
  });

  let queued = 0;
  if (targets.length > 0) {
    const res = await prisma.book.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { pb_publish_queued: true, pb_publish_queued_at: now() },
    });
    queued = res.count;
  }

  const [alreadyQueued, publishedTotal, paperbackPublished] = await Promise.all([
    prisma.book.count({ where: { pb_publish_queued: true } }),
    prisma.book.count({ where: { publish_status: 'published' } }),
    prisma.book.count({ where: { pb_publish_status: 'published' } }),
  ]);

  log.info(
    {
      task: PAPERBACK_QUEUE_SWEEP_TASK_NAME,
      queued,
      alreadyQueued,
      publishedTotal,
      paperbackPublished,
      coverage: publishedTotal > 0 ? Math.round((paperbackPublished / publishedTotal) * 100) : 0,
    },
    'paperback queue swept',
  );

  return { queued, alreadyQueued, publishedTotal, paperbackPublished };
}

export const paperbackQueueSweepTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  await runPaperbackQueueSweep();
};
