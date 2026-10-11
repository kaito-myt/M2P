import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PER_ACCOUNT_PER_DAY,
  NOTE_PUBLISH_DISPATCHER_TASK_NAME,
  runNotePublishDispatcher,
  startOfJstDay,
  type NotePublishDispatcherPrisma,
} from '../src/tasks/note-publish-dispatcher.js';

function buildPrisma(args: {
  enabled: boolean;
  dryRun: boolean;
  accounts: Array<{ id: string; settings_json?: unknown }>;
  articlesByAccount: Record<string, { id: string; paid?: boolean } | undefined>;
  /** そのアカウントが「今日」すでに公開した本数 (日次上限のテスト用)。 */
  publishedTodayByAccount?: Record<string, number>;
}): NotePublishDispatcherPrisma {
  let jobCounter = 0;
  return {
    appSettings: {
      findUnique: async () => ({
        anp_auto_publish_enabled: args.enabled,
        anp_publish_dry_run: args.dryRun,
      }),
    },
    noteAccount: {
      findMany: async () => args.accounts,
    },
    noteArticle: {
      findFirst: async ({ where }) => {
        const article = args.articlesByAccount[where.note_account_id];
        if (!article) return null;
        return { id: article.id };
      },
      count: async ({ where }) => args.publishedTodayByAccount?.[where.note_account_id] ?? 0,
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
    expect(res).toEqual({ enabled: false, enqueued: 0, articleIds: [], cappedAccounts: 0 });
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

  it('有料記事(paid=true)も自動公開の対象にする (2026-10-11: F-ANP-16b 後の除外条件撤去)', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc1' }],
      articlesByAccount: { acc1: { id: 'art1', paid: true } },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.enqueued).toBe(1);
    expect(res.articleIds).toEqual(['art1']);
  });

  it('findFirst の where に paid 条件を渡さない (有料/無料を問わず古い順に出す)', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc1' }],
      articlesByAccount: { acc1: { id: 'art1' } },
    });
    const orig = prisma.noteArticle.findFirst;
    prisma.noteArticle.findFirst = async (a) => {
      seen.push(a.where as unknown as Record<string, unknown>);
      return orig(a);
    };
    await runNotePublishDispatcher({ prisma, addJob: vi.fn() });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('paid');
    expect(seen[0]).toMatchObject({ status: 'ready', publish_status: 'draft' });
  });

  it('日次上限に達したアカウントは見送る (cappedAccounts に数える)', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc_full' }, { id: 'acc_room' }],
      articlesByAccount: { acc_full: { id: 'art_full' }, acc_room: { id: 'art_room' } },
      publishedTodayByAccount: {
        acc_full: MAX_PER_ACCOUNT_PER_DAY,
        acc_room: MAX_PER_ACCOUNT_PER_DAY - 1,
      },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.articleIds).toEqual(['art_room']);
    expect(res.cappedAccounts).toBe(1);
    expect(addJob).toHaveBeenCalledTimes(1);
  });

  it('日次カウントは published_at >= JST 当日 0 時・publish_status=published で数える', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc1' }],
      articlesByAccount: { acc1: { id: 'art1' } },
    });
    prisma.noteArticle.count = async ({ where }) => {
      seen.push(where as unknown as Record<string, unknown>);
      return 0;
    };
    // JST 2026-10-11 08:00 = UTC 2026-10-10 23:00
    await runNotePublishDispatcher({
      prisma,
      addJob: vi.fn(),
      now: () => new Date('2026-10-10T23:00:00.000Z'),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ note_account_id: 'acc1', publish_status: 'published' });
    expect((seen[0] as { published_at: { gte: Date } }).published_at.gte.toISOString()).toBe(
      '2026-10-10T15:00:00.000Z',
    );
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_PUBLISH_DISPATCHER_TASK_NAME).toBe('note.publish.dispatch');
  });

  it('F-ANP-17: アカウント別 settings_json.auto_publish_enabled=false のアカウントはスキップする', async () => {
    const prisma = buildPrisma({
      enabled: true,
      dryRun: true,
      accounts: [{ id: 'acc_off', settings_json: { auto_publish_enabled: false } }, { id: 'acc_on' }],
      articlesByAccount: { acc_off: { id: 'art_off' }, acc_on: { id: 'art_on' } },
    });
    const addJob = vi.fn();
    const res = await runNotePublishDispatcher({ prisma, addJob });
    expect(res.enqueued).toBe(1);
    expect(res.articleIds).toEqual(['art_on']);
  });
});

describe('startOfJstDay', () => {
  it('JST の日付が変わる瞬間 (UTC 15:00) を境界にする', () => {
    // JST 2026-10-11 00:00 = UTC 2026-10-10 15:00
    expect(startOfJstDay(new Date('2026-10-10T15:00:00.000Z')).toISOString()).toBe(
      '2026-10-10T15:00:00.000Z',
    );
    // その 1 ミリ秒前はまだ JST 10/10
    expect(startOfJstDay(new Date('2026-10-10T14:59:59.999Z')).toISOString()).toBe(
      '2026-10-09T15:00:00.000Z',
    );
  });

  it('JST 深夜 23:59 でも当日 0 時を返す', () => {
    // JST 2026-10-11 23:59 = UTC 2026-10-11 14:59
    expect(startOfJstDay(new Date('2026-10-11T14:59:00.000Z')).toISOString()).toBe(
      '2026-10-10T15:00:00.000Z',
    );
  });
});
