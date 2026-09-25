import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import type { BookshelfPort } from '../src/tasks/book-cull/bookshelf-port.js';
import {
  mapShelfStatusToPb,
  runPaperbackStatusSync,
  PAPERBACK_STATUS_SYNC_TASK_NAME,
} from '../src/tasks/paperback-status-sync.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

interface BookRow {
  id: string;
  title: string;
  asin: string | null;
  pb_publish_status: string;
  pb_asin: string | null;
}

function buildPrisma(books: BookRow[], hasSession = true) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const prisma = {
    account: {
      findFirst: async () => (hasSession ? { id: 'acc1', kdp_session_state_enc: 'enc' } : { id: 'acc1', kdp_session_state_enc: null }),
    },
    book: {
      findMany: async () => books,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
  } as unknown as NonNullable<Parameters<typeof runPaperbackStatusSync>[0]>['prisma'];
  return { prisma, updates };
}

function makePort(
  byAsin: Record<string, Awaited<ReturnType<BookshelfPort['readPaperbackStatus']>>>,
): BookshelfPort {
  return {
    async takedownBook() {
      throw new Error('not used');
    },
    async readBookStatus() {
      throw new Error('not used');
    },
    async readPaperbackStatus(args) {
      return byAsin[args.asin] ?? { ok: true, status: 'not_found', pbAsin: null, priceJpy: null };
    },
  };
}

describe('mapShelfStatusToPb (F-097b)', () => {
  it('本棚のラベルを pb_publish_status に写す', () => {
    expect(mapShelfStatusToPb('live')?.pbStatus).toBe('published');
    expect(mapShelfStatusToPb('in_review')?.pbStatus).toBe('submitted');
    expect(mapShelfStatusToPb('draft')?.pbStatus).toBe('drafted');
    expect(mapShelfStatusToPb('blocked')?.pbStatus).toBe('failed');
    expect(mapShelfStatusToPb('unpublished')?.pbStatus).toBe('failed');
  });

  it('not_found は「取りこぼしと区別できない」ので触らない', () => {
    expect(mapShelfStatusToPb('not_found')).toBeNull();
  });
});

describe('paperback.status.sync', () => {
  it('販売中を検知したら published にしてキューから降ろす', async () => {
    const { prisma, updates } = buildPrisma([
      { id: 'b1', title: '本', asin: 'B0KINDLE01', pb_publish_status: 'drafted', pb_asin: null },
    ]);
    const port = makePort({
      B0KINDLE01: { ok: true, status: 'live', pbAsin: 'B0PAPER001', priceJpy: 1480 },
    });

    const res = await runPaperbackStatusSync({
      prisma,
      bookshelfPort: port,
      logger: makeLogger(),
      decryptSession: () => 'session',
    });

    expect(res).toMatchObject({ checked: 1, updated: 1, status: 'done' });
    expect(updates[0]!.data).toMatchObject({
      pb_publish_status: 'published',
      pb_publish_queued: false,
      pb_asin: 'B0PAPER001',
    });
  });

  it('状態が変わらなくても確認時刻だけ更新する (次回は後回しになる)', async () => {
    const { prisma, updates } = buildPrisma([
      { id: 'b1', title: '本', asin: 'B0KINDLE01', pb_publish_status: 'published', pb_asin: 'B0PAPER001' },
    ]);
    const port = makePort({
      B0KINDLE01: { ok: true, status: 'live', pbAsin: 'B0PAPER001', priceJpy: 1480 },
    });

    const res = await runPaperbackStatusSync({
      prisma,
      bookshelfPort: port,
      logger: makeLogger(),
      decryptSession: () => 'session',
    });

    expect(res.updated).toBe(0);
    expect(Object.keys(updates[0]!.data)).toEqual(['pb_status_checked_at']);
  });

  it('セッション切れを検知したら即座に打ち切る', async () => {
    const { prisma, updates } = buildPrisma([
      { id: 'b1', title: '本1', asin: 'B0A', pb_publish_status: 'drafted', pb_asin: null },
      { id: 'b2', title: '本2', asin: 'B0B', pb_publish_status: 'drafted', pb_asin: null },
    ]);
    const port = makePort({
      B0A: { ok: false, reason: 'session_expired', message: 'redirect' },
      B0B: { ok: true, status: 'live', pbAsin: 'B0PAPER002' },
    });

    const res = await runPaperbackStatusSync({
      prisma,
      bookshelfPort: port,
      logger: makeLogger(),
      decryptSession: () => 'session',
    });

    expect(res.status).toBe('session_expired');
    expect(res.checked).toBe(1);
    expect(updates).toHaveLength(0);
  });

  it('KDP セッションが無ければ何もしない', async () => {
    const { prisma, updates } = buildPrisma([], false);
    const res = await runPaperbackStatusSync({
      prisma,
      bookshelfPort: makePort({}),
      logger: makeLogger(),
      decryptSession: () => 'session',
    });
    expect(res.status).toBe('no_session');
    expect(updates).toHaveLength(0);
  });

  it('タスク名が docs/05 と一致する', () => {
    expect(PAPERBACK_STATUS_SYNC_TASK_NAME).toBe('paperback.status.sync');
  });
});
