/**
 * F-ANP-30続き — promotion.note.article.video タスクの単体テスト (台本/レンダリング/uploadをDI)。
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { VideoScript } from '@a2p/contracts/agents/tiktok-video';

import {
  PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME,
  runPromotionNoteArticleVideo,
  ensureNoteCta,
  type PromotionNoteArticleVideoPrisma,
} from '../src/tasks/promotion-note-article-video.js';

interface JobRecord {
  id: string;
  status: string;
}

const script: VideoScript = {
  title: 'タイトル',
  scenes: [{ narration: 'a', caption: 'b', image_prompt: 'c', seconds: 5 }],
  caption: '続きが気になる本文',
  hashtags: ['#note'],
};

function buildPrisma(args: {
  jobs: JobRecord[];
  article?: {
    id: string;
    note_account_id: string;
    title: string;
    lead: string | null;
    body_md: string | null;
    note_url: string | null;
    publish_status: string;
  } | null;
  account?: { id: string; niche: string; tone: string | null } | null;
  existingPost?: boolean;
}) {
  const jobs = [...args.jobs];
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const prisma: PromotionNoteArticleVideoPrisma = {
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
      findUnique: async () => null,
    },
    promotionPost: {
      findFirst: async () => (args.existingPost ? { id: 'existing' } : null),
      create: async ({ data }) => {
        created.push(data);
        return { id: 'post_1' };
      },
      update: async ({ data }) => {
        updated.push(data);
        return {};
      },
      delete: async ({ where }) => {
        deleted.push(where.id);
        return {};
      },
    },
  };
  return { prisma, jobs, created, updated, deleted };
}

const FIXED_NOW = new Date('2026-09-21T00:00:00Z'); // JST 09:00

describe('ensureNoteCta', () => {
  it('note を含まない本文に CTA を付加する', () => {
    expect(ensureNoteCta('続きが気になる')).toBe('続きが気になる\nプロフィールの note で全文');
  });
  it('既に note を含む本文はそのまま', () => {
    expect(ensureNoteCta('note で読んでね')).toBe('note で読んでね');
  });
});

describe('promotion.note.article.video', () => {
  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME).toBe('promotion.note.article.video');
  });

  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runPromotionNoteArticleVideo({})).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [] });
    await expect(
      runPromotionNoteArticleVideo({ note_article_id: 'art1', job_id: 'job1' }, { prisma }),
    ).rejects.toThrow(NotFoundError);
  });

  it('publish_status が published でなければ skipped', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: null,
        body_md: null,
        note_url: null,
        publish_status: 'draft',
      },
    });
    const res = await runPromotionNoteArticleVideo({ note_article_id: 'art1', job_id: 'job1' }, { prisma, now: () => FIXED_NOW });
    expect(res).toEqual({ ok: false, status: 'skipped', reason: 'not_published' });
  });

  it('既に tiktok 投稿が存在すれば再生成しない', async () => {
    const { prisma, created } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'L',
        body_md: 'B',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      existingPost: true,
    });
    const res = await runPromotionNoteArticleVideo({ note_article_id: 'art1', job_id: 'job1' }, { prisma, now: () => FIXED_NOW });
    expect(res).toEqual({ ok: false, status: 'skipped', reason: 'already_generated' });
    expect(created).toEqual([]);
  });

  it('台本→レンダリング→R2→post を anp_article/tiktok で予約する', async () => {
    const { prisma, created, updated, jobs } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'リード文',
        body_md: 'B',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      account: { id: 'acc1', niche: '副業', tone: null },
    });
    const createScript = vi.fn(async () => script);
    const renderVideo = vi.fn(async () => Buffer.from('MP4'));
    const uploadBuffer = vi.fn(async (key: string) => ({ key }));

    const res = await runPromotionNoteArticleVideo(
      { note_article_id: 'art1', job_id: 'job1' },
      { prisma, now: () => FIXED_NOW, createScript, renderVideo, uploadBuffer },
    );

    expect(res).toEqual({ ok: true, status: 'created', post_id: 'post_1' });
    expect(createScript).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'tiktok', topic: 'T', book: expect.objectContaining({ title: 'T' }) }),
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ channel: 'tiktok', kind: 'anp_article', note_article_id: 'art1', status: 'draft' });
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: 'scheduled' });
    expect(String((updated[0] as { media_key: string }).media_key)).toContain('post_1');
    expect(jobs[0]!.status).toBe('done');
  });

  it('レンダリング失敗時は draft post を削除して例外を再送出する', async () => {
    const { prisma, deleted, jobs } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      article: {
        id: 'art1',
        note_account_id: 'acc1',
        title: 'T',
        lead: 'L',
        body_md: 'B',
        note_url: 'https://note.com/h/n/n1',
        publish_status: 'published',
      },
      account: { id: 'acc1', niche: '副業', tone: null },
    });
    const createScript = vi.fn(async () => script);
    const renderVideo = vi.fn(async () => {
      throw new Error('render failed');
    });
    await expect(
      runPromotionNoteArticleVideo(
        { note_article_id: 'art1', job_id: 'job1' },
        { prisma, now: () => FIXED_NOW, createScript, renderVideo },
      ),
    ).rejects.toThrow('render failed');
    expect(deleted).toEqual(['post_1']);
    expect(jobs[0]!.status).toBe('failed');
  });
});
