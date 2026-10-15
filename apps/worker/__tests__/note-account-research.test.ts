/**
 * F-ANP-56 — `note.account.research` (note アカウント別 週次リサーチ) タスクのテスト。
 *
 * 要点:
 *  - active な全アカウントを 1 件ずつ回す (アカウントごとに観点が違うので一括はしない)
 *  - 1 アカウントの失敗で他を止めない (週次 cron なので全滅させない)
 *  - 前回結果を渡す / 公開済み記事の実績を集計して渡す
 *  - `editorial_policy` は**自動で書き換えない** (運営者の設定を壊さない。提案だけ残す)
 */
import { describe, expect, it, vi } from 'vitest';

import type { NoteAccountResearch, NoteAccountResearchInput } from '@a2p/contracts/agents/anp';

import { runNoteAccountResearch } from '../src/tasks/note-account-research.js';

function research(over: Partial<NoteAccountResearch> = {}): NoteAccountResearch {
  return {
    angles: [{ angle: '観点A', queries: ['q1'] }],
    findings: [{ finding: '知見', sources: [] }],
    winning_patterns: ['型A'],
    art_direction: 'ターフの緑を遠景に',
    copy_rules: ['数字を1つ入れる'],
    topics_to_pursue: ['題材A'],
    topics_to_avoid: ['断定表現'],
    editorial_policy_suggestion: '根拠を先に出す点を追記',
    summary: '総括',
    ...over,
  };
}

function makePrisma(accounts: Array<Record<string, unknown>>, articles: Record<string, unknown[]> = {}) {
  const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
  const jobCreates: Array<{ data: Record<string, unknown> }> = [];
  return {
    updates,
    jobUpdates,
    jobCreates,
    prisma: {
      job: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          jobCreates.push(args);
          return { id: `auto-job-${jobCreates.length}` };
        }),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          jobUpdates.push(args);
          return {};
        }),
      },
      noteAccount: {
        findMany: vi.fn(async () => accounts),
        update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        }),
      },
      noteArticle: {
        findMany: vi.fn(async (args: { where: { note_account_id: string } }) =>
          articles[args.where.note_account_id] ?? [],
        ),
      },
    } as never,
  };
}

const NOW = new Date('2026-10-19T02:00:00.000Z');

describe('runNoteAccountResearch', () => {
  it('active な全アカウントを回して research_json に保存する', async () => {
    const { prisma, updates } = makePrisma([
      { id: 'a1', niche: '競馬予想', display_name: '競馬', target_reader: null, tone: null, editorial_policy: null, research_json: null },
      { id: 'a2', niche: 'AI副業', display_name: '副業', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    const spy = vi.fn(async (_input: NoteAccountResearchInput) => ({ research: research(), items: [] }));

    const r = await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });

    expect(r).toEqual({ accounts: 2, updated: 2, failed: 0, errors: [] });
    expect(spy).toHaveBeenCalledTimes(2);
    // アカウントごとに別々の文脈で呼ばれる (観点をアカウントごとに決めるため)
    expect(spy.mock.calls[0]![0]!.account.niche).toBe('競馬予想');
    expect(spy.mock.calls[1]![0]!.account.niche).toBe('AI副業');
    expect(updates).toHaveLength(2);
    expect(updates[0]!.data.research_updated_at).toEqual(NOW);
    expect((updates[0]!.data.research_json as NoteAccountResearch).art_direction).toBe('ターフの緑を遠景に');
  });

  it('editorial_policy は自動で書き換えず、提案として保存するだけ', async () => {
    const { prisma, updates } = makePrisma([
      { id: 'a1', niche: '競馬予想', display_name: '競馬', target_reader: null, tone: null, editorial_policy: '既存の方針', research_json: null },
    ]);
    await runNoteAccountResearch(
      {},
      { prisma, research: async (_input: NoteAccountResearchInput) => ({ research: research(), items: [] }), now: () => NOW },
    );
    // 運営者が UI で編集する設定なので、提案は research_json 側にだけ入る。
    expect(Object.keys(updates[0]!.data)).toEqual(['research_json', 'research_updated_at']);
    expect((updates[0]!.data.research_json as NoteAccountResearch).editorial_policy_suggestion).toBe(
      '根拠を先に出す点を追記',
    );
  });

  it('1 アカウントが失敗しても他のアカウントは続行する', async () => {
    const { prisma, updates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
      { id: 'a2', niche: 'y', display_name: 'Y', target_reader: null, tone: null, editorial_policy: null, research_json: null },
      { id: 'a3', niche: 'z', display_name: 'Z', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    const spy = vi.fn(async (input: { noteAccountId: string }) => {
      if (input.noteAccountId === 'a2') throw new Error('anp.research.invalid_output');
      return { research: research(), items: [] };
    });

    const r = await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });

    expect(r).toEqual({
      accounts: 3,
      updated: 2,
      failed: 1,
      errors: [{ note_account_id: 'a2', display_name: 'Y', error: 'anp.research.invalid_output' }],
    });
    expect(updates.map((u) => u.where.id)).toEqual(['a1', 'a3']);
  });

  it('前回のリサーチ結果と公開済み記事の実績を渡す', async () => {
    const prev = research({ summary: '前回の総括' });
    const { prisma } = makePrisma(
      [{ id: 'a1', niche: '競馬予想', display_name: '競馬', target_reader: null, tone: null, editorial_policy: null, research_json: prev }],
      {
        a1: [
          { title: '公開記事A', paid: true, sales: [{ views: 500, likes: 8, revenue_jpy: 1200 }, { views: 300, likes: 4, revenue_jpy: 800 }] },
          { title: '公開記事B', paid: false, sales: [] },
        ],
      },
    );
    const spy = vi.fn(async (_input: NoteAccountResearchInput) => ({ research: research(), items: [] }));
    await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });

    const input = spy.mock.calls[0]![0]!;
    expect(input.previous?.summary).toBe('前回の総括');
    // 月次の売上行を合算して渡す
    expect(input.recentArticles[0]).toEqual({ title: '公開記事A', views: 800, likes: 12, sales_jpy: 2000, is_paid: true });
    // 数字が取れていない記事はタイトルだけ (立ち上げ期の情報として意味がある)
    expect(input.recentArticles[1]).toEqual({ title: '公開記事B', is_paid: false });
  });

  it('note_account_id 指定ならそのアカウントだけ', async () => {
    const { prisma } = makePrisma([
      { id: 'a2', niche: 'y', display_name: 'Y', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    const spy = vi.fn(async (_input: NoteAccountResearchInput) => ({ research: research(), items: [] }));
    await runNoteAccountResearch({ note_account_id: 'a2' }, { prisma, research: spy, now: () => NOW });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]!.noteAccountId).toBe('a2');
  });

  it('対象アカウントが無ければ何もしない', async () => {
    const { prisma, updates } = makePrisma([]);
    const spy = vi.fn();
    const r = await runNoteAccountResearch({}, { prisma, research: spy as never, now: () => NOW });
    expect(r).toEqual({ accounts: 0, updated: 0, failed: 0, errors: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('壊れた research_json は previous=null にして続行する (前回値で落ちない)', async () => {
    const { prisma } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: { angles: 'not-an-array' } },
    ]);
    const spy = vi.fn(async (_input: NoteAccountResearchInput) => ({ research: research(), items: [] }));
    await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });
    expect(spy.mock.calls[0]![0]!.previous).toBeNull();
  });
  it('内部 Job 行を running → done に遷移させる (UI の多重起動ガードが固まらないように)', async () => {
    const { prisma, jobUpdates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      { job_id: 'job-1' },
      { prisma, research: async (_i: NoteAccountResearchInput) => ({ research: research(), items: [] }), now: () => NOW },
    );
    expect(jobUpdates.map((u) => u.data.status)).toEqual(['running', 'done']);
    expect(jobUpdates[1]!.data.result_json).toEqual({ accounts: 1, updated: 1, failed: 0, errors: [] });
  });

  it('全アカウント失敗なら内部 Job を failed にする', async () => {
    const { prisma, jobUpdates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      { job_id: 'job-1' },
      {
        prisma,
        research: async (_i: NoteAccountResearchInput) => {
          throw new Error('boom');
        },
        now: () => NOW,
      },
    );
    expect(jobUpdates.map((u) => u.data.status)).toEqual(['running', 'failed']);
  });

  it('一部成功なら内部 Job は done (週次 cron を赤くし続けない)', async () => {
    const { prisma, jobUpdates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
      { id: 'a2', niche: 'y', display_name: 'Y', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      { job_id: 'job-1' },
      {
        prisma,
        research: async (input: NoteAccountResearchInput) => {
          if (input.noteAccountId === 'a1') throw new Error('boom');
          return { research: research(), items: [] };
        },
        now: () => NOW,
      },
    );
    expect(jobUpdates[1]!.data.status).toBe('done');
    expect(jobUpdates[1]!.data.result_json).toEqual({
      accounts: 2,
      updated: 1,
      failed: 1,
      errors: [{ note_account_id: 'a1', display_name: 'X', error: 'boom' }],
    });
  });
  // --- 2026-10-15: 運営者が ANP ホームで「アカウントリサーチ失敗」を見たが
  //     理由がどこにも無かった件の是正 ---

  it('job_id の無い週次 cron でも観測用の Job 行を自分で作る (UI に実行の痕跡を残す)', async () => {
    const { prisma, jobCreates, jobUpdates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      {},
      { prisma, research: async (_i: NoteAccountResearchInput) => ({ research: research(), items: [] }), now: () => NOW },
    );

    // cron は payload を持たないので、ここで作らないと jobs に 1 行も残らず
    // ANP ホームの「実行中」「直近の失敗」のどちらにも出ない。
    expect(jobCreates).toHaveLength(1);
    expect(jobCreates[0]!.data.kind).toBe('note.account.research');
    expect(jobCreates[0]!.data.status).toBe('running');
    expect(jobCreates[0]!.data.payload_json).toEqual({ trigger: 'cron' });
    // 作成時点で running なので running への update は重ねない。
    expect(jobUpdates.map((u) => u.data.status)).toEqual(['done']);
    expect(jobUpdates[0]!.where.id).toBe('auto-job-1');
  });

  it('job_id が渡されたら Job 行は作らない (UI 起動分を二重に作らない)', async () => {
    const { prisma, jobCreates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      { job_id: 'job-1' },
      { prisma, research: async (_i: NoteAccountResearchInput) => ({ research: research(), items: [] }), now: () => NOW },
    );
    expect(jobCreates).toHaveLength(0);
  });

  it('全滅時の Job.error にどのアカウントが何で落ちたかを入れる', async () => {
    // 本番で起きたこと: error が「全 1 アカウントのリサーチが失敗しました」だけで、
    // 真因 (出力が上限で切れた) は Railway ログにしか無く運営者から辿れなかった。
    const { prisma, jobUpdates } = makePrisma([
      { id: 'a1', niche: '競馬予想', display_name: '手堅く勝つ馬券術', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    await runNoteAccountResearch(
      { job_id: 'job-1' },
      {
        prisma,
        research: async (_i: NoteAccountResearchInput) => {
          throw new Error('anp.research.invalid_output: 出力が上限 (16384 トークン) で切れて JSON が完結しなかった');
        },
        now: () => NOW,
      },
    );
    const done = jobUpdates[1]!.data;
    expect(done.status).toBe('failed');
    expect(String(done.error)).toContain('手堅く勝つ馬券術');
    expect(String(done.error)).toContain('出力が上限');
  });

  it('観測用の Job 行が作れなくてもリサーチ本体は走る', async () => {
    const { prisma, updates } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: null },
    ]);
    (prisma as unknown as { job: { create: () => Promise<never> } }).job.create = () =>
      Promise.reject(new Error('DB 接続エラー'));

    const r = await runNoteAccountResearch(
      {},
      { prisma, research: async (_i: NoteAccountResearchInput) => ({ research: research(), items: [] }), now: () => NOW },
    );
    expect(r.updated).toBe(1);
    expect(updates).toHaveLength(1);
  });
});
