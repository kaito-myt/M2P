/**
 * F-ANP-01/03 — anp.strategist (note アカウント設計) エージェント単体テスト。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteAccountDesign, NoteAccountDesignBrief } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const {
  planNoteAccountDesign,
  buildUserMessage,
  generateNoteAccountDesignImages,
} = await import('../../src/anp/strategist.js');
import type {
  PlanNoteAccountDesignDeps,
  GenerateNoteAccountDesignImagesDeps,
} from '../../src/anp/strategist.js';

function validDesign(): NoteAccountDesign {
  return {
    display_name_candidates: ['副業AIラボ', 'AI副業ノート', '週末AI副業部'],
    handle_candidates: ['ai_fukugyo_lab', 'ai_side_note', 'weekend_ai_biz'],
    bio: '会社員の週末副業×AI活用を発信します。',
    concept: '副業初心者がAIで最初の1万円を稼ぐまでを伴走するアカウント。',
    target_reader: '副業に興味がある会社員',
    tone: '親しみやすい・断定的',
    persona_type: 'person',
    character_sheet: '名前は「たくみ」、30代前半の会社員。',
    content_pillars: [
      { name: 'AIツール活用術', description: '毎日使えるAIツール紹介', example_titles: ['a', 'b', 'c'] },
    ],
    genre_policy: ['side_business'],
    monetization_policy: {
      free_ratio: 0.3,
      price_band: [300, 1000],
      membership: false,
      paid_line_strategy: '無料パートで手順の全体像を示し、テンプレートは有料にする。',
    },
    posting_cadence: { times_per_week: 3, time_of_day: '毎週火・金・日の21:00' },
    first_themes: [{ title: '副業AI活用の始め方', hook: 'まず何をすればいいか迷う人向け' }],
    kpi_targets: { followers_30d: 100, articles_30d: 12, revenue_90d_jpy: 30000 },
    avatar_prompt: 'a photorealistic icon of a notebook, no text',
    header_prompt: 'a wide banner of a desk, no text',
    rationale: 'ニッチ特化と無料信頼構築の原則に基づく。',
  };
}

function makeClient(texts: string[]): LLMClient {
  let call = 0;
  const complete = async <T = string>(_a: LLMCompleteArgs): Promise<LLMCompleteResult<T>> => {
    const text = texts[Math.min(call, texts.length - 1)]!;
    call += 1;
    return {
      text: text as unknown as T,
      usage: { inputTokens: 300, outputTokens: 200 },
      costJpy: 0,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    };
  };
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
    template: 'note アカウント設計担当',
    version: 1,
    promptId: 'p-anp-strategist-1',
    genre: null,
  }));
}

function brief(overrides: Partial<NoteAccountDesignBrief> = {}): NoteAccountDesignBrief {
  return { idea: '副業×AIで会社員向けに稼ぎ方を発信する', persona_type: 'auto', ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe('planNoteAccountDesign', () => {
  it('NoteAccountDesign を返す', async () => {
    const client = makeClient([JSON.stringify(validDesign())]);
    const res = await planNoteAccountDesign(brief(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as PlanNoteAccountDesignDeps);
    expect(res.display_name_candidates).toHaveLength(3);
    expect(res.monetization_policy.price_band).toEqual([300, 1000]);
  });

  it('role=anp.strategist で呼ぶ', async () => {
    const client = makeClient([JSON.stringify(validDesign())]);
    const load = loadPromptStub();
    await planNoteAccountDesign(brief(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: load,
    } as PlanNoteAccountDesignDeps);
    const arg = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    expect(arg.role).toBe('anp.strategist');
  });

  it('不正な JSON は最大2回まで再試行し、2回目で成功する', async () => {
    const client = makeClient(['not json at all', JSON.stringify(validDesign())]);
    const res = await planNoteAccountDesign(brief(), {
      createAgentClient: vi.fn(async () => client),
      loadActivePrompt: loadPromptStub(),
    } as PlanNoteAccountDesignDeps);
    expect(res.bio).toContain('副業');
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it('2回とも不正な場合は AgentError を投げる', async () => {
    const client = makeClient(['not json', 'still not json']);
    await expect(
      planNoteAccountDesign(brief(), {
        createAgentClient: vi.fn(async () => client),
        loadActivePrompt: loadPromptStub(),
      } as PlanNoteAccountDesignDeps),
    ).rejects.toThrow(AgentError);
  });
});

describe('buildUserMessage', () => {
  it('idea を含める', () => {
    const msg = buildUserMessage(brief({ idea: 'メンタルケア×習慣化' }));
    expect(msg).toContain('メンタルケア×習慣化');
  });

  it('feedback があれば「必ず反映すること」の指示付きで含める', () => {
    const msg = buildUserMessage(brief({ feedback: 'もっとカジュアルなトーンにしたい' }));
    expect(msg).toContain('もっとカジュアルなトーンにしたい');
    expect(msg).toContain('必ず反映すること');
  });

  it('persona_type=person の希望をヒントに含める', () => {
    const msg = buildUserMessage(brief({ persona_type: 'person' }));
    expect(msg).toContain('人物型');
  });
});

describe('generateNoteAccountDesignImages', () => {
  it('persona_type=person のとき実写・顔なしルールを avatar/header プロンプトに付加する', async () => {
    const genImage = vi.fn(async (_args: { prompt: string }) => ({
      images: [Buffer.from('img')],
      costJpy: 0,
      usage: { imageCount: 1 },
    }));
    await generateNoteAccountDesignImages(
      { avatar_prompt: 'アイコン', header_prompt: 'ヘッダー', persona_type: 'person' },
      { generateImage: genImage } as GenerateNoteAccountDesignImagesDeps,
    );
    expect(genImage).toHaveBeenCalledTimes(2);
    const avatarArgs = genImage.mock.calls[0]![0] as { prompt: string };
    const headerArgs = genImage.mock.calls[1]![0] as { prompt: string };
    expect(avatarArgs.prompt).toContain('顔は絶対に描かない');
    expect(headerArgs.prompt).toContain('顔は絶対に描かない');
  });

  it('persona_type=brand のとき人物描写ルールを付加しない', async () => {
    const genImage = vi.fn(async (_args: { prompt: string }) => ({
      images: [Buffer.from('img')],
      costJpy: 0,
      usage: { imageCount: 1 },
    }));
    await generateNoteAccountDesignImages(
      { avatar_prompt: 'ロゴ', header_prompt: '世界観', persona_type: 'brand' },
      { generateImage: genImage } as GenerateNoteAccountDesignImagesDeps,
    );
    const avatarArgs = genImage.mock.calls[0]![0] as { prompt: string };
    expect(avatarArgs.prompt).not.toContain('顔は絶対に描かない');
  });

  it('画像が生成できない場合はエラーを投げる', async () => {
    const genImage = vi.fn(async (_args: { prompt: string }) => ({
      images: [],
      costJpy: 0,
      usage: { imageCount: 0 },
    }));
    await expect(
      generateNoteAccountDesignImages(
        { avatar_prompt: 'a', header_prompt: 'b', persona_type: 'brand' },
        { generateImage: genImage } as GenerateNoteAccountDesignImagesDeps,
      ),
    ).rejects.toThrow('画像生成結果が空です');
  });
});
