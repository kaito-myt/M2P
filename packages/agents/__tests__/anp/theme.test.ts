/**
 * ANP テーマ企画 (`src/anp/theme.ts`) — 運営者の指示がプロンプトに届く位置にあることを固定する。
 *
 * F-ANP-10b (2026-10-15 運営者要望「テーマ一覧のところで、人がテーマの指示を与えて
 * 作成できるようにして」)。
 *
 * 検証するのは**文言ではなく順序**: 指示が「出力形式」「件数」「アカウント既定」より
 * 後ろに無いと、後に書かれた既定に負けて実質無視される (同日 strategist の 4 プロンプトで実証)。
 */
import { describe, expect, it, vi } from 'vitest';

import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteThemeInput } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { generateNoteThemes } = await import('../../src/anp/theme.js');

const INSTRUCTION = '週末の重賞だけを軸にして、初心者向けの基礎解説は入れないで';

function makeFakeClient(): LLMClient {
  const completeImpl = async <T = string>(_args: LLMCompleteArgs): Promise<LLMCompleteResult<T>> => ({
    text: JSON.stringify({
      candidates: [{ title: 'T', hook: 'H', recommend_paid: false, genre: 'gambling' }],
    }) as T,
    usage: { inputTokens: 100, outputTokens: 200 },
    costJpy: 0,
    provider: 'anthropic',
    model: 'claude-opus-5',
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
        id: 'p-anp-theme-1',
        body: 'あなたは note マーケターです。{niche} {target_reader} {tone} {count} {exclude_titles}',
        version: 1,
        genre: null,
      })),
    },
  };
}

function baseInput(overrides: Partial<NoteThemeInput> = {}): NoteThemeInput {
  return {
    note_account_id: 'acc-1',
    account: {
      niche: '競馬予想',
      target_reader: '週末だけ買う人',
      tone: '淡々',
      editorial_policy: '根拠を先に出す',
      monetization: { free_ratio: 0.3, membership: false, paid_ratio: 0.4, price_band: [300, 980] },
    },
    count: 5,
    exclude_titles_recent: ['既出タイトル'],
    ...overrides,
  };
}

function userMessageOf(client: LLMClient): string {
  const args = (client.complete as unknown as { mock: { calls: Array<[LLMCompleteArgs]> } }).mock.calls[0]![0];
  return args.messages.find((msg) => msg.role === 'user')!.content as string;
}

describe('generateNoteThemes — 運営者の指示 (F-ANP-10b)', () => {
  it('指示は出力形式・件数・アカウント既定より後ろに置かれる', async () => {
    const client = makeFakeClient();
    await generateNoteThemes(baseInput({ instruction: INSTRUCTION }), {
      createAgentClient: vi.fn(async () => client),
      promptLoaderDeps: { prisma: makePromptRepo() },
    });

    const msg = userMessageOf(client);
    expect(msg).toContain(INSTRUCTION);
    // 後に書かれた具体的な既定に負けないこと = これらより後ろにある。
    expect(msg.indexOf(INSTRUCTION)).toBeGreaterThan(msg.indexOf('出力形式'));
    expect(msg.indexOf(INSTRUCTION)).toBeGreaterThan(msg.indexOf('件数:'));
    expect(msg.indexOf(INSTRUCTION)).toBeGreaterThan(msg.indexOf('記事の方針'));
    expect(msg.indexOf(INSTRUCTION)).toBeGreaterThan(msg.indexOf('収益化方針'));
    expect(msg).toContain('これが最優先');
  });

  it('指示が無ければプロンプトは変わらない', async () => {
    const withOut = makeFakeClient();
    await generateNoteThemes(baseInput(), {
      createAgentClient: vi.fn(async () => withOut),
      promptLoaderDeps: { prisma: makePromptRepo() },
    });
    expect(userMessageOf(withOut)).not.toContain('これが最優先');
  });

  it('空白だけの指示は最優先ブロックを出さない', async () => {
    const client = makeFakeClient();
    await generateNoteThemes(baseInput({ instruction: '   ' }), {
      createAgentClient: vi.fn(async () => client),
      promptLoaderDeps: { prisma: makePromptRepo() },
    });
    expect(userMessageOf(client)).not.toContain('これが最優先');
  });
});
