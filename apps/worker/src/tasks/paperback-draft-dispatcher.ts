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

/** 投入した本を次の tick で選び直さないための猶予 (1 回の実行にかかる時間より長く取る)。 */
export const IN_FLIGHT_GUARD_MS = 30 * 60 * 1000;

export interface PaperbackDraftDispatcherPrisma {
  appSettings?: {
    findUnique(args: {
      where: { id: string };
      select: { kdp_creation_paused_until: true };
    }): Promise<{ kdp_creation_paused_until: Date | null } | null>;
  };
  book: {
    findMany(args: {
      where: Record<string, unknown>;
      select: { id: true; title: true };
      orderBy: Record<string, unknown> | Array<Record<string, unknown>>;
      take: number;
    }): Promise<Array<{ id: string; title: string }>>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
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

  // [F-097k] KDP の作成枠は Kindle 新刊と共通 (1 日 5 冊 / アカウント)。
  // 到達して全体停止中なら何も投入しない (10 分おきに 10 分の CREATE を無駄撃ちしないため)。
  const settings = await db.appSettings
    ?.findUnique({ where: { id: 'singleton' }, select: { kdp_creation_paused_until: true } })
    .catch(() => null);
  const pausedUntil = settings?.kdp_creation_paused_until ?? null;
  if (pausedUntil && pausedUntil.getTime() > now().getTime()) {
    log.info({ pausedUntil: pausedUntil.toISOString() }, 'KDP日次作成上限で全体停止中 — draft dispatch skip');
    return { enabled: true, enqueued: 0, bookId: null };
  }

  const books = await db.book.findMany({
    where: {
      pb_publish_status: 'unlisted',
      // `pb_title_id` が入っていても status が unlisted なら「採番後に落ちた下書き」なので
      // 対象に含める (paperback.draft 側が本棚を飛ばして再開する — F-097k)。
      asin: { not: null },
      // **Kindle が販売中の本だけ**。取り下げ済み (retracted) は本棚に
      // 「ペーパーバックの作成」が出ず、毎回 no_create_button で枠を潰していた
      // (2026-09-30 実測。DB の ASIN が Amazon 上に存在しないものもあった)。
      publish_status: 'published',
      OR: [{ pb_submit_cooldown_until: null }, { pb_submit_cooldown_until: { lte: now() } }],
    },
    select: { id: true, title: true },
    // 新しい本から。直近に出した本ほど本棚の先頭にあり確実に見つかる。
    //
    // **`books` に `published_at` 列は無い** (それは `blog_posts` / `note_articles` の列)。
    // 誤って `orderBy: { published_at: 'desc' }` を指定していた間、Prisma が毎回
    // `Unknown argument 'published_at'` で例外を投げ、`paperback.draft.dispatch` が
    // 2026-09-30〜10-02 で 297 件積み上がって**下書きが 1 冊も進まなかった**。
    // Kindle 出版日に相当するのは `done_at` (null あり) なので nulls last で並べる。
    orderBy: [{ done_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
    take: 1,
  });
  if (books.length === 0) return { enabled: true, enqueued: 0, bookId: null };

  const bookId = books[0]!.id;
  await addJob(
    PAPERBACK_DRAFT_TASK_NAME,
    { book_id: bookId },
    { jobKey: `paperback-draft-${bookId}`, jobKeyMode: 'preserve_run_at' },
  );
  // [F-097k] 同じ本の二重起動を防ぐ。
  // graphile は**ジョブが走り始めた時点で jobKey を解放する**ので、10 分おきの cron が
  // 走行中(10〜20 分)の本をもう一度投入してしまい、同じ本に対してブラウザが 2 本
  // 同時にウィザードを操作する事故が実際に起きた (2026-10-02 実測)。
  // 走行時間ぶんの短いクールダウンを置いて次の tick では選ばれないようにする。
  await db.book
    .update({
      where: { id: bookId },
      data: { pb_submit_cooldown_until: new Date(now().getTime() + IN_FLIGHT_GUARD_MS) },
    })
    .catch(() => undefined);
  log.info({ bookId, title: books[0]!.title }, 'paperback.draft.dispatch enqueued 1 book');
  return { enabled: true, enqueued: 1, bookId };
}

export const paperbackDraftDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runPaperbackDraftDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
