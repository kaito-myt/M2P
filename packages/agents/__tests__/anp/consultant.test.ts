/**
 * F-ANP-04 — anp.consultant (note アカウント戦略の AI 相談) エージェント単体テスト。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteAccountConsultResearchItem } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { consultNoteAccount, buildReplyUserMessage, buildResearchPlanUserMessage } = await import(
  '../../src/anp/consultant.js'
);
import type { ConsultNoteAccountDeps } from '../../src/anp/consultant.js';

function validReply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    reply: '副業ニッチなら「会社員×AI 時短」が有望です。次に決めるのは読者の年代です。',
    brief_draft: { idea: '会社員向け AI 時短副業', persona_type: 'person' },
    ready_to_design: false,
    suggested_questions: ['30代会社員で決めます', '競合をもう少し調べて'],
    ...overrides,
  });
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
    template: 'note アカウント戦略アドバイザー',
    version: 1,
    promptId: 'p-anp-consultant-1',
    genre: null,
  }));
}

function deps(client: LLMClient, extra: Partial<ConsultNoteAccountDeps> = {}): ConsultNoteAccountDeps {
  return {
    createAgentClient: vi.fn(async () => client),
    loadActivePrompt: loadPromptStub(),
    // 既定: Tavily キー無し (= リサーチ段階を飛ばす)
    resolveTavilyKey: async () => null,
    ...extra,
  } as ConsultNoteAccountDeps;
}

const input = { history: [], message: '副業系で note を始めたい', briefDraft: {} };

beforeEach(() => vi.clearAllMocks());

describe('consultNoteAccount', () => {
  it('Tavily キー無しなら 1 回の LLM 呼出で返答と草案を返す', async () => {
    const client = makeClient([validReply()]);
    const res = await consultNoteAccount(input, deps(client));
    expect(res.output.reply).toContain('副業');
    expect(res.output.brief_draft.idea).toBe('会社員向け AI 時短副業');
    expect(res.output.suggested_questions).toHaveLength(2);
    expect(res.research).toEqual([]);
    expect(client.complete).toHaveBeenCalledTimes(1);
    const arg = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    expect(arg.role).toBe('anp.consultant');
  });

  it('リサーチ計画でクエリが出たら検索し、結果を返答プロンプトに注入する', async () => {
    const plan = JSON.stringify({ queries: ['note 副業 有料記事 人気', 'note AI 時短 会社員'], reason: '競合確認' });
    const client = makeClient([plan, validReply({ ready_to_design: true })]);
    const search = vi.fn(async (query: string): Promise<NoteAccountConsultResearchItem[]> => [
      { query, title: `${query} の結果`, url: `https://note.com/${encodeURIComponent(query)}`, snippet: '要約' },
    ]);
    const res = await consultNoteAccount(input, deps(client, { search }));
    expect(search).toHaveBeenCalledTimes(2);
    expect(res.research).toHaveLength(2);
    expect(res.output.ready_to_design).toBe(true);
    expect(client.complete).toHaveBeenCalledTimes(2);
    const replyArg = (client.complete as ReturnType<typeof vi.fn>).mock.calls[1]![0] as LLMCompleteArgs;
    const userMsg = replyArg.messages[1]!.content as string;
    expect(userMsg).toContain('Web リサーチ結果 (Tavily 検索');
    expect(userMsg).toContain('note 副業 有料記事 人気 の結果');
  });

  it('リサーチ計画が空配列なら検索しない', async () => {
    const client = makeClient([JSON.stringify({ queries: [] }), validReply()]);
    const search = vi.fn(async () => []);
    const res = await consultNoteAccount(input, deps(client, { search }));
    expect(search).not.toHaveBeenCalled();
    expect(res.research).toEqual([]);
  });

  it('検索の失敗は返答を止めない', async () => {
    const client = makeClient([JSON.stringify({ queries: ['x'] }), validReply()]);
    const search = vi.fn(async () => {
      throw new Error('tavily down');
    });
    const res = await consultNoteAccount(input, deps(client, { search }));
    expect(res.output.reply.length).toBeGreaterThan(0);
    expect(res.research).toEqual([]);
  });

  it('不正な JSON は最大 2 回まで再試行し、2 回目で成功する', async () => {
    const client = makeClient(['not json', validReply()]);
    const res = await consultNoteAccount(input, deps(client));
    expect(res.output.reply).toContain('副業');
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it('2 回とも不正なら AgentError', async () => {
    const client = makeClient(['not json', 'still not json']);
    await expect(consultNoteAccount(input, deps(client))).rejects.toThrow(AgentError);
  });
});

describe('prompt builders', () => {
  it('buildReplyUserMessage は履歴・草案・新メッセージを含める', () => {
    const msg = buildReplyUserMessage({
      history: [
        { role: 'operator', content: '副業で始めたい' },
        { role: 'advisor', content: 'どの読者ですか' },
      ],
      message: '30代会社員',
      briefDraft: { idea: '副業' },
      research: [],
    });
    expect(msg).toContain('運営者: 副業で始めたい');
    expect(msg).toContain('アドバイザー: どの読者ですか');
    expect(msg).toContain('"idea": "副業"');
    expect(msg).toContain('30代会社員');
    expect(msg).toContain('(今回は検索していない)');
  });

  it('buildResearchPlanUserMessage は JSON 形式の指示を含める', () => {
    const msg = buildResearchPlanUserMessage({ history: [], message: '競合を調べて', briefDraft: {} });
    expect(msg).toContain('"queries"');
    expect(msg).toContain('競合を調べて');
    expect(msg).toContain('(履歴なし');
  });
});
