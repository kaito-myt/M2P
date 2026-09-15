import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { EditNoteArticleResult } from '@a2p/agents/anp/editor';

import {
  PIPELINE_NOTE_EDITOR_TASK_NAME,
  runPipelineNoteEditor,
  type AddJobLike,
  type PipelineNoteEditorPrisma,
} from '../src/tasks/pipeline-note-editor.js';
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
  lead: string | null;
  body_md: string | null;
  paid: boolean;
  paywall_line_pos: number | null;
}
interface AccountRecord {
  id: string;
  niche: string;
  tone: string | null;
  target_reader: string | null;
}

function buildPrisma(args: { jobs: JobRecord[]; articles: ArticleRecord[]; accounts: AccountRecord[] }) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  let counter = 0;

  const prisma: PipelineNoteEditorPrisma = {
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
  };

  return { prisma, articleUpdates, jobCreates };
}

const SAMPLE_EDITED: EditNoteArticleResult = {
  lead: '校閲後リード',
  body_md: '校閲後本文'.padEnd(300, 'あ'),
  paywall_line_pos: 150,
};

describe('pipeline.note.editor', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    const addJob: AddJobLike = vi.fn();
    await expect(runPipelineNoteEditor({}, addJob)).rejects.toThrow(ValidationError);
  });

  it('body_md/lead 未確定なら NotFoundError', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        { id: 'art1', note_account_id: 'acc1', title: 'T', lead: null, body_md: null, paid: false, paywall_line_pos: null },
      ],
      accounts: [{ id: 'acc1', niche: 'n', tone: null, target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    await expect(
      runPipelineNoteEditor(
        { note_article_id: 'art1', job_id: 'job1' },
        addJob,
        { prisma, logger: makeLogger(), acquireLock: vi.fn(), releaseLock: vi.fn() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('正常系: lead/body_md/paywall_line_pos 更新 + eyecatch enqueue', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        {
          id: 'art1',
          note_account_id: 'acc1',
          title: 'T',
          lead: '元リード',
          body_md: '元本文'.padEnd(300, 'い'),
          paid: true,
          paywall_line_pos: 100,
        },
      ],
      accounts: [{ id: 'acc1', niche: '副業', tone: '丁寧', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const editArticle = vi.fn().mockResolvedValue(SAMPLE_EDITED);

    await runPipelineNoteEditor(
      { note_article_id: 'art1', job_id: 'job1', feedback: ['直してください'] },
      addJob,
      {
        prisma,
        logger: makeLogger(),
        editArticle,
        acquireLock: vi.fn().mockResolvedValue(undefined),
        releaseLock: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(editArticle).toHaveBeenCalledWith(
      expect.objectContaining({ paywall_line_pos: 100, feedback: ['直してください'] }),
    );
    expect(articleUpdates[0]!.data).toMatchObject({
      lead: '校閲後リード',
      paywall_line_pos: 150,
      status: 'eyecatch',
    });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_EYECATCH_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_EYECATCH_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1' }),
      { maxAttempts: 3 },
    );
  });

  it('paid=true で editArticle が paywall_line_pos を返さない場合は ValidationError (フォールバック禁止)', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [
        {
          id: 'art1',
          note_account_id: 'acc1',
          title: 'T',
          lead: '元リード',
          body_md: '元本文'.padEnd(300, 'い'),
          paid: true,
          paywall_line_pos: 100,
        },
      ],
      accounts: [{ id: 'acc1', niche: '副業', tone: '丁寧', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const editArticle = vi.fn().mockResolvedValue({
      lead: '校閲後リード',
      body_md: '校閲後本文'.padEnd(300, 'あ'),
      // paywall_line_pos が無い (契約違反)
    } as EditNoteArticleResult);

    await expect(
      runPipelineNoteEditor(
        { note_article_id: 'art1', job_id: 'job1' },
        addJob,
        {
          prisma,
          logger: makeLogger(),
          editArticle,
          acquireLock: vi.fn().mockResolvedValue(undefined),
          releaseLock: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow(ValidationError);

    // NoteArticle.update は呼ばれない (古い paywall_line_pos へのフォールバックをしない)
    expect(articleUpdates).toHaveLength(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_EDITOR_TASK_NAME).toBe('pipeline.note.editor');
  });
});
