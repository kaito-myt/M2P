/**
 * docs/11-anp-design.md §6/§7 — note 記事単位の排他制御 (`NoteLock`) ヘルパ。
 * A2P の `book-lock.ts` (docs/05 §14 #4) と完全対称の実装。ANP のパイプライン
 * タスク (`pipeline.note.*`) が記事書き込みに入る前に取得し、終了時に解放する。
 *
 * 同時性モデル・エラー方針は `book-lock.ts` と同一 (NoteLock.note_article_id が
 * 主キーの Unique constraint violation を `ConflictError` に正規化する)。
 */
import { ConflictError } from '@a2p/contracts/errors';
import { prisma as defaultPrisma } from '@a2p/db';

export interface NoteLockRecord {
  note_article_id: string;
  holder: string;
  acquired_at: Date;
  expires_at: Date;
}

export interface NoteLockRepo {
  create(args: {
    data: {
      note_article_id: string;
      holder: string;
      acquired_at?: Date;
      expires_at: Date;
    };
  }): Promise<NoteLockRecord>;
  findUnique(args: {
    where: { note_article_id: string };
  }): Promise<NoteLockRecord | null>;
  deleteMany(args: {
    where:
      | { note_article_id: string; holder: string }
      | { expires_at: { lt: Date } };
  }): Promise<{ count: number }>;
}

export interface NoteLockLogger {
  info: (payload: Record<string, unknown>, msg?: string) => void;
  warn: (payload: Record<string, unknown>, msg?: string) => void;
}

export interface NoteLockDeps {
  prisma?: { noteLock: NoteLockRepo };
  logger?: NoteLockLogger;
  now?: () => Date;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { code?: unknown };
  return e.code === 'P2002';
}

const noopLogger: NoteLockLogger = {
  info: () => {},
  warn: () => {},
};

function getRepo(deps: NoteLockDeps): NoteLockRepo {
  return (
    deps.prisma?.noteLock ??
    (defaultPrisma as unknown as { noteLock: NoteLockRepo }).noteLock
  );
}

function getLogger(deps: NoteLockDeps): NoteLockLogger {
  return deps.logger ?? noopLogger;
}

export interface AcquireNoteLockArgs {
  noteArticleId: string;
  /** `"pipeline:<job_id>"` 規約 (book-lock と同型)。 */
  holder: string;
  ttlMinutes?: number;
}

/**
 * `NoteLock` を 1 件 INSERT する。既存ロックがあれば `ConflictError` を throw。
 */
export async function acquireNoteLock(
  args: AcquireNoteLockArgs,
  deps: NoteLockDeps = {},
): Promise<NoteLockRecord> {
  const { noteArticleId, holder } = args;
  const ttlMinutes = args.ttlMinutes ?? 30;
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
    throw new ConflictError('ttlMinutes は 1 以上の有限数である必要があります', {
      details: { noteArticleId, holder, ttlMinutes },
    });
  }
  const repo = getRepo(deps);
  const log = getLogger(deps);
  const now = (deps.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  try {
    const created = await repo.create({
      data: {
        note_article_id: noteArticleId,
        holder,
        acquired_at: now,
        expires_at: expiresAt,
      },
    });
    log.info(
      { noteArticleId, holder, expiresAt: expiresAt.toISOString(), ttlMinutes },
      'note lock acquired',
    );
    return created;
  } catch (err) {
    if (!isUniqueConstraintViolation(err)) throw err;

    let existingHolder: string | undefined;
    let existingExpiresAt: string | undefined;
    try {
      const existing = await repo.findUnique({ where: { note_article_id: noteArticleId } });
      if (existing) {
        existingHolder = existing.holder;
        existingExpiresAt = existing.expires_at.toISOString();
      }
    } catch (lookupErr) {
      log.warn(
        { err: lookupErr, noteArticleId },
        'failed to read existing NoteLock after conflict',
      );
    }

    throw new ConflictError(
      `NoteLock conflict: note_article_id=${noteArticleId} already held by ${existingHolder ?? 'unknown'}`,
      {
        userMessage: 'この記事は別の処理中のため操作できません',
        details: {
          reason: 'note_article_locked',
          noteArticleId,
          requestedHolder: holder,
          existingHolder,
          existingExpiresAt,
        },
        cause: err,
      },
    );
  }
}

export interface ReleaseNoteLockArgs {
  noteArticleId: string;
  holder: string;
}

/**
 * 指定 holder の `NoteLock` を 1 件削除する。不一致/既解放時は warn のみで継続。
 */
export async function releaseNoteLock(
  args: ReleaseNoteLockArgs,
  deps: NoteLockDeps = {},
): Promise<void> {
  const { noteArticleId, holder } = args;
  const repo = getRepo(deps);
  const log = getLogger(deps);

  const result = await repo.deleteMany({
    where: { note_article_id: noteArticleId, holder },
  });
  if (result.count === 0) {
    log.warn(
      { noteArticleId, holder },
      'releaseNoteLock: no row deleted (already released or held by another holder)',
    );
    return;
  }
  log.info({ noteArticleId, holder, deleted: result.count }, 'note lock released');
}

export interface SweepNoteLocksResult {
  deletedCount: number;
}

/** `expires_at < now()` の `NoteLock` を一括削除する (`locks.sweep` cron から共用)。 */
export async function sweepExpiredNoteLocks(
  deps: NoteLockDeps = {},
): Promise<SweepNoteLocksResult> {
  const repo = getRepo(deps);
  const log = getLogger(deps);
  const now = (deps.now ?? (() => new Date()))();

  const result = await repo.deleteMany({
    where: { expires_at: { lt: now } },
  });
  log.info(
    { deletedCount: result.count, asOf: now.toISOString() },
    'expired note locks swept',
  );
  return { deletedCount: result.count };
}
