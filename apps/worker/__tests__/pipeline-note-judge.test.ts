import { describe, expect, it, vi } from 'vitest';

import { ValidationError } from '@a2p/contracts/errors';
import type { Logger } from '@a2p/contracts/logger';
import type { NoteJudgeOutput } from '@a2p/contracts/agents/anp';

import {
  PIPELINE_NOTE_JUDGE_TASK_NAME,
  resolveFinalPricing,
  runPipelineNoteJudge,
  type AddJobLike,
  type PipelineNoteJudgePrisma,
} from '../src/tasks/pipeline-note-judge.js';
import { PIPELINE_NOTE_EDITOR_TASK_NAME } from '../src/tasks/pipeline-note-editor.js';
import { PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME } from '../src/tasks/pipeline-note-writer-outline.js';

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
  price_jpy: number | null;
  paywall_line_pos: number | null;
}

function buildPrisma(args: {
  jobs: JobRecord[];
  articles: ArticleRecord[];
  accounts: Array<{ id: string; niche: string; target_reader: string | null; settings_json?: unknown }>;
}) {
  const jobs = [...args.jobs];
  const articleUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  let counter = 0;

  const prisma: PipelineNoteJudgePrisma = {
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

function makeArticle(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    id: 'art1',
    note_account_id: 'acc1',
    title: 'タイトル',
    lead: 'リード',
    body_md: '本文'.padEnd(300, 'あ'),
    paid: false,
    price_jpy: null,
    paywall_line_pos: null,
    ...overrides,
  };
}

const PASS_OUTPUT: NoteJudgeOutput = {
  score_total: 90,
  score_breakdown: { hook_strength: 90, readability: 90, paid_conversion: 90, search_inflow: 90 },
  judge_comments: {},
};

const FAIL_OUTPUT: NoteJudgeOutput = {
  score_total: 50,
  score_breakdown: { hook_strength: 50, readability: 50, paid_conversion: 50, search_inflow: 50 },
  judge_comments: { hook_strength: '弱い' },
};

describe('pipeline.note.judge', () => {
  it('payload zod 検証エラーで ValidationError', async () => {
    const addJob: AddJobLike = vi.fn();
    await expect(runPipelineNoteJudge({}, addJob)).rejects.toThrow(ValidationError);
  });

  it('合格 (>=80) — NoteArticle.status=ready', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle()],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue(PASS_OUTPUT);

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({ status: 'ready', quality_score: 90 });
    expect(jobCreates).toHaveLength(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('F-ANP-16: 有料公開が許可されていないアカウントでは paid=false に落とし、price_jpy に提案価格だけ残す', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle({ paid: true, price_jpy: 300, paywall_line_pos: 120 })],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi
      .fn()
      .mockResolvedValue({ ...PASS_OUTPUT, recommend_paid: true, suggested_price_jpy: 500 });

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({
      status: 'ready',
      paid: false,
      price_jpy: 500,
      paywall_line_pos: null,
    });
  });

  it('F-ANP-16b: paid_publish_enabled のアカウントでは paid=true のまま有料ラインを保持する', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle({ paid: true, price_jpy: 300, paywall_line_pos: 120 })],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null, settings_json: { paid_publish_enabled: true } }],
    });
    const judgeArticle = vi.fn().mockResolvedValue({ ...PASS_OUTPUT, recommend_paid: true, suggested_price_jpy: 500 });
    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      vi.fn() as unknown as AddJobLike,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );
    expect(articleUpdates[0]!.data).toMatchObject({ status: 'ready', paid: true, price_jpy: 500, paywall_line_pos: 120 });
  });

  it('F-ANP-16b: 許可済みでも有料ラインが無ければ paid=false に落とす (有料本文の欠落防止)', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle({ paid: true, price_jpy: 300, paywall_line_pos: null })],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null, settings_json: { paid_publish_enabled: true } }],
    });
    const judgeArticle = vi.fn().mockResolvedValue({ ...PASS_OUTPUT, recommend_paid: true, suggested_price_jpy: 500 });
    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      vi.fn() as unknown as AddJobLike,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );
    expect(articleUpdates[0]!.data).toMatchObject({ status: 'ready', paid: false, price_jpy: 500 });
  });

  it('F-ANP-45: 企画時に有料の記事は judge が無料を勧めても有料のまま (ただし有料ラインが無いので価格だけ残る)', async () => {
    const { prisma, articleUpdates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle({ paid: true, price_jpy: 300 })],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue({ ...PASS_OUTPUT, recommend_paid: false });

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    // 有料ラインが無い記事なので paid にはできないが、**価格の提案は消さない**
    // (judge の格下げで price_jpy まで消えると、後から有料化する手がかりが失われる)。
    expect(articleUpdates[0]!.data).toMatchObject({ status: 'ready', paid: false, price_jpy: 300 });
  });

  it('低スコア (69 以下) + retry_count=0 — 構成 (writer.outline) からやり直し (F-ANP-44)', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle()],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue(FAIL_OUTPUT);

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({ status: 'writing', quality_score: 50 });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME });
    expect((jobCreates[0]!.data.payload_json as { retry_count: number }).retry_count).toBe(1);
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1', retry_count: 1 }),
      { maxAttempts: 2 },
    );
  });

  it('中間スコア (70〜84) — 校閲 (editor) へ差し戻し (F-ANP-44)', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle()],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue({ ...FAIL_OUTPUT, score_total: 78 });

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 0 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({ status: 'editing', quality_score: 78 });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_EDITOR_TASK_NAME });
    expect(addJob).toHaveBeenCalledWith(
      PIPELINE_NOTE_EDITOR_TASK_NAME,
      expect.objectContaining({ note_article_id: 'art1', retry_count: 1 }),
      { maxAttempts: 2 },
    );
  });

  it('不合格 + retry_count=1 — まだ自動で直す (2026-09-25: 自動リトライ 2 回)', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle()],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue({ ...FAIL_OUTPUT, score_total: 78 });

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 1 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({ status: 'editing' });
    expect(jobCreates[0]!.data).toMatchObject({ kind: PIPELINE_NOTE_EDITOR_TASK_NAME });
    expect((jobCreates[0]!.data.payload_json as { retry_count: number }).retry_count).toBe(2);
  });

  it('不合格 + retry_count=2 (上限到達) — needs_human_review', async () => {
    const { prisma, articleUpdates, jobCreates } = buildPrisma({
      jobs: [{ id: 'job1', status: 'queued' }],
      articles: [makeArticle()],
      accounts: [{ id: 'acc1', niche: '副業', target_reader: null }],
    });
    const addJob: AddJobLike = vi.fn();
    const judgeArticle = vi.fn().mockResolvedValue(FAIL_OUTPUT);

    await runPipelineNoteJudge(
      { note_article_id: 'art1', job_id: 'job1', retry_count: 2 },
      addJob,
      { prisma, logger: makeLogger(), judgeArticle, acquireLock: vi.fn().mockResolvedValue(undefined), releaseLock: vi.fn().mockResolvedValue(undefined) },
    );

    expect(articleUpdates[0]!.data).toMatchObject({
      status: 'needs_human_review',
      quality_score: 50,
      paid: false,
      paywall_line_pos: null,
    });
    expect(jobCreates).toHaveLength(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  it('タスク名が docs/11 §7 と一致する', () => {
    expect(PIPELINE_NOTE_JUDGE_TASK_NAME).toBe('pipeline.note.judge');
  });
});

describe('resolveFinalPricing (F-ANP-45: judge に有料→無料の格下げをさせない)', () => {
  const judgedFree = { recommend_paid: false, suggested_price_jpy: null } as never;
  const judgedSilent = {} as never;

  it('企画時に有料なら judge が false でも有料のまま', () => {
    const r = resolveFinalPricing({ paid: true, price_jpy: 500, paywall_line_pos: 1200 }, judgedFree, true);
    expect(r).toEqual({ paid: true, price_jpy: 500 });
  });

  it('judge が何も言わなくても企画の有料を維持する', () => {
    const r = resolveFinalPricing({ paid: true, price_jpy: 680, paywall_line_pos: 900 }, judgedSilent, true);
    expect(r).toEqual({ paid: true, price_jpy: 680 });
  });

  it('無料企画でも judge が有料を勧めれば格上げする', () => {
    const judged = { recommend_paid: true, suggested_price_jpy: 500 } as never;
    const r = resolveFinalPricing({ paid: false, price_jpy: null, paywall_line_pos: 800 }, judged, true);
    expect(r).toEqual({ paid: true, price_jpy: 500 });
  });

  it('アカウントが有料公開を許可していなければ価格提案だけ残して無料で出す', () => {
    const r = resolveFinalPricing({ paid: true, price_jpy: 500, paywall_line_pos: 1200 }, judgedSilent, false);
    expect(r).toEqual({ paid: false, price_jpy: 500 });
  });

  it('有料ラインが無ければ有料にしない (本文が丸ごと有料側に入る事故を防ぐ)', () => {
    const r = resolveFinalPricing({ paid: true, price_jpy: 500, paywall_line_pos: null }, judgedSilent, true);
    expect(r).toEqual({ paid: false, price_jpy: 500 });
  });

  it('企画も judge も無料なら価格はクリアする', () => {
    const r = resolveFinalPricing({ paid: false, price_jpy: 500, paywall_line_pos: null }, judgedFree, true);
    expect(r).toEqual({ paid: false, price_jpy: null });
  });
});
