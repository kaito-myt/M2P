import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { GenerateNoteEyecatchResult } from '@a2p/agents/anp/eyecatch';

import {
  PIPELINE_NOTE_EYECATCH_TASK_NAME,
  runPipelineNoteEyecatch,
  type AddJobLike,
  type PipelineNoteEyecatchPrisma,
} from '../src/tasks/pipeline-note-eyecatch.js';
import { PIPELINE_NOTE_JUDGE_TASK_NAME } from '../src/tasks/pipeline-note-judge.js';

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
  theme_id: string | null;
  title: string;
  eyecatch_r2_key: string | null;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  articles: ArticleRecord[];
  accounts: Array<{ id: string; niche: string }>;
  themes?: Array<{ id: string; hook: string }>;
}) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  let counter = 0;

  const prisma: PipelineNoteEyecatchPrisma = {
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
      findUnique: async ({ where }) => args.accounts.find((a) => a.id === where.id) ?? null,
    },
    noteTheme: {
      findUnique: async ({ where }) => (args.themes ?? []).find((t) => t.id === where.id) ?? null,
    },
  };

  return { prisma, articleUpdates, jobCreates };
}

const SAMPLE_RESULT: GenerateNoteEyecatchResult = {
  r2Key: 'note/art1/eyecatch.jpg',
  promptUsed: 'prompt',
};

describe('pipeline.note.eyecatch', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    const addJob: AddJobLike = vi.fn();
    await expect(runPipelineNoteEyecatch({}, addJob)).rejects.toThrow(ValidationError);
  });

  it('NoteArticle 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [{ id: 'job1', status: 'queued' }], articles: [], accounts: [] });
    const addJob: AddJobLike = vi.fn();
    await expect(
      runPipelineNoteEyecatch(
        { note_article_id: 'art1', job_id: 'job1' },
        addJob,
        { prisma, logger: makeLogger(), acquireLock: vi.fn(), releaseLock: vi.fn() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('正常系: eyecatch_r2_key 更新 + judge enqueue (retry_count forward)', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        { id: 'art1', note_account_id: 'acc1', theme_id: 'theme1', title: 'タイトル', eyecatch_r2_key: null },
      ],
      accounts: [{ id: 'acc1', niche: '副業' }],
      themes: [{ id: 'theme1', hook: 'フック' }],
    });
    const addJob: AddJobLike = vi.fn();
    const generateEyecatch = vi.fn().mockResolvedValue(SAMPLE_RESULT);

    await runPipelineNoteEyecatch(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 1 },
      addJob,
      {
        prisma,
        logger: makeLogger(),
        generateEyecatch,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(generateEyecatch).toHaveBeenCalledWith(
      expect.objectContaining({ noteArticleId: 'art1', hook: 'フック', niche: '副業' }),
    );
    expect(articleUpdates[0]!.data).toMatchObject({
      eyecatch_r2_key: 'note/art1/eyecatch.jpg',
      status: 'judging',
    });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_JUDGE_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_JUDGE_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1', retry_count: 1 }),
      { maxAttempts: 3 },
    );
  });

  it('retry_count>0 かつ eyecatch_r2_key 済みなら再生成せず既存キーで judge へ直行する', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        {
          id: 'art1',
          note_account_id: 'acc1',
          theme_id: 'theme1',
          title: 'タイトル',
          eyecatch_r2_key: 'note/art1/eyecatch.jpg',
        },
      ],
      accounts: [{ id: 'acc1', niche: '副業' }],
      themes: [{ id: 'theme1', hook: 'フック' }],
    });
    const addJob: AddJobLike = vi.fn();
    const generateEyecatch = vi.fn().mockResolvedValue(SAMPLE_RESULT);

    await runPipelineNoteEyecatch(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 1 },
      addJob,
      {
        prisma,
        logger: makeLogger(),
        generateEyecatch,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(generateEyecatch).not.toHaveBeenCalled();
    expect(articleUpdates[0]!.data).toMatchObject({
      eyecatch_r2_key: 'note/art1/eyecatch.jpg',
      status: 'judging',
    });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_JUDGE_TASK_NAME });
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_EYECATCH_TASK_NAME).toBe('pipeline.note.eyecatch');
  });
});
