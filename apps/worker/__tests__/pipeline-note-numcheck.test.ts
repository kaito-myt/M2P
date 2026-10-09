/**
 * `pipeline.note.numcheck` タスクのテスト。
 *
 * 重点は「**この工程の失敗でパイプラインを止めない**」こと。数字を直す工程が
 * コケたからといって記事を落とすのは割に合わない (数値の不整合は judge が拾う)。
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { CheckNoteNumbersResult } from '@a2p/agents/anp/numcheck';

import {
  runPipelineNoteNumcheck,
  type AddJobLike,
  type PipelineNoteNumcheckPrisma,
} from '../src/tasks/pipeline-note-numcheck.js';
import { PIPELINE_NOTE_EYECATCH_TASK_NAME } from '../src/tasks/pipeline-note-eyecatch.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
}

interface JobRecord {
  id: string;
  status: string;
}
interface ArticleRecord {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  paywall_line_pos: number | null;
}

const ORIGINAL = '元の本文'.padEnd(600, 'あ');
const FIXED = '直した本文'.padEnd(600, 'あ');

function buildPrisma(args: { jobs: JobRecord[]; articles: ArticleRecord[] }) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  let counter = 0;

  const prisma: PipelineNoteNumcheckPrisma = {
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
        jobUpdates.push({ where, data: data as Record<string, unknown> });
        return { id: where.id };
      },
      create: async ({ data }) => {
        counter += 1;
        const id = `child-${counter}`;
        jobCreates.push({ data: data as Record<string, unknown> });
        jobs.push({ id, status: 'queued' });
        return { id };
      },
    },
    noteArticle: {
      findUnique: async ({ where }) => args.articles.find((a) => a.id === where.id) ?? null,
      update: async ({ where, data }) => {
        articleUpdates.push({ where, data: data as Record<string, unknown> });
        return { id: where.id };
      },
    },
    tokenUsage: { findMany: async () => [] },
    noteAccount: {
      findUnique: async () => ({
        id: 'acc1',
        niche: '競馬',
        tone: null,
        target_reader: null,
        editorial_policy: null,
      }),
    },
  };

  return { prisma, articleUpdates, jobCreates, jobUpdates };
}

function article(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    id: 'art1',
    note_account_id: 'acc1',
    title: 'T',
    body_md: ORIGINAL,
    paid: false,
    paywall_line_pos: null,
    ...overrides,
  };
}

const LOCKS = { acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) };

describe('pipeline.note.numcheck', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runPipelineNoteNumcheck({}, vi.fn() as AddJobLike)).rejects.toThrow(ValidationError);
  });

  it('body_md 未確定なら NotFoundError', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [article({ body_md: null })],
    });
    await expect(
      runPipelineNoteNumcheck({ note_article_id: 'art1', job_id: 'job1' }, vi.fn() as AddJobLike, {
        prisma,
        logger: makeLogger(),
        ...LOCKS,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('直した本文を書き戻し、eyecatch を連結して fixes を result_json に残す', async () => {
    const { prisma, articleUpdates, jobCreates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [article()],
    });
    const addJob = vi.fn() as AddJobLike;
    const checkNumbers = vi.fn(
      async (): Promise<CheckNoteNumbersResult> => ({
        body_md: FIXED,
        fixes: ['合計を 148 → 147 に修正'],
        unresolved: [],
        applied: true,
      }),
    );

    await runPipelineNoteNumcheck(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 1 },
      addJob,
      { prisma, logger: makeLogger(), checkNumbers, ...LOCKS },
    );

    expect(articleUpdates[0]!.data).toMatchObject({ body_md: FIXED, status: 'eyecatch' });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_EYECATCH_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_EYECATCH_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1', retry_count: 1 }),
      { maxAttempts: 3 },
    );
    const done = jobUpdates.find((u) => u.data.status === 'done');
    expect(done!.data.result_json).toMatchObject({
      applied: true,
      fixes: ['合計を 148 → 147 に修正'],
    });
  });

  it('直すところが無ければ本文は書き換えず status だけ進める', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [article()],
    });
    const checkNumbers = vi.fn(
      async (): Promise<CheckNoteNumbersResult> => ({
        body_md: ORIGINAL,
        fixes: [],
        unresolved: [],
        applied: true,
      }),
    );

    await runPipelineNoteNumcheck({ note_article_id: 'art1', job_id: 'job1' }, vi.fn() as AddJobLike, {
      prisma,
      logger: makeLogger(),
      checkNumbers,
      ...LOCKS,
    });

    expect(articleUpdates[0]!.data).toEqual({ status: 'eyecatch' });
    expect(articleUpdates[0]!.data).not.toHaveProperty('body_md');
  });

  it('チェックが例外で落ちてもパイプラインは止めず、本文はそのままで eyecatch へ進む', async () => {
    const { prisma, articleUpdates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [article()],
    });
    const addJob = vi.fn() as AddJobLike;
    const checkNumbers = vi.fn(async () => {
      throw new Error('LLM が落ちた');
    });

    await runPipelineNoteNumcheck({ note_article_id: 'art1', job_id: 'job1' }, addJob, {
      prisma,
      logger: makeLogger(),
      checkNumbers,
      ...LOCKS,
    });

    expect(articleUpdates[0]!.data).toEqual({ status: 'eyecatch' });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_EYECATCH_TASK_NAME,
      expect.anything(),
      expect.anything(),
    );
    const done = jobUpdates.find((u) => u.data.status === 'done');
    expect(done).toBeDefined();
    expect((done!.data.result_json as { unresolved: string[] }).unresolved[0]).toContain(
      'LLM が落ちた',
    );
  });

  it('有料記事で paywall 位置が返らない場合は本文を書き換えない (課金位置ズレ防止)', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [article({ paid: true, paywall_line_pos: 200 })],
    });
    const checkNumbers = vi.fn(
      async (): Promise<CheckNoteNumbersResult> => ({
        body_md: FIXED,
        fixes: ['直した'],
        unresolved: [],
        applied: true,
        // paywall_line_pos を返さない
      }),
    );

    await runPipelineNoteNumcheck({ note_article_id: 'art1', job_id: 'job1' }, vi.fn() as AddJobLike, {
      prisma,
      logger: makeLogger(),
      checkNumbers,
      ...LOCKS,
    });

    expect(articleUpdates[0]!.data).toEqual({ status: 'eyecatch' });
  });

  it('job が既に done なら何もしない (冪等)', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'done' }],
      articles: [article()],
    });
    const checkNumbers = vi.fn();

    await runPipelineNoteNumcheck({ note_article_id: 'art1', job_id: 'job1' }, vi.fn() as AddJobLike, {
      prisma,
      logger: makeLogger(),
      checkNumbers: checkNumbers as never,
      ...LOCKS,
    });

    expect(checkNumbers).not.toHaveBeenCalled();
    expect(articleUpdates).toHaveLength(0);
  });
});
