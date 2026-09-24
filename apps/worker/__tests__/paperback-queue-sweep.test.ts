import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import {
  PAPERBACK_QUEUE_SWEEP_TASK_NAME,
  PB_QUEUEABLE_STATUSES,
  runPaperbackQueueSweep,
  type PaperbackQueueSweepPrisma,
} from '../src/tasks/paperback-queue-sweep.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

interface Row {
  id: string;
  title: string;
  publish_status: string;
  pb_publish_status: string;
  pb_publish_queued: boolean;
  pb_submit_cooldown_until: Date | null;
}

function buildPrisma(rows: Row[]) {
  const findManyArgs: Array<Record<string, unknown>> = [];
  const updated: Array<{ ids: string[]; data: Record<string, unknown> }> = [];

  const prisma: PaperbackQueueSweepPrisma = {
    book: {
      findMany: async (args) => {
        findManyArgs.push(args.where);
        const w = args.where as {
          publish_status: string;
          pb_publish_status: { in: string[] };
          pb_publish_queued: boolean;
        };
        return rows
          .filter(
            (r) =>
              r.publish_status === w.publish_status &&
              w.pb_publish_status.in.includes(r.pb_publish_status) &&
              r.pb_publish_queued === w.pb_publish_queued &&
              (r.pb_submit_cooldown_until === null || r.pb_submit_cooldown_until <= new Date()),
          )
          .slice(0, args.take)
          .map((r) => ({ id: r.id, title: r.title }));
      },
      updateMany: async (args) => {
        const ids = ((args.where as { id: { in: string[] } }).id.in ?? []) as string[];
        updated.push({ ids, data: args.data });
        for (const r of rows) if (ids.includes(r.id)) r.pb_publish_queued = true;
        return { count: ids.length };
      },
      count: async (args) => {
        const w = args.where as Record<string, unknown>;
        return rows.filter((r) =>
          Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
        ).length;
      },
    },
  };
  return { prisma, updated, findManyArgs };
}

const base = (over: Partial<Row>): Row => ({
  id: 'b1',
  title: 'タイトル',
  publish_status: 'published',
  pb_publish_status: 'unlisted',
  pb_publish_queued: false,
  pb_submit_cooldown_until: null,
  ...over,
});

describe('paperback.queue.sweep (F-097)', () => {
  it('Kindle 出版済みでペーパーバック未対応の本をキューに積む', async () => {
    const { prisma, updated } = buildPrisma([
      base({ id: 'b1' }),
      base({ id: 'b2', pb_publish_status: 'failed' }),
    ]);

    const res = await runPaperbackQueueSweep({ prisma, logger: makeLogger() });

    expect(updated[0]!.ids.sort()).toEqual(['b1', 'b2']);
    expect(updated[0]!.data).toMatchObject({ pb_publish_queued: true });
    expect(res.queued).toBe(2);
  });

  it('出版済み/下書き済み/未公開の本は対象外', async () => {
    const { prisma, updated } = buildPrisma([
      base({ id: 'done', pb_publish_status: 'published' }),
      base({ id: 'drafted', pb_publish_status: 'drafted' }),
      base({ id: 'kindle-unlisted', publish_status: 'unlisted' }),
      base({ id: 'already', pb_publish_queued: true }),
    ]);

    const res = await runPaperbackQueueSweep({ prisma, logger: makeLogger() });

    expect(updated).toHaveLength(0);
    expect(res.queued).toBe(0);
  });

  it('クールダウン中の本はスキップする', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { prisma, updated } = buildPrisma([base({ id: 'cool', pb_submit_cooldown_until: future })]);

    await runPaperbackQueueSweep({ prisma, logger: makeLogger() });

    expect(updated).toHaveLength(0);
  });

  it('カバレッジ (Kindle 出版済み / PB 出版済み) を返す', async () => {
    const { prisma } = buildPrisma([
      base({ id: 'a', pb_publish_status: 'published' }),
      base({ id: 'b' }),
    ]);

    const res = await runPaperbackQueueSweep({ prisma, logger: makeLogger() });

    expect(res.publishedTotal).toBe(2);
    expect(res.paperbackPublished).toBe(1);
  });

  it('タスク名と対象ステータスが docs/05 と一致する', () => {
    expect(PAPERBACK_QUEUE_SWEEP_TASK_NAME).toBe('paperback.queue.sweep');
    expect([...PB_QUEUEABLE_STATUSES]).toEqual(['unlisted', 'failed']);
  });
});
