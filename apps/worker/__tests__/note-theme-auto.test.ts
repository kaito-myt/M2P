import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';
import type { NoteThemeOutput } from '@a2p/contracts/agents/anp';

import {
  NOTE_THEME_AUTO_TASK_NAME,
  runNoteThemeAuto,
  type AddJobLike,
  type NoteThemeAutoPrisma,
} from '../src/tasks/note-theme-auto.js';
import { PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME } from '../src/tasks/pipeline-note-writer-outline.js';

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

interface AccountRow {
  id: string;
  niche: string;
  target_reader: string | null;
  tone: string | null;
  settings_json?: unknown;
}

function buildPrisma(args: {
  appSettings?: Record<string, unknown> | null;
  accounts: AccountRow[];
}) {
  const captures = {
    jobCreates: [] as Array<Record<string, unknown>>,
    jobUpdates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
    themeCreates: [] as Array<Record<string, unknown>>,
    themeUpdateManys: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
    articleCreates: [] as Array<Record<string, unknown>>,
  };
  let jobCounter = 0;
  let themeCounter = 0;
  let articleCounter = 0;

  const prisma: NoteThemeAutoPrisma = {
    appSettings: {
      findUnique: async () => (args.appSettings === undefined ? {} : args.appSettings),
    },
    noteAccount: {
      findMany: async () => args.accounts,
    },
    noteTheme: {
      findMany: async () => [],
      create: async ({ data }) => {
        themeCounter += 1;
        const id = `theme_${themeCounter}`;
        captures.themeCreates.push({ id, ...data });
        return {
          id,
          note_account_id: data.note_account_id,
          title: data.title,
          recommend_paid: data.recommend_paid,
          suggested_price: data.suggested_price,
        };
      },
      updateMany: async ({ where, data }) => {
        captures.themeUpdateManys.push({ where, data });
        return { count: 1 };
      },
    },
    noteArticle: {
      create: async ({ data }) => {
        articleCounter += 1;
        const id = `article_${articleCounter}`;
        captures.articleCreates.push({ id, ...data });
        return { id };
      },
    },
    job: {
      create: async ({ data }) => {
        jobCounter += 1;
        const id = `job_${jobCounter}`;
        captures.jobCreates.push({ id, ...data });
        return { id };
      },
      update: async ({ where, data }) => {
        captures.jobUpdates.push({ where, data });
        return {};
      },
    },
  };

  return { prisma, captures };
}

function makeCandidates(n: number, overrides: Partial<NoteThemeOutput['candidates'][number]> = {}): NoteThemeOutput {
  return {
    candidates: Array.from({ length: n }, (_, i) => ({
      title: `自動生成テーマ${i + 1}`,
      hook: `フック${i + 1}`,
      target_reader: '読者層',
      recommend_paid: false,
      genre: 'business',
      ...overrides,
    })),
  };
}

describe('note.theme.auto task name', () => {
  it('task identifier は note.theme.auto', () => {
    expect(NOTE_THEME_AUTO_TASK_NAME).toBe('note.theme.auto');
  });
});

describe('runNoteThemeAuto — anp_auto_theme_enabled OFF (既定)', () => {
  it('OFF: 何もせず enabled=false を返す (account 照会もしない)', async () => {
    const { prisma, captures } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: false },
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: null, tone: null }],
    });
    const findManySpy = vi.spyOn(prisma.noteAccount, 'findMany');

    const result = await runNoteThemeAuto({ prisma, logger: makeLogger() });

    expect(result).toEqual({
      enabled: false,
      accounts_processed: 0,
      themes_generated: 0,
      articles_created: 0,
      accounts: [],
    });
    expect(findManySpy).not.toHaveBeenCalled();
    expect(captures.jobCreates).toHaveLength(0);
  });
});

describe('runNoteThemeAuto — anp_auto_theme_enabled ON, anp_autopass_enabled OFF', () => {
  it('テーマ生成のみ行い、自動採用/パイプライン起動はしない', async () => {
    const { prisma, captures } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_themes_per_day: 2, anp_autopass_enabled: false },
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: '会社員', tone: null }],
    });
    const generateThemes = vi.fn(async () => makeCandidates(2));

    const result = await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes });

    expect(generateThemes).toHaveBeenCalledOnce();
    expect(captures.themeCreates).toHaveLength(2);
    expect(captures.themeUpdateManys).toHaveLength(0);
    expect(captures.articleCreates).toHaveLength(0);
    expect(result).toEqual({
      enabled: true,
      accounts_processed: 1,
      themes_generated: 2,
      articles_created: 0,
      accounts: [{ note_account_id: 'acc1', generated: 2, accepted: 0 }],
    });
    const doneUpdate = captures.jobUpdates.find((u) => u.data.status === 'done');
    expect(doneUpdate).toBeDefined();
  });

  it('addJob 未注入でも autopass OFF なら throw しない', async () => {
    const { prisma } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_autopass_enabled: false },
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: null, tone: null }],
    });
    const generateThemes = vi.fn(async () => makeCandidates(1));

    await expect(runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes })).resolves.toBeDefined();
  });
});

describe('runNoteThemeAuto — anp_autopass_enabled ON', () => {
  it('addJob 未注入なら throw', async () => {
    const { prisma } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_autopass_enabled: true },
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: null, tone: null }],
    });
    await expect(runNoteThemeAuto({ prisma, logger: makeLogger() })).rejects.toThrow();
  });

  it('生成したテーマを自動採用し NoteArticle 作成 + pipeline.note.writer.outline を enqueue する', async () => {
    const { prisma, captures } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_themes_per_day: 2, anp_autopass_enabled: true },
      accounts: [{ id: 'acc1', niche: 'AI副業', target_reader: '会社員', tone: null }],
    });
    const generateThemes = vi.fn(async () => makeCandidates(2, { recommend_paid: true, suggested_price: 300 }));
    const addJob: AddJobLike = vi.fn();

    const result = await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes, addJob });

    expect(captures.themeCreates).toHaveLength(2);
    expect(captures.themeUpdateManys).toHaveLength(2);
    expect(captures.articleCreates).toHaveLength(2);
    captures.articleCreates.forEach((a) => {
      expect(a).toMatchObject({ note_account_id: 'acc1', paid: true, price_jpy: 300, status: 'queued' });
    });
    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
      expect.objectContaining({ note_article_id: expect.stringContaining('article_') }),
      { maxAttempts: 3 },
    );
    expect(result).toEqual({
      enabled: true,
      accounts_processed: 1,
      themes_generated: 2,
      articles_created: 2,
      accounts: [{ note_account_id: 'acc1', generated: 2, accepted: 2 }],
    });
  });

  it('複数アカウントを処理し、1アカウントの失敗が他アカウントを止めない', async () => {
    const { prisma, captures } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_themes_per_day: 1, anp_autopass_enabled: true },
      accounts: [
        { id: 'acc_fail', niche: '失敗ニッチ', target_reader: null, tone: null },
        { id: 'acc_ok', niche: 'OKニッチ', target_reader: null, tone: null },
      ],
    });
    const generateThemes = vi.fn(async (input) => {
      if (input.note_account_id === 'acc_fail') throw new Error('marketer boom');
      return makeCandidates(1);
    });
    const addJob: AddJobLike = vi.fn();

    const result = await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes, addJob });

    expect(result.accounts_processed).toBe(2);
    expect(result.themes_generated).toBe(1);
    expect(result.articles_created).toBe(1);
    const failResult = result.accounts.find((a) => a.note_account_id === 'acc_fail');
    expect(failResult?.error).toBeDefined();
    const okResult = result.accounts.find((a) => a.note_account_id === 'acc_ok');
    expect(okResult).toEqual({ note_account_id: 'acc_ok', generated: 1, accepted: 1 });
    // 失敗アカウント分の Job は failed に降格される
    const failedJobUpdate = captures.jobUpdates.find((u) => u.data.status === 'failed');
    expect(failedJobUpdate).toBeDefined();
  });

  it('F-ANP-17: アカウント別 settings_json.auto_theme_enabled=false のアカウントはスキップする', async () => {
    const { prisma, captures } = buildPrisma({
      appSettings: { anp_auto_theme_enabled: true, anp_themes_per_day: 1, anp_autopass_enabled: true },
      accounts: [
        { id: 'acc_off', niche: 'オフ', target_reader: null, tone: null, settings_json: { auto_theme_enabled: false } },
        { id: 'acc_on', niche: 'オン', target_reader: null, tone: null },
      ],
    });
    const generateThemes = vi.fn(async () => makeCandidates(1));
    const addJob: AddJobLike = vi.fn();

    const result = await runNoteThemeAuto({ prisma, logger: makeLogger(), generateThemes, addJob });

    expect(generateThemes).toHaveBeenCalledOnce();
    expect(generateThemes).toHaveBeenCalledWith(expect.objectContaining({ note_account_id: 'acc_on' }));
    expect(result.accounts_processed).toBe(2);
    expect(result.accounts).toContainEqual({ note_account_id: 'acc_off', generated: 0, accepted: 0 });
    const onResult = result.accounts.find((a) => a.note_account_id === 'acc_on');
    expect(onResult).toEqual({ note_account_id: 'acc_on', generated: 1, accepted: 1 });
    // acc_off 分は job.create 自体が呼ばれない(スキップ)。acc_on 分のみ (テーマ生成Job + outline Job = 2件)。
    expect(captures.jobCreates).toHaveLength(2);
  });
});
