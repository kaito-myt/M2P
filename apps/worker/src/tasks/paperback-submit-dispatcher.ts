/**
 * `paperback.submit.dispatch` タスク (F-097d)。
 *
 * 30 分ごとに「KDP 側に下書きがあり、まだ出版していないペーパーバック」を **1 冊だけ**
 * `paperback.submit` へ投入する (同時 1 冊 = ブラウザ 1 本。メモリと多重操作の事故を防ぐ)。
 * 下書きの完成は KDP の作成数枠を消費しないので、Kindle 側が作成上限で止まっていても進む。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { PAPERBACK_SUBMIT_TASK_NAME } from './paperback-submit.js';
import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const PAPERBACK_SUBMIT_DISPATCHER_TASK_NAME = 'paperback.submit.dispatch';

export interface PaperbackSubmitDispatcherPrisma {
  book: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; title: true };
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<Array<{ id: string; title: string }>>;
  };
}

export interface PaperbackSubmitDispatcherDeps {
  prisma?: PaperbackSubmitDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
  now?: () => Date;
  /** テスト用。既定は env の有無で判定する。 */
  hasCreds?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PaperbackSubmitDispatcherResult {
  enabled: boolean;
  enqueued: number;
  bookId: string | null;
}

export async function runPaperbackSubmitDispatcher(
  deps: PaperbackSubmitDispatcherDeps = {},
): Promise<PaperbackSubmitDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_SUBMIT_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as PaperbackSubmitDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${PAPERBACK_SUBMIT_DISPATCHER_TASK_NAME}: addJob must be provided`);
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;

  const hasCreds = deps.hasCreds ?? Boolean(env.AMAZON_PASSWORD);
  if (!hasCreds) {
    log.info('AMAZON_PASSWORD 未設定 — paperback.submit.dispatch skip');
    return { enabled: false, enqueued: 0, bookId: null };
  }

  const books = await db.book.findMany({
    where: {
      pb_publish_status: 'drafted',
      pb_title_id: { not: null },
      OR: [{ pb_submit_cooldown_until: null }, { pb_submit_cooldown_until: { lte: now() } }],
    },
    select: { id: true, title: true },
    orderBy: { pb_drafted_at: 'asc' },
    take: 1,
  });
  if (books.length === 0) return { enabled: true, enqueued: 0, bookId: null };

  const bookId = books[0]!.id;
  await addJob(
    PAPERBACK_SUBMIT_TASK_NAME,
    { book_id: bookId },
    { jobKey: `paperback-submit-${bookId}`, jobKeyMode: 'preserve_run_at' },
  );
  log.info({ bookId, title: books[0]!.title }, 'paperback.submit.dispatch enqueued 1 book');
  return { enabled: true, enqueued: 1, bookId };
}

export const paperbackSubmitDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runPaperbackSubmitDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
