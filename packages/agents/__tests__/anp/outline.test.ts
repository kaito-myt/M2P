/**
 * ANP Outline (`src/anp/outline.ts`) 単体テスト。
 *
 * 重点: **judge の不合格理由が outline のプロンプトに入ること**。
 *
 * [2026-10-15] `pipeline.note.judge` は 69 点以下を「構成・切り口の問題」として
 * outline から書き直す経路に流すのに、`feedback` を outline の入力に渡していなかった
 * (payload では受け取って body writer へ素通しするだけだった)。そのため構成を作り直す
 * 当人が不合格理由を知らず、差し戻しを使い切っても同じ構成が再生成され、65〜69 点の記事が
 * 24 本滞留した。運営者指摘「スコアが足りない理由をちゃんとライターに伝達してないから
 * スコア達成できないんじゃない？」。
 */
import { describe, expect, it, vi } from 'vitest';

import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteOutlineInput } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { generateNoteOutline } = await import('../../src/anp/outline.js');

const VALID_OUTPUT = JSON.stringify({
  lead: 'リード文です。',
  headings: ['見出し1', '見出し2', '見出し3'],
});

function makeFakeClient(text = VALID_OUTPUT): LLMClient {
  const completeImpl = async <T = string>(
    _args: LLMCompleteArgs,
  ): Promise<LLMCompleteResult<T>> => ({
    text: text as T,
    usage: { inputTokens: 50, outputTokens: 80 },
    costJpy: 0,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  });
  return {
    complete: vi.fn(completeImpl) as LLMClient['complete'],
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('not used in tests');
    },
  };
}

function makePromptRepo() {
  return {
    prompt: {
      findFirst: vi.fn(async () => ({
        id: 'p-anp-outline-1',
        body:
          'あなたは note の構成設計者です。{niche} {target_reader} {tone} ' +
          '{theme_title} {theme_hook} {paid} {target_chars} {feedback}',
        version: 1,
        genre: null,
      })),
    },
  };
}

function baseInput(overrides: Partial<NoteOutlineInput> = {}): NoteOutlineInput {
  return {
    note_article_id: 'art-1',
    account: { niche: '競馬予想', target_reader: '週末だけ馬券を買う会社員', tone: '淡々' },
    theme: { title: 'タイトル', hook: 'フック' },
    paid: true,
    target_chars: 4000,
    ...overrides,
  };
}

async function runWith(input: NoteOutlineInput) {
  const client = makeFakeClient();
  await generateNoteOutline(input, {
    createAgentClient: vi.fn(async () => client),
    promptLoaderDeps: { prisma: makePromptRepo() } as never,
  });
  const call = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
  const system = call.messages.find((msg) => msg.role === 'system')!.content;
  const user = call.messages.find((msg) => msg.role === 'user')!.content;
  return { system, user };
}

describe('generateNoteOutline — judge feedback の伝達', () => {
  it('feedback 無し (初回執筆) なら差し戻し向けの文は出さない', async () => {
    const { user } = await runWith(baseInput());
    expect(user).not.toContain('品質判定で不合格');
    expect(user).toContain('見出し構成');
  });

  it('feedback 有りなら不合格理由を本文としてプロンプトに入れる', async () => {
    const { user } = await runWith(
      baseInput({
        feedback: [
          '品質スコア: 67/100',
          'フック強度 (62/100): 既出の一般論から始まっており読者を掴めていない',
          '有料転換見込み (65/100): 有料部分が無料部分の言い換えになっている',
        ],
      }),
    );
    expect(user).toContain('品質判定で不合格');
    expect(user).toContain('フック強度 (62/100): 既出の一般論から始まっており読者を掴めていない');
    expect(user).toContain('有料部分が無料部分の言い換えになっている');
  });

  it('指摘は出力形式より後ろに置く (強い既定に埋もれると効かない)', async () => {
    const { user } = await runWith(baseInput({ feedback: ['品質スコア: 67/100'] }));
    // 「"headings": string[]」= 出力形式の最後の行より後に指摘が来る。
    expect(user.indexOf('"headings"')).toBeLessThan(user.indexOf('品質判定で不合格'));
    // JSON 以外を出力させない一行だけは、パースを守るため最後に残す。
    expect(user.trimEnd().endsWith('JSON 以外のテキストは出力しないこと。')).toBe(true);
  });

  it('見出しの言い換えで済ませるなと明示する (同じ構成の再生成を防ぐ)', async () => {
    const { user } = await runWith(baseInput({ feedback: ['品質スコア: 67/100'] }));
    expect(user).toContain('見出しの言い換えで済ませず');
  });

  it('previous_lead を渡すと「同じ入り方を繰り返さない」として出る', async () => {
    const { user } = await runWith(
      baseInput({ feedback: ['品質スコア: 67/100'], previous_lead: '前回のリード文です。' }),
    );
    expect(user).toContain('前回のリード文です。');
    expect(user).toContain('同じ入り方を繰り返さない');
  });

  it('previous_lead だけあって feedback が無いときは出さない (初回執筆を汚さない)', async () => {
    const { user } = await runWith(baseInput({ previous_lead: '前回のリード文です。' }));
    expect(user).not.toContain('前回のリード文です。');
  });

  it('system プロンプトの {feedback} も埋める', async () => {
    const { system } = await runWith(baseInput({ feedback: ['品質スコア: 67/100'] }));
    expect(system).toContain('- 品質スコア: 67/100');
    expect(system).not.toContain('{feedback}');
  });
});
