/**
 * F-ANP-30 — anp.promo (note 記事の SNS 告知投稿) エージェント単体テスト。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { AnpPromoContentInput, AnpPromoContentOutput } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { createAnpArticlePromoContent } = await import('../../src/anp/promo.js');
import type { CreateAnpArticlePromoContentDeps } from '../../src/anp/promo.js';

function out(): AnpPromoContentOutput {
  return { body: '「環境設計」という考え方が刺さった記事。意志の弱さのせいにしなくていい理由がわかる。' };
}

function makeClient(o: AnpPromoContentOutput): LLMClient {
  const complete = async <T = string>(_a: LLMCompleteArgs): Promise<LLMCompleteResult<T>> => ({
    text: JSON.stringify(o) as unknown as T,
    usage: { inputTokens: 300, outputTokens: 100 },
    costJpy: 0,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  });
  return {
    complete: vi.fn(complete) as LLMClient['complete'],
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('unused');
    },
  };
}

function loadPromptStub() {
  return vi.fn(async () => ({
    template: '告知投稿を作る。対象:{channel_label} 長さ:{length_guide}',
    version: 1,
    promptId: 'p-anp-promo-1',
    genre: null,
  }));
}

function input(overrides: Partial<AnpPromoContentInput> = {}): AnpPromoContentInput {
  return {
    channel: overrides.channel ?? 'x',
    persona: overrides.persona ?? { concept: '良書紹介', tone_of_voice: '親しみやすい' },
    article: overrides.article ?? {
      title: '意志が弱いのではなく、「環境設計」を知らなかっただけだった。',
      note_url: 'https://note.com/goodbooks_intro/n/n5545faed9256',
      niche: '習慣化',
    },
    ...(overrides.playbook_guidance !== undefined ? { playbook_guidance: overrides.playbook_guidance } : {}),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('createAnpArticlePromoContent', () => {
  it('AnpPromoContentOutput を返す', async () => {
    const client = makeClient(out());
    const res = await createAnpArticlePromoContent(input(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as CreateAnpArticlePromoContentDeps);
    expect(res.body).toContain('環境設計');
  });

  it('channel の length_guide をプロンプトに埋め、role=anp.promo で呼ぶ', async () => {
    const client = makeClient(out());
    const load = loadPromptStub();
    await createAnpArticlePromoContent(input({ channel: 'x' }), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: load,
    } as CreateAnpArticlePromoContentDeps);
    const arg = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    expect(arg.role).toBe('anp.promo');
    const sys = arg.messages.find((mm) => mm.role === 'system');
    expect(String(sys?.content)).toContain('140字');
  });

  it('note_url は本文生成の指示に含めるが URL 自体は本文に混入させないよう指示する', async () => {
    const client = makeClient(out());
    await createAnpArticlePromoContent(input(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as CreateAnpArticlePromoContentDeps);
    const arg = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    const userMessage = String(arg.messages.find((mm) => mm.role === 'user')?.content ?? '');
    expect(userMessage).toContain('URL・ハッシュタグは絶対に含めない');
    expect(userMessage).not.toContain('https://note.com');
  });
});
