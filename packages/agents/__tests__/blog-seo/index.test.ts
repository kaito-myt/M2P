/**
 * Blog SEO エージェント (optimizeBlogSeo) 単体テスト — seo-optimizer と同パターン。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { BlogSeoInput, BlogSeoOutput } from '@a2p/contracts/agents/blog-seo';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    book: { update: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { optimizeBlogSeo } = await import('../../src/blog-seo/index.js');
import type { BlogSeoDeps } from '../../src/blog-seo/index.js';

function out(): BlogSeoOutput {
  return {
    seo_title: '積立投資の始め方｜初心者が最初に読む1冊',
    slug: 'tsumitate-toushi-hajimekata',
    meta_description: '投資が初めての人向けに、積立投資の始め方を良書とともにやさしく解説します。',
    keywords: ['積立投資 始め方', '投資 初心者 本', 'つみたてNISA おすすめ'],
    rationale: '検索意図に沿ってタイトルとメタを整えた。',
  };
}

function makeClient(o: BlogSeoOutput): LLMClient {
  const complete = async <T = string>(_a: LLMCompleteArgs): Promise<LLMCompleteResult<T>> => ({
    text: JSON.stringify(o) as unknown as T,
    usage: { inputTokens: 900, outputTokens: 500 },
    costJpy: 0,
    provider: 'openai',
    model: 'gpt-5',
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
    template:
      'タイトル:{title} 本文:{body_md} キーワード:{target_keyword} テーマ:{theme} ' +
      '本:{book} slug:{current_slug} ジャンル:{genre} カテゴリ:{category}',
    version: 1,
    promptId: 'p-blog-seo-1',
    genre: null,
  }));
}

function input(overrides: Partial<BlogSeoInput> = {}): BlogSeoInput {
  return {
    title: overrides.title ?? '積立投資のはじめかた',
    body_md: overrides.body_md ?? '# はじめに\n積立投資は初心者に向いています。\n## メリット\n時間分散でリスクを抑えられます。',
    target_keyword: overrides.target_keyword,
    theme: overrides.theme,
    current_slug: overrides.current_slug,
    genre: overrides.genre,
    category: overrides.category,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('optimizeBlogSeo', () => {
  it('BlogSeoOutput を返す (seo_title/slug/meta_description/keywords が反映される)', async () => {
    const client = makeClient(out());
    const res = await optimizeBlogSeo(input(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as BlogSeoDeps);

    expect(res.seo_title).toContain('積立投資');
    expect(res.slug).toBe('tsumitate-toushi-hajimekata');
    expect(res.keywords.length).toBeGreaterThanOrEqual(3);
  });

  it('user message に記事タイトル/本文/既存slugが含まれ、role=blog_seo で呼ぶ', async () => {
    const client = makeClient(out());
    await optimizeBlogSeo(
      input({ title: '確認用タイトル', body_md: '確認用本文の内容です。', current_slug: 'existing-slug' }),
      {
        createAgentClient: vi.fn(async () => client),
        loadActivePrompt: loadPromptStub(),
      } as BlogSeoDeps,
    );

    const completeMock = client.complete as unknown as { mock: { calls: Array<[LLMCompleteArgs]> } };
    const args = completeMock.mock.calls[0]![0];
    const userMsg = args.messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toContain('確認用タイトル');
    expect(userMsg!.content).toContain('確認用本文の内容です。');
    expect(userMsg!.content).toContain('existing-slug');
    expect(args.role).toBe('blog_seo');
    expect(args.genre).toBeNull();
  });

  it('不正な JSON レスポンス → AgentError(invalid_output)', async () => {
    const client = makeClient(out());
    (client.complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: 'これは JSON ではありません。',
      usage: { inputTokens: 100, outputTokens: 10 },
      costJpy: 0,
      provider: 'openai',
      model: 'gpt-5',
    });

    await expect(
      optimizeBlogSeo(input(), {
        createAgentClient: vi.fn(async () => client),
        loadActivePrompt: loadPromptStub(),
      } as BlogSeoDeps),
    ).rejects.toBeInstanceOf(AgentError);
  });
});
