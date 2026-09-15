/**
 * ANP Editor (`src/anp/editor.ts`) 単体テスト。
 * 重点: ペイウォールマーカー保持指示後にマーカーが消えた場合の invalid_output 再試行/throw
 * (code-reviewer REQUEST_CHANGES 対応)。
 */
import { describe, expect, it, vi } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteEditorInput } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { PAYWALL_MARKER } = await import('../../src/anp/writer.js');
const { editNoteArticle, insertMarker } = await import('../../src/anp/editor.js');

function makeFakeClient(text: string): LLMClient {
  const completeImpl = async <T = string>(
    _args: LLMCompleteArgs,
  ): Promise<LLMCompleteResult<T>> => ({
    text: text as T,
    usage: { inputTokens: 100, outputTokens: 200 },
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
        id: 'p-anp-editor-1',
        body: 'あなたは note 編集者です。{niche} {tone} {title} {paid} {feedback}',
        version: 1,
        genre: null,
      })),
    },
  };
}

function baseInput(overrides: Partial<NoteEditorInput> = {}): NoteEditorInput {
  return {
    note_article_id: 'art-1',
    account: { niche: '副業×AI', tone: '丁寧' },
    title: 'タイトル',
    lead: 'リード文',
    body_md: '本文'.padEnd(300, 'あ'),
    paid: true,
    paywall_line_pos: 100,
    ...overrides,
  };
}

describe('editNoteArticle — paywall marker 保持', () => {
  it('マーカー保持指示後にマーカーが消えた応答が続く場合、再試行を尽くして AgentError を throw する', async () => {
    const bodyWithoutMarker = '校閲後だがマーカーが消えた本文です。'.padEnd(300, 'い');
    const text = JSON.stringify({ lead: '校閲後リード', body_md: bodyWithoutMarker });
    const fakeClient = makeFakeClient(text);

    await expect(
      editNoteArticle(baseInput(), {
        createAgentClient: vi.fn(async () => fakeClient),
        promptLoaderDeps: { prisma: makePromptRepo() },
      }),
    ).rejects.toThrow(AgentError);

    expect(fakeClient.complete).toHaveBeenCalledTimes(2);
  });

  it('マーカーを保持した応答なら新しい paywall_line_pos を返す', async () => {
    const newBody = insertMarker('校閲後の本文です。ここまでが無料。ここからが有料。'.padEnd(250, 'う'), true, 10);
    const text = JSON.stringify({ lead: '校閲後リード', body_md: newBody });
    const fakeClient = makeFakeClient(text);

    const result = await editNoteArticle(baseInput(), {
      createAgentClient: vi.fn(async () => fakeClient),
      promptLoaderDeps: { prisma: makePromptRepo() },
    });

    expect(result.body_md).not.toContain(PAYWALL_MARKER);
    expect(result.paywall_line_pos).toBeDefined();
    expect(fakeClient.complete).toHaveBeenCalledTimes(1);
  });

  it('paid=false / paywall_line_pos 未指定なら marker 処理をせず成功する', async () => {
    const text = JSON.stringify({ lead: '校閲後リード', body_md: '無料記事の校閲後本文です。'.padEnd(300, 'え') });
    const fakeClient = makeFakeClient(text);

    const result = await editNoteArticle(
      baseInput({ paid: false, paywall_line_pos: undefined }),
      {
        createAgentClient: vi.fn(async () => fakeClient),
        promptLoaderDeps: { prisma: makePromptRepo() },
      },
    );

    expect(result.paywall_line_pos).toBeUndefined();
    expect(fakeClient.complete).toHaveBeenCalledTimes(1);
  });
});
