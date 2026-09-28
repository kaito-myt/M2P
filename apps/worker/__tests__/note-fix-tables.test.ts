import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import type {
  NoteFixTablesArgs,
  NoteFixTablesResult,
  NotePublishPort,
} from '../src/tasks/note-publish/playwright-note-publish-port.js';
import {
  PIPELINE_NOTE_FIX_TABLES_TASK_NAME,
  runPipelineNoteFixTables,
  type PipelineNoteFixTablesPrisma,
} from '../src/tasks/pipeline-note-fix-tables.js';

const LF = String.fromCharCode(10);
const PARA_SEP = LF + LF;

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

const TABLE = [
  '| 頭数帯 | レース数 | 単勝回収率 |',
  '|---|---:|---:|',
  '| 7〜9頭 | 1,842 | 89.7% |',
  '| 10〜12頭 | 2,915 | 92.3% |',
].join(LF);

const BODY = ['## 集計結果', '次の表のとおりでした。', TABLE, 'この差は無視できません。'].join(PARA_SEP);

interface ArticleState {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  paywall_line_pos: number | null;
  note_url: string | null;
  status: string;
}

function buildPrisma(overrides: Partial<ArticleState> = {}, dryRunGlobal = false) {
  const article: ArticleState = {
    id: 'a1',
    note_account_id: 'acc1',
    title: '出走頭数別の回収率',
    body_md: BODY,
    paid: false,
    paywall_line_pos: null,
    note_url: 'https://note.com/baken_jutsu/n/nba29caaea27e',
    status: 'published',
    ...overrides,
  };
  const jobUpdates: Array<Record<string, unknown>> = [];
  const accountUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    appSettings: { findUnique: async () => ({ anp_publish_dry_run: dryRunGlobal }) },
    job: {
      findUnique: async () => ({ status: 'queued' }),
      updateMany: async () => ({ count: 1 }),
      update: async (args: { data: Record<string, unknown> }) => {
        jobUpdates.push(args.data);
        return {};
      },
    },
    noteArticle: { findUnique: async () => article },
    noteAccount: {
      findUnique: async () => ({
        id: 'acc1',
        display_name: '手堅く勝つ馬券術',
        niche: '競馬予想',
        session_state_enc: 'enc',
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        accountUpdates.push(args.data);
        return {};
      },
    },
    noteAuthRequest: { findFirst: async () => null, create: async () => ({ id: 'r1' }) },
  } as unknown as PipelineNoteFixTablesPrisma;
  return { prisma, jobUpdates, accountUpdates };
}

function makePort(result: NoteFixTablesResult): { port: NotePublishPort; calls: NoteFixTablesArgs[] } {
  const calls: NoteFixTablesArgs[] = [];
  return {
    calls,
    port: {
      publishOne: async () => {
        throw new Error('publishOne should not be called');
      },
      checkPublished: async () => {
        throw new Error('checkPublished should not be called');
      },
      monetizeOne: async () => {
        throw new Error('monetizeOne should not be called');
      },
      fixTablesOne: async (args: NoteFixTablesArgs) => {
        calls.push(args);
        return result;
      },
    } as unknown as NotePublishPort,
  };
}

const baseDeps = {
  logger: makeLogger(),
  acquireLock: vi.fn(async () => undefined) as never,
  releaseLock: vi.fn(async () => undefined) as never,
  decryptSession: () => 'session-json',
  notify: vi.fn(async () => true),
};

describe(PIPELINE_NOTE_FIX_TABLES_TASK_NAME, () => {
  it('表を画像化して port に渡し、成功を Job に記録する', async () => {
    const { prisma, jobUpdates } = buildPrisma();
    const { port, calls } = makePort({
      ok: true,
      status: 'fixed',
      noteUrl: 'https://note.com/baken_jutsu/n/nba29caaea27e',
      replaced: 1,
      remaining: 0,
    });

    const res = await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(res).toMatchObject({ ok: true, status: 'fixed', replaced: 1, remaining: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.tableImages).toHaveLength(1);
    expect(calls[0]!.tableImages[0]).toMatch(/\.png$/);
    expect(calls[0]!.dryRun).toBe(false);
    expect(jobUpdates.at(-1)).toMatchObject({ status: 'done' });
  });

  it('dry_run を省略したらドライラン (公開中の本文は変えない)', async () => {
    const { prisma } = buildPrisma();
    const { port, calls } = makePort({
      ok: true,
      status: 'dry_run_ready',
      noteUrl: 'https://note.com/x/n/n1',
      replaced: 1,
      remaining: 0,
    });

    const res = await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1' },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(res.status).toBe('dry_run_ready');
    expect(calls[0]!.dryRun).toBe(true);
  });

  it('グローバルのドライラン設定が ON なら強制的にドライラン', async () => {
    const { prisma } = buildPrisma({}, true);
    const { port, calls } = makePort({
      ok: true,
      status: 'dry_run_ready',
      noteUrl: 'https://note.com/x/n/n1',
      replaced: 1,
      remaining: 0,
    });

    await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(calls[0]!.dryRun).toBe(true);
  });

  it('本文に表が無ければ port を呼ばない', async () => {
    const { prisma } = buildPrisma({ body_md: ['## 見出し', '本文だけ。'].join(PARA_SEP) });
    const { port, calls } = makePort({
      ok: true,
      status: 'no_tables',
      noteUrl: 'https://note.com/x/n/n1',
      replaced: 0,
      remaining: 0,
    });

    const res = await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(res).toMatchObject({ ok: true, status: 'no_tables' });
    expect(calls).toHaveLength(0);
  });

  it('未公開の記事は対象外', async () => {
    const { prisma } = buildPrisma({ status: 'ready', note_url: null });
    const { port, calls } = makePort({
      ok: true,
      status: 'fixed',
      noteUrl: 'x',
      replaced: 0,
      remaining: 0,
    });

    const res = await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(res).toMatchObject({ ok: false, status: 'not_published' });
    expect(calls).toHaveLength(0);
  });

  it('セッション失効ならアカウントを paused にする', async () => {
    const { prisma, accountUpdates } = buildPrisma();
    const { port } = makePort({ ok: false, reason: 'not_logged_in', message: 'セッション失効' });

    const res = await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(res).toMatchObject({ ok: false, status: 'not_logged_in' });
    expect(accountUpdates.at(-1)).toMatchObject({ status: 'paused' });
  });

  it('有料記事は paid=true を port に伝える (更新時に有料エリア設定を挟む必要がある)', async () => {
    const pos = Array.from(['## 集計結果', '次の表のとおりでした。'].join(PARA_SEP)).length;
    const { prisma } = buildPrisma({ paid: true, paywall_line_pos: pos });
    const { port, calls } = makePort({
      ok: true,
      status: 'fixed',
      noteUrl: 'https://note.com/x/n/n1',
      replaced: 1,
      remaining: 0,
    });

    await runPipelineNoteFixTables(
      { note_article_id: 'a1', job_id: 'j1', dry_run: false },
      { ...baseDeps, prisma, publishPort: port },
    );

    expect(calls[0]!.paid).toBe(true);
    // 有料ラインより後ろにある表も画像化の対象になる。
    expect(calls[0]!.tableImages).toHaveLength(1);
  });
});
