import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteAccountDesign } from '@a2p/contracts/agents/anp';

import {
  NOTE_ACCOUNT_DESIGN_TASK_NAME,
  runNoteAccountDesign,
  type NoteAccountDesignDeps,
  type NoteAccountDesignPrisma,
} from '../src/tasks/note-account-design.js';

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
interface DesignRecord {
  id: string;
  brief_json: unknown;
}

function buildPrisma(args: { jobs: JobRecord[]; designs: DesignRecord[] }) {
  const jobs = [...args.jobs];
  const designUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  const prisma: NoteAccountDesignPrisma = {
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
    },
    noteAccountDesign: {
      findUnique: async ({ where }) => args.designs.find((d) => d.id === where.id) ?? null,
      update: async ({ where, data }) => {
        designUpdates.push({ where, data: data as Record<string, unknown> });
        return { id: where.id };
      },
    },
  };

  return { prisma, designUpdates, jobUpdates };
}

const SAMPLE_DESIGN: NoteAccountDesign = {
  display_name_candidates: ['副業AIラボ'],
  handle_candidates: ['ai_fukugyo_lab'],
  bio: 'bio',
  concept: 'concept',
  target_reader: '会社員',
  tone: '親しみやすい',
  persona_type: 'person',
  character_sheet: null,
  content_pillars: [{ name: 'p', description: 'd', example_titles: [] }],
  genre_policy: ['side_business'],
  monetization_policy: { free_ratio: 0.3, price_band: [300, 1000], membership: false, paid_line_strategy: 's' },
  posting_cadence: { times_per_week: 3, time_of_day: '21:00' },
  first_themes: [{ title: 't', hook: 'h' }],
  kpi_targets: { followers_30d: 100, articles_30d: 12, revenue_90d_jpy: 30000 },
  avatar_prompt: 'a',
  header_prompt: 'b',
};

describe('note.account.design', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runNoteAccountDesign({})).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], designs: [] });
    await expect(
      runNoteAccountDesign({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() }),
    ).rejects.toThrow(NotFoundError);
  });

  it('Job が既に done なら skip', async () => {
    const { prisma, designUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'done' }],
      designs: [{ id: 'd1', brief_json: { idea: 'AI副業' } }],
    });
    await runNoteAccountDesign({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() });
    expect(designUpdates).toHaveLength(0);
  });

  it('NoteAccountDesign 不在で NotFoundError + Job/Design failed', async () => {
    const { prisma, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [],
    });
    await expect(
      runNoteAccountDesign({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() }),
    ).rejects.toThrow(NotFoundError);
    expect(jobUpdates.some((u) => u.data.status === 'failed')).toBe(true);
  });

  it('正常系: design_json が保存され status=proposed、Job が done になる', async () => {
    const { prisma, designUpdates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [{ id: 'd1', brief_json: { idea: 'AI副業' } }],
    });
    const planDesign = vi.fn().mockResolvedValue(SAMPLE_DESIGN);
    const deps: NoteAccountDesignDeps = { prisma, logger: makeLogger(), planDesign };

    await runNoteAccountDesign({ design_id: 'd1', job_id: 'job1' }, deps);

    expect(planDesign).toHaveBeenCalledWith(expect.objectContaining({ idea: 'AI副業' }));
    const proposedUpdate = designUpdates.find((u) => u.data.status === 'proposed');
    expect(proposedUpdate).toBeDefined();
    expect((proposedUpdate!.data.design_json as NoteAccountDesign).bio).toBe('bio');
    const doneUpdate = jobUpdates.find((u) => u.data.status === 'done');
    expect(doneUpdate).toBeDefined();
  });

  it('planDesign が例外を投げたら NoteAccountDesign.status=failed + Job failed', async () => {
    const { prisma, designUpdates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [{ id: 'd1', brief_json: { idea: 'AI副業' } }],
    });
    const planDesign = vi.fn().mockRejectedValue(new Error('llm down'));
    const deps: NoteAccountDesignDeps = { prisma, logger: makeLogger(), planDesign };

    await expect(runNoteAccountDesign({ design_id: 'd1', job_id: 'job1' }, deps)).rejects.toThrow('llm down');

    const failedDesignUpdate = designUpdates.find((u) => u.data.status === 'failed');
    expect(failedDesignUpdate).toBeDefined();
    expect(String(failedDesignUpdate!.data.error)).toContain('llm down');
    expect(jobUpdates.some((u) => u.data.status === 'failed')).toBe(true);
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_ACCOUNT_DESIGN_TASK_NAME).toBe('note.account.design');
  });
});
