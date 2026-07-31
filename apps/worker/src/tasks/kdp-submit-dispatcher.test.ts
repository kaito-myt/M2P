import { describe, it, expect, vi } from 'vitest';

import { runKdpSubmitDispatcher, type KdpSubmitDispatcherPrisma } from './kdp-submit-dispatcher.js';

function prismaWith(opts: {
  enabled: boolean;
  dryRun?: boolean;
  books?: Array<{ id: string }>;
}): KdpSubmitDispatcherPrisma {
  return {
    appSettings: {
      findUnique: vi.fn().mockResolvedValue({
        kdp_auto_submit_enabled: opts.enabled,
        kdp_submit_dry_run: opts.dryRun ?? false,
      }),
    },
    book: {
      findMany: vi.fn().mockResolvedValue(opts.books ?? []),
    },
  } as unknown as KdpSubmitDispatcherPrisma;
}

describe('runKdpSubmitDispatcher', () => {
  it('creds 未設定なら何もしない', async () => {
    const addJob = vi.fn();
    const r = await runKdpSubmitDispatcher({
      prisma: prismaWith({ enabled: true, books: [{ id: 'b1' }] }),
      addJob,
      hasCreds: false,
    });
    expect(r.enabled).toBe(false);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('kdp_auto_submit_enabled=false なら enqueue しない', async () => {
    const addJob = vi.fn();
    const r = await runKdpSubmitDispatcher({
      prisma: prismaWith({ enabled: false, books: [{ id: 'b1' }] }),
      addJob,
      hasCreds: true,
    });
    expect(r.enqueued).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('有効かつキューに本があれば 1 冊だけ dry_run フラグ付きで enqueue', async () => {
    const addJob = vi.fn().mockResolvedValue(undefined);
    const r = await runKdpSubmitDispatcher({
      prisma: prismaWith({ enabled: true, dryRun: true, books: [{ id: 'b1' }] }),
      addJob,
      hasCreds: true,
    });
    expect(r.enqueued).toBe(1);
    expect(r.bookId).toBe('b1');
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(addJob).toHaveBeenCalledWith(
      'kdp.submit',
      { book_id: 'b1', dry_run: true },
      expect.objectContaining({ jobKey: 'kdp-submit-b1' }),
    );
  });

  it('キューが空なら enqueue しない', async () => {
    const addJob = vi.fn();
    const r = await runKdpSubmitDispatcher({
      prisma: prismaWith({ enabled: true, books: [] }),
      addJob,
      hasCreds: true,
    });
    expect(r.enqueued).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('addJob 未指定は throw', async () => {
    await expect(
      runKdpSubmitDispatcher({ prisma: prismaWith({ enabled: true }), hasCreds: true }),
    ).rejects.toThrow('addJob must be provided');
  });
});
