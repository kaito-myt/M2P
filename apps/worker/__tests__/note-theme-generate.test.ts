import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteThemeOutput } from '@a2p/contracts/agents/anp';

import {
  NOTE_THEME_GENERATE_TASK_NAME,
  runNoteThemeGenerate,
  type NoteThemeGenerateDeps,
  type NoteThemeGeneratePrisma,
} from '../src/tasks/note-theme-generate.js';

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  return logger;
}

interface JobRecord {
  id: string;
  status: string;
}
interface AccountRecord {
  id: string;
  niche: string;
  target_reader: string | null;
  tone: string | null;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  accounts: AccountRecord[];
}): {
  prisma: NoteThemeGeneratePrisma;
  createManyCalls: Array<{ data: unknown[] }>;
  jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
} {
  const jobs = [...args.jobs];
  const createManyCalls: Array<{ data: unknown[] }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  const prisma: NoteThemeGeneratePrisma = {
    job: {
      findUnique: async ({ where }) => {
        const j = jobs.find((x) => x.id === where.id);
        return j ? { status: j.status } : null;
      },
      updateMany: async ({ where, data }) => {
        const matched = jobs.filter(
          (j) => j.id === where.id && where.status.in.includes(j.status),
        );
        for (const j of matched) j.status = data.status;
        return { count: matched.length };
      },
      update: async ({ where, data }) => {
        jobUpdates.push({ where, data: data as Record<string, unknown> });
        const j = jobs.find((x) => x.id === where.id);
        if (j && data.status) j.status = data.status;
        return { id: where.id };
      },
    },
    noteAccount: {
      findUnique: async ({ where }) => args.accounts.find((a) => a.id === where.id) ?? null,
    },
    noteTheme: {
      findMany: async () => [],
      createMany: async (createArgs) => {
        createManyCalls.push(createArgs);
        return { count: createArgs.data.length };
      },
    },
  };

  return { prisma, createManyCalls, jobUpdates };
}

const SAMPLE_OUTPUT: NoteThemeOutput = {
  candidates: [
    {
      title: '副業AI活用術',
      hook: '初心者でも今日から始められる',
      target_reader: '副業初心者',
      recommend_paid: true,
      suggested_price: 300,
      competitors: [],
      genre: 'business',
    },
  ],
};

describe('note.theme.generate', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runNoteThemeGenerate({})).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], accounts: [] });
    await expect(
      runNoteThemeGenerate(
        { note_account_id: 'acc1', job_id: 'job1', count: 5 },
        { prisma, logger: makeLogger() },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('Job が既に done なら skip', async () => {
    const { prisma, createManyCalls } = buildPrisma({
      jobs: [{ id: 'job1', status: 'done' }],
      accounts: [{ id: 'acc1', niche: 'AI', target_reader: null, tone: null }],
    });
    await runNoteThemeGenerate(
      { note_account_id: 'acc1', job_id: 'job1', count: 5 },
      { prisma, logger: makeLogger() },
    );
    expect(createManyCalls).toHaveLength(0);
  });

  it('NoteAccount 不在で NotFoundError + Job failed', async () => {
    const { prisma, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [],
    });
    await expect(
      runNoteThemeGenerate(
        { note_account_id: 'acc1', job_id: 'job1', count: 5 },
        { prisma, logger: makeLogger() },
      ),
    ).rejects.toThrow(NotFoundError);
    expect(jobUpdates.some((u) => u.data.status === 'failed')).toBe(true);
  });

  it('正常系: NoteTheme が createMany され Job が done になる', async () => {
    const { prisma, createManyCalls, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: '会社員', tone: 'カジュアル' }],
    });
    const generateThemes = vi.fn().mockResolvedValue(SAMPLE_OUTPUT);
    const deps: NoteThemeGenerateDeps = { prisma, logger: makeLogger(), generateThemes };

    await runNoteThemeGenerate({ note_account_id: 'acc1', job_id: 'job1', count: 1 }, deps);

    expect(generateThemes).toHaveBeenCalledWith(
      expect.objectContaining({
        note_account_id: 'acc1',
        job_id: 'job1',
        account: { niche: 'AI副業', target_reader: '会社員', tone: 'カジュアル', editorial_policy: null },
      }),
    );
    expect(createManyCalls).toHaveLength(1);
    expect(createManyCalls[0]!.data).toHaveLength(1);
    const doneUpdate = jobUpdates.find((u) => u.data.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect((doneUpdate!.data.result_json as { candidate_count: number }).candidate_count).toBe(1);
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_THEME_GENERATE_TASK_NAME).toBe('note.theme.generate');
  });
});
