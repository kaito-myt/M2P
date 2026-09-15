import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteWriterOutput } from '@a2p/contracts/agents/anp';

import {
  PIPELINE_NOTE_WRITER_BODY_TASK_NAME,
  runPipelineNoteWriterBody,
  type AddJobLike,
  type PipelineNoteWriterBodyPrisma,
} from '../src/tasks/pipeline-note-writer-body.js';
import { PIPELINE_NOTE_EDITOR_TASK_NAME } from '../src/tasks/pipeline-note-editor.js';

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
  price_jpy: number | null;
}
interface AccountRecord {
  id: string;
  niche: string;
  target_reader: string | null;
  tone: string | null;
  monetization_policy_json: unknown;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  articles: ArticleRecord[];
  accounts: AccountRecord[];
}) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  let counter = 0;

  const prisma: PipelineNoteWriterBodyPrisma = {
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
    noteTheme: { findUnique: async () => null },
    book: { findMany: async () => [] },
  };

  return { prisma, articleUpdates, jobCreates };
}

const SAMPLE_BODY: NoteWriterOutput = {
  body_md: '## 見出し1\n本文です。'.padEnd(300, 'あ'),
  char_count: 300,
  paywall_line_pos: 100,
};

describe('pipeline.note.writer.body', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    const addJob: AddJobLike = vi.fn();
    await expect(runPipelineNoteWriterBody({}, addJob)).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], articles: [], accounts: [] });
    const addJob: AddJobLike = vi.fn();
    await expect(
      runPipelineNoteWriterBody(
        { note_article_id: 'art1', job_id: 'job1', lead: 'l', headings: ['h1'] },
        addJob,
        { prisma, logger: makeLogger() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('正常系: body_md/paywall_line_pos 更新 + editor enqueue', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        { id: 'art1', note_account_id: 'acc1', theme_id: null, title: 'T', paid: true, price_jpy: 300 },
      ],
      accounts: [
        {
          id: 'acc1',
          niche: '副業',
          target_reader: null,
          tone: null,
          monetization_policy_json: { free_ratio: 0.4 },
        },
      ],
    });
    const addJob: AddJobLike = vi.fn();
    const generateBody = vi.fn().mockResolvedValue(SAMPLE_BODY);

    await runPipelineNoteWriterBody(
      { note_article_id: 'art1', job_id: 'job1', lead: 'リード', headings: ['見出し1'] },
      addJob,
      {
        prisma,
        logger: makeLogger(),
        generateBody,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(generateBody).toHaveBeenCalledWith(
      expect.objectContaining({ free_ratio: 0.4, paid: true, price_jpy: 300 }),
    );
    expect(articleUpdates[0]!.data).toMatchObject({
      body_md: SAMPLE_BODY.body_md,
      paywall_line_pos: 100,
      status: 'editing',
    });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_EDITOR_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_EDITOR_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1' }),
      { maxAttempts: 3 },
    );
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_WRITER_BODY_TASK_NAME).toBe('pipeline.note.writer.body');
  });
});
