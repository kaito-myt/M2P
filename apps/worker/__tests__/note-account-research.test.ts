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

import type { NoteAccountResearch } from '@a2p/contracts/agents/anp';

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
  return {
    updates,
    prisma: {
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
    const spy = vi.fn(async () => ({ research: research(), items: [] }));

    const r = await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });

    expect(r).toEqual({ accounts: 2, updated: 2, failed: 0 });
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
      { prisma, research: async () => ({ research: research(), items: [] }), now: () => NOW },
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

    expect(r).toEqual({ accounts: 3, updated: 2, failed: 1 });
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
    const spy = vi.fn(async () => ({ research: research(), items: [] }));
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
    const spy = vi.fn(async () => ({ research: research(), items: [] }));
    await runNoteAccountResearch({ note_account_id: 'a2' }, { prisma, research: spy, now: () => NOW });

    expect(prisma.noteAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a2' } }),
    );
  });

  it('対象アカウントが無ければ何もしない', async () => {
    const { prisma, updates } = makePrisma([]);
    const spy = vi.fn();
    const r = await runNoteAccountResearch({}, { prisma, research: spy as never, now: () => NOW });
    expect(r).toEqual({ accounts: 0, updated: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it('壊れた research_json は previous=null にして続行する (前回値で落ちない)', async () => {
    const { prisma } = makePrisma([
      { id: 'a1', niche: 'x', display_name: 'X', target_reader: null, tone: null, editorial_policy: null, research_json: { angles: 'not-an-array' } },
    ]);
    const spy = vi.fn(async () => ({ research: research(), items: [] }));
    await runNoteAccountResearch({}, { prisma, research: spy, now: () => NOW });
    expect(spy.mock.calls[0]![0]!.previous).toBeNull();
  });
});
