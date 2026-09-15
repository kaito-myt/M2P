import { describe, expect, it, vi } from 'vitest';

import {
  NOTE_PUBLISH_DISPATCHER_TASK_NAME,
  runNotePublishDispatcher,
  type NotePublishDispatcherPrisma,
} from '../src/tasks/note-publish-dispatcher.js';

function buildPrisma(args: {
  enabled: boolean;
  dryRun: boolean;
  accounts: Array<{ id: string }>;
  articlesByAccount: Record<string, { id: string; paid?: boolean } | undefined>;
}): NotePublishDispatcherPrisma {
  let jobCounter = 0;
  return {
    appSettings: {
      findUnique: async () => ({ anp_auto_publish_enabled: args.enabled, anp_publish_dry_run: args.dryRun }),
    },
    noteAccount: {
      findMany: async () => args.accounts,
    },
    noteArticle: {
      // 実 DB の where.paid フィルタを模倣(paid:true の記事は候補から除外)。
      findFirst: async ({ where }) => {
        const article = args.articlesByAccount[where.note_account_id];
        if (!article) return null;
        if (!!article.paid !== where.paid) return null;
        return { id: article.id };
      },
    },
    job: {
      create: async () => {
        jobCounter += 1;
        return { id: `job-${jobCounter}` };
      },
    },
  };
}

describe('note.publish.dispatch', () => {
  it('anp_auto_publish_enabled=false なら何もしない', async () => {
    const prisma = buildPrisma({ enabled: false, dryRun: true, accounts: [], articlesByAccount: {} });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res).toEqual({ enabled: false, enqueued: 0, articleIds: [] });
    expect(addJob).not.toHaveBeenCalled();
  });

  it('addJob 未注入なら throw', async () => {
    const prisma = buildPrisma({ enabled: true, dryRun: true, accounts: [], articlesByAccount: {} });
    await expect(runNotePublishDispatcher({ prisma })).rejects.toThrow();
  });

  it('アカウントごとに ready かつ draft の記事を1件ずつ enqueue する(3件上限)', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc1' }, { id: 'acc2' }, { id: 'acc3' }, { id: 'acc4' }],
      articlesByAccount: {
        acc1: { id: 'art1' },
        acc2: { id: 'art2' },
        acc3: { id: 'art3' },
        acc4: { id: 'art4' },
      },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.enabled).toBe(true);
    expect(res.enqueued).toBe(3);
    expect(res.articleIds).toEqual(['art1', 'art2', 'art3']);
    expect(addJob).toHaveBeenCalledTimes(3);
    expect(addJob).toHaveBeenCalledWith(
      'pipeline.note.publish',
      expect.objectContaining({ note_article_id: 'art1', dry_run: true }),
      expect.objectContaining({ jobKey: 'note-publish-art1', maxAttempts: 2 }),
    );
  });

  it('対象記事の無いアカウントはスキップする', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: false,
      accounts: [{ id: 'acc1' }, { id: 'acc2' }],
      articlesByAccount: { acc2: { id: 'art2' } },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.enqueued).toBe(1);
    expect(res.articleIds).toEqual(['art2']);
  });

  it('有料記事(paid=true)は自動運用の対象から除外する(code review #2)', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc1' }],
      articlesByAccount: { acc1: { id: 'art1', paid: true } },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.enqueued).toBe(0);
    expect(res.articleIds).toEqual([]);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_PUBLISH_DISPATCHER_TASK_NAME).toBe('note.publish.dispatch');
  });
});
