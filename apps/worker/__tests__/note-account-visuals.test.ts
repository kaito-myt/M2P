import { describe, expect, it, vi } from 'vitest';

import { ConfigError, NotFoundError, ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteAccountDesign } from '@a2p/contracts/agents/anp';
import type { NoteAccountDesignImages } from '@a2p/agents/anp/strategist';

import {
  NOTE_ACCOUNT_VISUALS_TASK_NAME,
  runNoteAccountVisuals,
  type NoteAccountVisualsDeps,
  type NoteAccountVisualsPrisma,
} from '../src/tasks/note-account-visuals.js';

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
  design_json: unknown;
}

function buildPrisma(args: { jobs: JobRecord[]; designs: DesignRecord[] }) {
  const jobs = [...args.jobs];
  const designUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  const prisma: NoteAccountVisualsPrisma = {
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

const SAMPLE_IMAGES: NoteAccountDesignImages = {
  avatar: Buffer.from('avatar'),
  header: Buffer.from('header'),
};

describe('note.account.visuals', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    await expect(runNoteAccountVisuals({})).rejects.toThrow(ValidationError);
  });

  it('Job 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [], designs: [] });
    await expect(
      runNoteAccountVisuals({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() }),
    ).rejects.toThrow(NotFoundError);
  });

  it('NoteAccountDesign 不在で NotFoundError', async () => {
    const { prisma } = buildPrisma({ jobs: [{ id: 'job1', status: 'queued' }], designs: [] });
    await expect(
      runNoteAccountVisuals({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() }),
    ).rejects.toThrow(NotFoundError);
  });

  it('design_json 未確定なら ConfigError', async () => {
    const { prisma } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [{ id: 'd1', design_json: null }],
    });
    await expect(
      runNoteAccountVisuals({ design_id: 'd1', job_id: 'job1' }, { prisma, logger: makeLogger() }),
    ).rejects.toThrow(ConfigError);
  });

  it('正常系: R2 にアップロードし avatar_r2_key/header_r2_key を保存、Job が done になる', async () => {
    const { prisma, designUpdates, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [{ id: 'd1', design_json: SAMPLE_DESIGN }],
    });
    const generateImages = vi.fn().mockResolvedValue(SAMPLE_IMAGES);
    const uploadBuffer = vi.fn().mockResolvedValue({ key: 'x' });
    const deps: NoteAccountVisualsDeps = { prisma, logger: makeLogger(), generateImages, uploadBuffer };

    await runNoteAccountVisuals({ design_id: 'd1', job_id: 'job1' }, deps);

    expect(generateImages).toHaveBeenCalledWith(expect.objectContaining({ persona_type: 'person' }));
    expect(uploadBuffer).toHaveBeenCalledTimes(2);
    expect(uploadBuffer).toHaveBeenCalledWith('anp/designs/d1/avatar.png', SAMPLE_IMAGES.avatar, 'image/png');
    expect(uploadBuffer).toHaveBeenCalledWith('anp/designs/d1/header.jpg', SAMPLE_IMAGES.header, 'image/jpeg');
    const update = designUpdates.find((u) => u.data.avatar_r2_key);
    expect(update).toBeDefined();
    expect(update!.data.header_r2_key).toBe('anp/designs/d1/header.jpg');
    expect(jobUpdates.some((u) => u.data.status === 'done')).toBe(true);
  });

  it('generateImages が例外を投げたら Job failed', async () => {
    const { prisma, jobUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      designs: [{ id: 'd1', design_json: SAMPLE_DESIGN }],
    });
    const generateImages = vi.fn().mockRejectedValue(new Error('image gen failed'));
    const deps: NoteAccountVisualsDeps = { prisma, logger: makeLogger(), generateImages };

    await expect(runNoteAccountVisuals({ design_id: 'd1', job_id: 'job1' }, deps)).rejects.toThrow(
      'image gen failed',
    );
    expect(jobUpdates.some((u) => u.data.status === 'failed')).toBe(true);
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(NOTE_ACCOUNT_VISUALS_TASK_NAME).toBe('note.account.visuals');
  });
});
