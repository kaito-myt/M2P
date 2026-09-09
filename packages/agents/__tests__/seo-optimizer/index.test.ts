/**
 * SEO Optimizer エージェント (optimizeSeo) 単体テスト — judge/content-creator と同パターン。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { SeoOptimizerInput, SeoOptimizerOutput } from '@a2p/contracts/agents/seo-optimizer';

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

const { optimizeSeo } = await import('../../src/seo-optimizer/index.js');
import type { SeoOptimizerDeps } from '../../src/seo-optimizer/index.js';

function out(): SeoOptimizerOutput {
  return {
    description: '副業に踏み出せない会社員へ、今日から始められる具体的な一歩を示す一冊。',
    keywords: ['副業 初心者', '在宅ワーク やり方', 'スキマ時間 稼ぐ'],
    categories: ['ビジネス・経済 > 起業', 'ビジネス・経済 > キャリア'],
    rationale: 'タイトル既出語を避け、検索語のゆれを網羅した。',
  };
}

function makeClient(o: SeoOptimizerOutput): LLMClient {
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
      'タイトル:{title} 副題:{subtitle} 読者:{target_reader} ジャンル:{genre} フック:{hook} ' +
      '現行keywords:{current_keywords} 現行categories:{current_categories} 現行description:{current_description} ' +
      'ダイジェスト:{chapter_digest}',
    version: 1,
    promptId: 'p-seo-1',
    genre: null,
  }));
}

function input(overrides: Partial<SeoOptimizerInput> = {}): SeoOptimizerInput {
  return {
    book_id: overrides.book_id ?? 'book-seo-1',
    job_id: overrides.job_id,
    genre: overrides.genre !== undefined ? overrides.genre : 'side_business',
    title: overrides.title ?? '副業を今日から始める本',
    subtitle: overrides.subtitle,
    target_reader: overrides.target_reader ?? '30代の会社員',
    hook: overrides.hook,
    chapter_digest: overrides.chapter_digest ?? '第1章: 副業の選び方\n第2章: 始め方',
    current_metadata: overrides.current_metadata ?? {
      description: '旧説明文',
      keywords: ['副業'],
      categories: ['ビジネス・経済 > 起業'],
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('optimizeSeo', () => {
  it('SeoOptimizerOutput を返す (description/keywords/categories が反映される)', async () => {
    const client = makeClient(out());
    const res = await optimizeSeo(input(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as SeoOptimizerDeps);

    expect(res.description).toContain('副業に踏み出せない');
    expect(res.keywords).toHaveLength(3);
    expect(res.categories).toHaveLength(2);
  });

  it('user message にタイトル/現行keywords/ダイジェストが含まれる', async () => {
    const client = makeClient(out());
    await optimizeSeo(
      input({ title: 'プレースホルダ確認用タイトル', current_metadata: { description: 'd', keywords: ['既存キーワード'], categories: ['c1', 'c2'] } }),
      {
        createAgentClient: vi.fn(async () => client),
        loadActivePrompt: loadPromptStub(),
      } as SeoOptimizerDeps,
    );

    const completeMock = client.complete as unknown as { mock: { calls: Array<[LLMCompleteArgs]> } };
    const args = completeMock.mock.calls[0]![0];
    const userMsg = args.messages.find((m) => m.role === 'user');
    expect(userMsg!.content).toContain('プレースホルダ確認用タイトル');
    expect(userMsg!.content).toContain('既存キーワード');
    expect(args.role).toBe('seo_optimizer');
    expect(args.maxOutputTokens).toBe(4096);
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
      optimizeSeo(input(), {
        createAgentClient: vi.fn(async () => client),
        loadActivePrompt: loadPromptStub(),
      } as SeoOptimizerDeps),
    ).rejects.toBeInstanceOf(AgentError);
  });
});
