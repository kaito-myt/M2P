import { describe, expect, it, vi } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteOutlineOutput } from '@a2p/contracts/agents/anp';

import {
  PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
  runPipelineNoteWriterOutline,
  type AddJobLike,
  type PipelineNoteWriterOutlineDeps,
  type PipelineNoteWriterOutlinePrisma,
} from '../src/tasks/pipeline-note-writer-outline.js';
import { PIPELINE_NOTE_WRITER_BODY_TASK_NAME } from '../src/tasks/pipeline-note-writer-body.js';

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
  paid: boolean;
}
interface AccountRecord {
  id: string;
  niche: string;
  target_reader: string | null;
  tone: string | null;
}
interface ThemeRecord {
  id: string;
  hook: string;
  target_reader: string | null;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  articles: ArticleRecord[];
  accounts: AccountRecord[];
  themes?: ThemeRecord[];
}) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  let jobCreateCounter = 0;

  const prisma: PipelineNoteWriterOutlinePrisma = {
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
        jobUpdates.push({ where, data: data as Record<string, unknown> });
        const j = jobs.find((x) => x.id === where.id);
        if (j && data.status) j.status = data.status;
        return { id: where.id };
      },
      create: async ({ data }) => {
        jobCreateCounter += 1;
        const id = `child-job-${jobCreateCounter}`;
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
    tokenUsage: {
      findMany: async () => [],
    },
    noteAccount: {
      findUnique: async ({ where }) => args.accounts.find((a) => a.id === where.id) ?? null,
    },
    noteTheme: {
      findUnique: async ({ where }) => (args.themes ?? []).find((t) => t.id === where.id) ?? null,
    },
  };

  return { prisma, articleUpdates, jobCreates, jobUpdates };
}

const SAMPLE_OUTLINE: NoteOutlineOutput = {
  lead: 'リード文サンプル',
  headings: ['見出し1', '見出し2'],
};

describe('pipeline.note.writer.outline', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    const addJob: AddJobLike = vi.fn();
    await expect(runPipelineNoteWriterOutline({}, addJob)).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], articles: [], accounts: [] });
    const addJob: AddJobLike = vi.fn();
    await expect(
      runPipelineNoteWriterOutline(
        { note_article_id: 'art1', job_id: 'job1' },
        addJob,
        { prisma, logger: makeLogger() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('Job 既に done なら skip', async () => {
    const { prisma, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'done' }],
      articles: [],
      accounts: [],
    });
    const addJob: AddJobLike = vi.fn();
    await runPipelineNoteWriterOutline(
      { note_article_id: 'art1', job_id: 'job1' },
      addJob,
      { prisma, logger: makeLogger() },
    );
    expect(jobCreates).toHaveLength(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('NoteLock 競合時は ConflictError を透過し Job=failed', async () => {
    const { prisma, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ id: 'art1', note_account_id: 'acc1', theme_id: null, title: 'T', paid: false }],
      accounts: [{ id: 'acc1', niche: 'n', target_reader: null, tone: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const acquireLock = vi.fn().mockRejectedValue(new ConflictError('locked'));
    await expect(
      runPipelineNoteWriterOutline(
        { note_article_id: 'art1', job_id: 'job1' },
        addJob,
        { prisma, logger: makeLogger(), acquireLock, releaseLock: vi.fn() },
      ),
    ).rejects.toThrow(ConflictError);
    expect(jobUpdates.some((u) => u.data.status === 'failed')).toBe(true);
  });

  it('正常系: NoteArticle.lead 更新 + writer.body enqueue + Job done', async () => {
    const { prisma, articleUpdates, jobCreates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [{ id: 'art1', note_account_id: 'acc1', theme_id: 'theme1', title: 'タイトル', paid: true }],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: '会社員', tone: '丁寧' }],
      themes: [{ id: 'theme1', hook: 'フック', target_reader: '会社員' }],
    });
    const addJob: AddJobLike = vi.fn();
    const generateOutline = vi.fn().mockResolvedValue(SAMPLE_OUTLINE);

    await runPipelineNoteWriterOutline(
      { note_article_id: 'art1', job_id: 'job1' },
      addJob,
      {
        prisma,
        logger: makeLogger(),
        generateOutline,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(generateOutline).toHaveBeenCalledWith(
      expect.objectContaining({ note_article_id: 'art1', paid: true }),
    );
    expect(articleUpdates[0]!.data).toMatchObject({ lead: 'リード文サンプル', status: 'writing' });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_WRITER_BODY_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_WRITER_BODY_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1', headings: SAMPLE_OUTLINE.headings }),
      { maxAttempts: 3 },
    );
    expect(jobUpdates.some((u) => u.data.status === 'done')).toBe(true);
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME).toBe('pipeline.note.writer.outline');
  });
});
