import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { weightedTweetLengthWithUrls } from '@a2p/contracts/promotion/channels';

import {
  PROMOTION_NOTE_ARTICLE_TASK_NAME,
  runPromotionNoteArticle,
  jstDayBoundsUtc,
  offpeakScheduledForUtc,
  type PromotionNoteArticlePrisma,
} from '../src/tasks/promotion-note-article.js';

interface JobRecord {
  id: string;
  status: string;
}
interface PostRecord {
  channel: string;
  scheduled_for: Date;
  status: string;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  article?: {
    id: string;
    note_account_id: string;
    title: string;
    lead: string | null;
    note_url: string | null;
    publish_status: string;
  } | null;
  account?: { id: string; handle: string | null; niche: string } | null;
  existingPromo?: boolean;
  existingPosts?: PostRecord[];
}) {
  const jobs = [...args.jobs];
  const created: Array<Record<string, unknown>> = [];
  const existingPosts = args.existingPosts ?? [];
  const prisma: PromotionNoteArticlePrisma = {
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
    noteArticle: {
      findUnique: async ({ where }) => (args.article && args.article.id === where.id ? args.article : null),
    },
    noteAccount: {
      findUnique: async ({ where }) => (args.account && args.account.id === where.id ? args.account : null),
    },
    promotionChannelSetting: {
      findMany: async () => [],
    },
    promotionPost: {
      findFirst: async () => (args.existingPromo ? { id: 'existing' } : null),
      count: async ({ where }) =>
        existingPosts.filter(
          (p) =>
            p.channel === where.channel &&
            where.status.in.includes(p.status) &&
            p.scheduled_for.getTime() >= where.scheduled_for.gte.getTime() &&
            p.scheduled_for.getTime() < where.scheduled_for.lt.getTime(),
        ).length,
      createMany: async ({ data }) => {
        created.push(...data);
        return { count: data.length };
      },
    },
  };
  return { prisma, jobs, created };
}

const FIXED_NOW = new Date('2026-09-16T00:00:00Z'); // JST 09:00

describe('jstDayBoundsUtc / offpeakScheduledForUtc', () => {
  it('明日(dayOffset=1)の JST 00:00〜24:00 範囲を返す', () => {
    const { start, end } = jstDayBoundsUtc(FIXED_NOW, 1);
    expect(start.toISOString()).toBe('2026-09-16T15:00:00.000Z'); // JST 2026-09-17 00:00
    expect(end.toISOString()).toBe('2026-09-17T15:00:00.000Z');
  });

  it('指定した JST 分をその日の UTC 時刻に変換する', () => {
    const d = offpeakScheduledForUtc(FIXED_NOW, 1, 12 * 60); // 明日 12:00 JST
    expect(d.toISOString()).toBe('2026-09-17T03:00:00.000Z');
  });
});

describe('promotion.note.article', () => {
  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PROMOTION_NOTE_ARTICLE_TASK_NAME).toBe('promotion.note.article');
  });

  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runPromotionNoteArticle({})).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [] });
    await expect(
      runPromotionNoteArticle({ note_article_id: 'art1', job_id: 'job1' }, { prisma }),
    ).rejects.toThrow(NotFoundError);
  });

  it('publish_status が published でなければ skipped', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: { id: 'art1', note_account_id: 'acc1', title: 'T', lead: null, note_url: null, publish_status: 'draft' },
    });
    const res = await runPromotionNoteArticle({ note_article_id: 'art1', job_id: 'job1' }, { prisma, now: () => FIXED_NOW });
    expect(res).toEqual({ ok: false, status: 'skipped', reason: 'not_published' });
  });

  it('既に anp_article 投稿が存在すれば再生成しない (1記事1回)', async () => {
    const { prisma, created } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'L',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      existingPromo: true,
    });
    const res = await runPromotionNoteArticle({ note_article_id: 'art1', job_id: 'job1' }, { prisma, now: () => FIXED_NOW });
    expect(res).toEqual({ ok: false, status: 'skipped', reason: 'already_generated' });
    expect(created).toEqual([]);
  });

  it('X/Instagram の 2 チャンネル分の告知投稿を生成し note_url と handle を本文に含める(280字以内)', async () => {
    const { prisma, created, jobs } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: '意志が弱いのではなく、「環境設計」を知らなかっただけだった。',
        lead: 'リード文',
        note_url: 'https://note.com/goodbooks_intro/n/n5545faed9256',
        publish_status: 'published',
      },
      account: { id: 'acc1', handle: 'goodbooks_intro', niche: '習慣化' },
    });
    // 120字相当の日本語本文(重み約240)。handle+リンクを足しても appendArticleLink が
    // 280 に収める(code review #1 の再発防止確認)。
    const longBody = 'この記事を読んで「環境設計」という考え方に出会えて本当によかった。'.repeat(3).slice(0, 120);
    const createContent = vi.fn().mockResolvedValue({ body: longBody });
    const res = await runPromotionNoteArticle(
      { note_article_id: 'art1', job_id: 'job1' },
      { prisma, createContent, now: () => FIXED_NOW },
    );
    expect(res.ok).toBe(true);
    expect(res.created).toBe(2);
    expect(created).toHaveLength(2);
    expect(createContent).toHaveBeenCalledTimes(2);
    expect(created.map((r) => r.channel).sort()).toEqual(['instagram', 'x']);
    for (const row of created) {
      expect(row.kind).toBe('anp_article');
      expect(row.book_id).toBeNull();
      expect(row.note_article_id).toBe('art1');
      expect(String(row.body)).toContain('https://note.com/goodbooks_intro/n/n5545faed9256');
      expect(String(row.body)).toContain('@goodbooks_intro');
    }
    const xRow = created.find((r) => r.channel === 'x')!;
    expect(weightedTweetLengthWithUrls(String(xRow.body))).toBeLessThanOrEqual(280);

    // 明日(2026-09-17) の枠外時刻(x=12:00, instagram=15:00 JST)に配置される。
    expect((xRow.scheduled_for as Date).toISOString()).toBe(offpeakScheduledForUtc(FIXED_NOW, 1, 12 * 60).toISOString());
    const igRow = created.find((r) => r.channel === 'instagram')!;
    expect((igRow.scheduled_for as Date).toISOString()).toBe(offpeakScheduledForUtc(FIXED_NOW, 1, 15 * 60).toISOString());
    expect(jobs[0]!.status).toBe('done');
  });

  it('日次上限(3件)に達している日はスキップし、空きのある翌日以降に配置する', async () => {
    const { start } = jstDayBoundsUtc(FIXED_NOW, 1); // 明日
    const existingPosts: PostRecord[] = [
      { channel: 'x', scheduled_for: new Date(start.getTime() + 1000), status: 'scheduled' },
      { channel: 'x', scheduled_for: new Date(start.getTime() + 2000), status: 'scheduled' },
      { channel: 'x', scheduled_for: new Date(start.getTime() + 3000), status: 'draft' },
    ];
    const { prisma, created } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'L',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      account: { id: 'acc1', handle: null, niche: 'n' },
      existingPosts,
    });
    const createContent = vi.fn().mockResolvedValue({ body: 'body' });
    await runPromotionNoteArticle({ note_article_id: 'art1', job_id: 'job1' }, { prisma, createContent, now: () => FIXED_NOW });
    const xRow = created.find((r) => r.channel === 'x')!;
    // 明日は x が既に3件(上限)埋まっているため、明後日の 12:00 JST に送られる。
    expect((xRow.scheduled_for as Date).toISOString()).toBe(offpeakScheduledForUtc(FIXED_NOW, 2, 12 * 60).toISOString());
  });

  it('1チャンネルの生成失敗は他チャンネルを止めない', async () => {
    const { prisma, created } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'L',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      account: { id: 'acc1', handle: null, niche: 'n' },
    });
    const createContent = vi
      .fn()
      .mockRejectedValueOnce(new Error('llm error'))
      .mockResolvedValue({ body: 'body' });
    const res = await runPromotionNoteArticle(
      { note_article_id: 'art1', job_id: 'job1' },
      { prisma, createContent, now: () => FIXED_NOW },
    );
    expect(res.ok).toBe(true);
    expect(res.created).toBe(1);
    expect(created).toHaveLength(1);
  });
});
