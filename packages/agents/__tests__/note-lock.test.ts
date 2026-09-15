import { describe, expect, it, vi } from 'vitest';

import { ConflictError } from '@a2p/contracts/errors';

// `@a2p/db` を引かないようモック。各テストで deps 経由で repo を差し替える。
vi.mock('@a2p/db', () => ({
  prisma: {
    noteLock: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import {
  acquireNoteLock,
  releaseNoteLock,
  sweepExpiredNoteLocks,
  type NoteLockRecord,
  type NoteLockRepo,
} from '../src/lib/note-lock.js';

// ---------------------------------------------------------------------------
// 実 DB セマンティクス忠実 mock — `book-lock.test.ts` と同型
// (PostgreSQL Unique constraint `NoteLock.note_article_id` 主キー + P2002)。
// ---------------------------------------------------------------------------

class FakeP2002Error extends Error {
  code = 'P2002';
  override name = 'PrismaClientKnownRequestError';
  meta: { target?: string[] };
  constructor(target = 'note_locks_pkey') {
    super(`Unique constraint failed on the constraint: \`${target}\``);
    this.meta = { target: [target] };
  }
}

interface MockState {
  rows: Map<string, NoteLockRecord>;
  repo: NoteLockRepo;
}

function makeMockRepo(): MockState {
  const rows = new Map<string, NoteLockRecord>();
  const repo: NoteLockRepo = {
    create: async ({ data }) => {
      if (rows.has(data.note_article_id)) {
        throw new FakeP2002Error();
      }
      const rec: NoteLockRecord = {
        note_article_id: data.note_article_id,
        holder: data.holder,
        acquired_at: data.acquired_at ?? new Date(),
        expires_at: data.expires_at,
      };
      rows.set(data.note_article_id, rec);
      return rec;
    },
    findUnique: async ({ where }) => rows.get(where.note_article_id) ?? null,
    deleteMany: async ({ where }) => {
      if ('expires_at' in where) {
        const threshold = where.expires_at.lt;
        let count = 0;
        for (const [k, v] of rows) {
          if (v.expires_at < threshold) {
            rows.delete(k);
            count++;
          }
        }
        return { count };
      }
      const existing = rows.get(where.note_article_id);
      if (!existing || existing.holder !== where.holder) return { count: 0 };
      rows.delete(where.note_article_id);
      return { count: 1 };
    },
  };
  return { rows, repo };
}

describe('acquireNoteLock', () => {
  it('空ロック状態 → 成功し NoteLockRecord を返す', async () => {
    const { repo, rows } = makeMockRepo();
    const now = new Date('2026-05-22T10:00:00Z');

    const rec = await acquireNoteLock(
      { noteArticleId: 'art-1', holder: 'pipeline:job-1', ttlMinutes: 30 },
      { prisma: { noteLock: repo }, now: () => now },
    );

    expect(rec.note_article_id).toBe('art-1');
    expect(rec.holder).toBe('pipeline:job-1');
    expect(rec.expires_at.toISOString()).toBe('2026-05-22T10:30:00.000Z');
    expect(rows.size).toBe(1);
  });

  it('P2002 (既存ロックあり) → ConflictError + details に既存 holder/expiresAt', async () => {
    const { repo } = makeMockRepo();
    const now = new Date('2026-05-22T10:00:00Z');
    await acquireNoteLock(
      { noteArticleId: 'art-X', holder: 'pipeline:first' },
      { prisma: { noteLock: repo }, now: () => now },
    );

    try {
      await acquireNoteLock(
        { noteArticleId: 'art-X', holder: 'pipeline:second' },
        { prisma: { noteLock: repo }, now: () => now },
      );
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      const ce = err as ConflictError;
      expect(ce.code).toBe('conflict');
      const details = ce.details as Record<string, unknown>;
      expect(details).toMatchObject({
        reason: 'note_article_locked',
        noteArticleId: 'art-X',
        requestedHolder: 'pipeline:second',
        existingHolder: 'pipeline:first',
      });
      expect(typeof details.existingExpiresAt).toBe('string');
    }
  });

  it('ttlMinutes <= 0 → ConflictError (引数バリデーション)', async () => {
    const { repo } = makeMockRepo();
    await expect(
      acquireNoteLock({ noteArticleId: 'a', holder: 'h', ttlMinutes: 0 }, { prisma: { noteLock: repo } }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('releaseNoteLock', () => {
  it('同一 holder → 削除される', async () => {
    const { repo, rows } = makeMockRepo();
    await acquireNoteLock({ noteArticleId: 'a', holder: 'pipeline:j1' }, { prisma: { noteLock: repo } });
    await releaseNoteLock({ noteArticleId: 'a', holder: 'pipeline:j1' }, { prisma: { noteLock: repo } });
    expect(rows.size).toBe(0);
  });

  it('別 holder → 削除されない (warn ログのみ)', async () => {
    const { repo, rows } = makeMockRepo();
    await acquireNoteLock({ noteArticleId: 'a', holder: 'pipeline:j1' }, { prisma: { noteLock: repo } });
    await releaseNoteLock({ noteArticleId: 'a', holder: 'pipeline:other' }, { prisma: { noteLock: repo } });
    expect(rows.size).toBe(1);
  });
});

describe('sweepExpiredNoteLocks', () => {
  it('expires_at < now の行を削除する', async () => {
    const { repo, rows } = makeMockRepo();
    const past = new Date('2026-01-01T00:00:00Z');
    const future = new Date('2099-01-01T00:00:00Z');
    rows.set('expired', { note_article_id: 'expired', holder: 'h', acquired_at: past, expires_at: past });
    rows.set('alive', { note_article_id: 'alive', holder: 'h', acquired_at: past, expires_at: future });

    const result = await sweepExpiredNoteLocks({
      prisma: { noteLock: repo },
      now: () => new Date('2026-06-01T00:00:00Z'),
    });

    expect(result.deletedCount).toBe(1);
    expect(rows.has('expired')).toBe(false);
    expect(rows.has('alive')).toBe(true);
  });
});
