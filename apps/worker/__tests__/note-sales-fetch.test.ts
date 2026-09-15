import { describe, expect, it, vi } from 'vitest';

import {
  NOTE_SALES_FETCH_TASK_NAME,
  runNoteSalesFetch,
  type NoteSalesFetchPrisma,
} from '../src/tasks/note-sales-fetch.js';
import type { NoteSalesPort } from '../src/tasks/note-sales/playwright-note-sales-port.js';

interface JobRecord {
  id: string;
  status: string;
}
interface AccountRecord {
  id: string;
  display_name: string;
  handle: string | null;
  session_state_enc: string | null;
  followers_total?: number;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  accounts: AccountRecord[];
  articles?: Array<{ id: string; note_url: string | null }>;
}) {
  const jobs = [...args.jobs];
  const accounts = [...args.accounts];
  const salesRecords: Array<{ id: string; note_article_id: string; year_month: string; data: Record<string, unknown> }> = [];
  const membershipStats: Array<{ id: string; note_account_id: string; year_month: string; data: Record<string, unknown> }> = [];
  const accountUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];

  const prisma: NoteSalesFetchPrisma = {
    job: {
      findUnique: async ({ where }) => {
        const j = jobs.find((x) => x.id === where.id);
        return j ? { status: j.status } : null;
      },
      updateMany: async ({ where, data }) => {
        const matched = jobs.filter((j) => j.id === where.id && where.status.in.includes(j.status));
        for (const j of matched) j.status = data.status;
        return { count: matched.length };
      },
      update: async ({ where, data }) => {
        const j = jobs.find((x) => x.id === where.id);
        if (j && data.status) j.status = data.status;
        return { id: where.id };
      },
    },
    noteAccount: {
      findUnique: async ({ where }) => accounts.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const a = accounts.find((x) => x.id === where.id);
        if (a) Object.assign(a, data);
        accountUpdates.push({ id: where.id, data: data as Record<string, unknown> });
        return { id: where.id };
      },
    },
    noteArticle: {
      findMany: async () => args.articles ?? [],
    },
    noteSalesRecord: {
      findFirst: async ({ where }) =>
        salesRecords.find((r) => r.note_article_id === where.note_article_id && r.year_month === where.year_month) ?? null,
      update: async ({ where, data }) => {
        const r = salesRecords.find((x) => x.id === where.id);
        if (r) r.data = data as Record<string, unknown>;
        return { id: where.id };
      },
      create: async ({ data }) => {
        const id = `sales-${salesRecords.length + 1}`;
        salesRecords.push({ id, note_article_id: data.note_article_id, year_month: data.year_month, data: data as Record<string, unknown> });
        return { id };
      },
    },
    noteMembershipStat: {
      findFirst: async ({ where }) =>
        membershipStats.find((r) => r.note_account_id === where.note_account_id && r.year_month === where.year_month) ?? null,
      update: async ({ where, data }) => {
        const r = membershipStats.find((x) => x.id === where.id);
        if (r) r.data = data as Record<string, unknown>;
        return { id: where.id };
      },
      create: async ({ data }) => {
        const id = `member-${membershipStats.length + 1}`;
        membershipStats.push({ id, note_account_id: data.note_account_id, year_month: data.year_month, data: data as Record<string, unknown> });
        return { id };
      },
    },
  };

  return { prisma, jobs, accounts, salesRecords, membershipStats, accountUpdates };
}

const FIXED_NOW = new Date('2026-09-16T01:00:00Z'); // JST 10:00

describe('note.sales.fetch', () => {
  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_SALES_FETCH_TASK_NAME).toBe('note.sales.fetch');
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], accounts: [] });
    const salesPort: NoteSalesPort = { fetchStats: vi.fn() };
    await expect(
      runNoteSalesFetch({ note_account_id: 'acc1', job_id: 'job1' }, { prisma, salesPort }),
    ).rejects.toThrow('Job not found');
  });

  it('session 未設定なら no_session で完了', async () => {
    const { prisma, jobs } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', display_name: 'テスト', handle: null, session_state_enc: null }],
    });
    const salesPort: NoteSalesPort = { fetchStats: vi.fn() };
    const res = await runNoteSalesFetch({ note_account_id: 'acc1', job_id: 'job1' }, { prisma, salesPort, now: () => FIXED_NOW });
    expect(res).toEqual({ ok: false, status: 'no_session' });
    expect(jobs[0]!.status).toBe('done');
  });

  it('not_logged_in ならアカウントを paused にして LINE 通知', async () => {
    const { prisma, accountUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', display_name: 'テスト', handle: 'h', session_state_enc: 'enc' }],
    });
    const salesPort: NoteSalesPort = {
      fetchStats: vi.fn().mockResolvedValue({ ok: false, reason: 'not_logged_in', message: 'x' }),
    };
    const notify = vi.fn().mockResolvedValue(true);
    const res = await runNoteSalesFetch(
      { note_account_id: 'acc1', job_id: 'job1' },
      { prisma, salesPort, decryptSession: () => '{}', notify, now: () => FIXED_NOW },
    );
    expect(res.ok).toBe(false);
    expect(accountUpdates).toEqual([{ id: 'acc1', data: { status: 'paused' } }]);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('セッションが失効'));
  });

  it('salesPort が error(期間セレクタ切替失敗等)を返したら何も書き込まず Job を error で終える', async () => {
    const { prisma, accountUpdates, salesRecords } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', display_name: 'テスト', handle: 'h', session_state_enc: 'enc' }],
      articles: [{ id: 'art1', note_url: 'https://note.com/h/n/nabc' }],
    });
    const salesPort: NoteSalesPort = {
      fetchStats: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'error',
        message: '期間セレクタ(THIS_MONTH)への切替に失敗',
      }),
    };
    const notify = vi.fn().mockResolvedValue(true);
    const res = await runNoteSalesFetch(
      { note_account_id: 'acc1', job_id: 'job1' },
      { prisma, salesPort, decryptSession: () => '{}', notify, now: () => FIXED_NOW },
    );
    expect(res.ok).toBe(false);
    // 別期間の数値が当月行に混入しないこと: 売上・アカウント(followers/paused)とも未更新
    expect(salesRecords).toEqual([]);
    expect(accountUpdates).toEqual([]);
    // error はセッション失効ではないので LINE 通知もしない
    expect(notify).not.toHaveBeenCalled();
  });

  it('記事別データを note_url で突合して note_sales に upsert し、フォロワー数を更新する', async () => {
    const { prisma, accounts, salesRecords } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', display_name: 'テスト', handle: 'goodbooks_intro', session_state_enc: 'enc' }],
      articles: [
        { id: 'art1', note_url: 'https://note.com/goodbooks_intro/n/n5545faed9256' },
        { id: 'art2', note_url: 'https://note.com/goodbooks_intro/n/nunmatched' },
      ],
    });
    const salesPort: NoteSalesPort = {
      fetchStats: vi.fn().mockResolvedValue({
        ok: true,
        followers: 9,
        membership: null,
        articles: [
          {
            noteUrl: 'https://note.com/goodbooks_intro/n/n5545faed9256',
            impressions: 2,
            views: 1,
            likes: 3,
            comments: 0,
            revenueJpy: 0,
          },
          // どの NoteArticle にも一致しない行 (共有セッションの他コンテンツ) は無視される。
          { noteUrl: 'https://note.com/other/n/nzzz', impressions: 1, views: 1, likes: 0, comments: 0, revenueJpy: 0 },
        ],
      }),
    };
    const res = await runNoteSalesFetch(
      { note_account_id: 'acc1', job_id: 'job1' },
      { prisma, salesPort, decryptSession: () => '{}', now: () => FIXED_NOW },
    );
    expect(res).toEqual({ ok: true, status: 'ok', articlesUpdated: 1 });
    expect(accounts[0]!.followers_total).toBe(9);
    expect(salesRecords).toHaveLength(1);
    expect(salesRecords[0]!.note_article_id).toBe('art1');
    expect(salesRecords[0]!.data).toMatchObject({ views: 1, likes: 3, buyers: 0, revenue_jpy: 0 });
  });

  it('membership データがあれば note_membership_stats に upsert する', async () => {
    const { prisma, membershipStats } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', display_name: 'テスト', handle: null, session_state_enc: 'enc' }],
      articles: [],
    });
    const salesPort: NoteSalesPort = {
      fetchStats: vi.fn().mockResolvedValue({
        ok: true,
        followers: null,
        membership: { subscribers: 12, mrrJpy: 3600 },
        articles: [],
      }),
    };
    await runNoteSalesFetch({ note_account_id: 'acc1', job_id: 'job1' }, { prisma, salesPort, decryptSession: () => '{}', now: () => FIXED_NOW });
    expect(membershipStats).toHaveLength(1);
    expect(membershipStats[0]!.data).toMatchObject({ subscribers: 12, mrr_jpy: 3600 });
  });
});
