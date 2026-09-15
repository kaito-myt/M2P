import { describe, expect, it, vi } from 'vitest';

import {
  NOTE_SALES_FETCH_DISPATCHER_TASK_NAME,
  runNoteSalesFetchDispatcher,
  type NoteSalesFetchDispatcherPrisma,
} from '../src/tasks/note-sales-fetch-dispatcher.js';

function buildPrisma(accounts: Array<{ id: string }>) {
  let counter = 0;
  const prisma: NoteSalesFetchDispatcherPrisma = {
    noteAccount: { findMany: async () => accounts },
    job: {
      create: async () => {
        counter += 1;
        return { id: `job-${counter}` };
      },
    },
  };
  return prisma;
}

describe('note.sales.fetch.dispatch', () => {
  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_SALES_FETCH_DISPATCHER_TASK_NAME).toBe('note.sales.fetch.dispatch');
  });

  it('addJob 未注入なら throw', async () => {
    await expect(runNoteSalesFetchDispatcher({ prisma: buildPrisma([]) })).rejects.toThrow('addJob must be provided');
  });

  it('active アカウント全件に note.sales.fetch を job_key 付きで enqueue する', async () => {
    const prisma = buildPrisma([{ id: 'acc1' }, { id: 'acc2' }]);
    const addJob = vi.fn().mockResolvedValue(undefined);
    const res = await runNoteSalesFetchDispatcher({ prisma, addJob, now: () => new Date('2026-09-16T00:00:00Z') });
    expect(res.enqueued).toBe(2);
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenNthCalledWith(
      1,
      'note.sales.fetch',
      { note_account_id: 'acc1', job_id: 'job-1' },
      expect.objectContaining({ jobKey: expect.stringContaining('note-sales-fetch-acc1-') }),
    );
  });

  it('1件の enqueue 失敗は他アカウントを止めない', async () => {
    const prisma = buildPrisma([{ id: 'acc1' }, { id: 'acc2' }]);
    const addJob = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const res = await runNoteSalesFetchDispatcher({ prisma, addJob });
    expect(res.enqueued).toBe(1);
    expect(res.accountIds).toEqual(['acc2']);
  });
});
