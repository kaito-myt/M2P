/**
 * `paperback.draft.dispatch` タスク (F-097f)。
 *
 * 30 分ごとに「Kindle は出したがペーパーバックの下書きがまだ無い本」を **1 冊だけ**
 * `paperback.draft` へ投入する（同時 1 冊 = ブラウザ 1 本。多重操作の事故とメモリを防ぐ）。
 * `paperback.submit.dispatch` と対になり、下書き作成 → 出版がサーバー側で完結する。
 *
 * 対象条件（`pb-auto.sh` の queue と同じ考え方）:
 *   - `pb_publish_status='unlisted'` かつ `pb_title_id` が無い（まだ下書きを作っていない）
 *   - `asin` がある（本棚で行を特定するのに要る = Kindle 版が出ている）
 *   - クールダウン中でない（作成数上限や判定 NG で置いた待ち時間）
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { PAPERBACK_DRAFT_TASK_NAME } from './paperback-draft.js';
import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const PAPERBACK_DRAFT_DISPATCHER_TASK_NAME = 'paperback.draft.dispatch';

export interface PaperbackDraftDispatcherPrisma {
  book: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; title: true };
      orderBy: Record<string, unknown>;
      take: number;
    }): Promise<Array<{ id: string; title: string }>>;
  };
}

export interface PaperbackDraftDispatcherDeps {
  prisma?: PaperbackDraftDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
  now?: () => Date;
  /** テスト用。既定は env の有無で判定する。 */
  hasCreds?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PaperbackDraftDispatcherResult {
  enabled: boolean;
  enqueued: number;
  bookId: string | null;
}

export async function runPaperbackDraftDispatcher(
  deps: PaperbackDraftDispatcherDeps = {},
): Promise<PaperbackDraftDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_DRAFT_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as PaperbackDraftDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${PAPERBACK_DRAFT_DISPATCHER_TASK_NAME}: addJob must be provided`);
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;

  const hasCreds = deps.hasCreds ?? Boolean(env.AMAZON_PASSWORD);
  if (!hasCreds) {
    log.info('AMAZON_PASSWORD 未設定 — paperback.draft.dispatch skip');
    return { enabled: false, enqueued: 0, bookId: null };
  }

  const books = await db.book.findMany({
    where: {
      pb_publish_status: 'unlisted',
      pb_title_id: null,
      asin: { not: null },
      OR: [{ pb_submit_cooldown_until: null }, { pb_submit_cooldown_until: { lte: now() } }],
    },
    select: { id: true, title: true },
    // 出版済み Kindle の古い順 (= 先に出した本からペーパーバック化する)。
    orderBy: { created_at: 'asc' },
    take: 1,
  });
  if (books.length === 0) return { enabled: true, enqueued: 0, bookId: null };

  const bookId = books[0]!.id;
  await addJob(
    PAPERBACK_DRAFT_TASK_NAME,
    { book_id: bookId },
    { jobKey: `paperback-draft-${bookId}`, jobKeyMode: 'preserve_run_at' },
  );
  log.info({ bookId, title: books[0]!.title }, 'paperback.draft.dispatch enqueued 1 book');
  return { enabled: true, enqueued: 1, bookId };
}

export const paperbackDraftDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runPaperbackDraftDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
