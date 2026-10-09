/**
 * ANP 数値校正 (`src/anp/numcheck.ts`) 単体テスト。
 *
 * 重点は**この工程に本文を書き換えさせすぎない**ことの保証。
 * 数字を直すためのエージェントが構成まで書き直して返しても採用しないこと、
 * 採用しなかった場合に入力本文を素通しして**記事を落とさない**ことを固定する。
 */
import { describe, expect, it, vi } from 'vitest';

import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteNumCheckInput } from '@a2p/contracts/agents/anp';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { checkNoteNumbers, headingsOf, isAcceptableCorrection, MAX_LENGTH_DRIFT } = await import(
  '../../src/anp/numcheck.js'
);
const { PAYWALL_MARKER } = await import('../../src/anp/writer.js');

const LF = String.fromCharCode(10);
const PARA = LF + LF;

const BODY = [
  '## 前提の整理',
  '対象は2024年の全レースです。内訳は48件と99件で、合計147件でした。',
  '## 手順の分解',
  '実際にやった順に並べます。'.padEnd(400, 'あ'),
  '## 判断の基準',
  '複勝率は32.7%でした。'.padEnd(400, 'い'),
].join(PARA);

function makeFakeClient(text: string): LLMClient {
  const completeImpl = async <T = string>(
    _args: LLMCompleteArgs,
  ): Promise<LLMCompleteResult<T>> => ({
    text: text as T,
    usage: { inputTokens: 100, outputTokens: 200 },
    costJpy: 0,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
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
        id: 'p-anp-numcheck-1',
        body: 'あなたは数値校正担当です。{niche} {title} {paid}',
        version: 1,
        genre: null,
      })),
    },
  };
}

function baseInput(overrides: Partial<NoteNumCheckInput> = {}): NoteNumCheckInput {
  return {
    note_article_id: 'art-1',
    account: { niche: '競馬', target_reader: '週末派', tone: '丁寧' },
    title: 'タイトル',
    body_md: BODY,
    paid: false,
    ...overrides,
  };
}

function run(input: NoteNumCheckInput, client: LLMClient) {
  return checkNoteNumbers(input, {
    createAgentClient: vi.fn(async () => client),
    promptLoaderDeps: { prisma: makePromptRepo() },
  });
}

describe('headingsOf / isAcceptableCorrection', () => {
  it('見出しだけを順序つきで拾い、マーカー行は無視する', () => {
    const withMarker = `## A${PARA}${PAYWALL_MARKER}${PARA}## B`;
    expect(headingsOf(withMarker)).toEqual(['A', 'B']);
    expect(headingsOf(BODY)).toEqual(['前提の整理', '手順の分解', '判断の基準']);
  });

  it('数字だけの差し替えは受け入れる', () => {
    const after = BODY.replace('合計147件', '合計148件');
    expect(isAcceptableCorrection(BODY, after)).toEqual({ ok: true });
  });

  it('見出しが増減・改名したら受け入れない', () => {
    expect(isAcceptableCorrection(BODY, `${BODY}${PARA}## まとめ${PARA}以上です。`).ok).toBe(false);
    expect(isAcceptableCorrection(BODY, BODY.replace('## 判断の基準', '## 判断のしかた')).ok).toBe(
      false,
    );
  });

  it(`本文長が ±${MAX_LENGTH_DRIFT * 100}% を超えて動いたら受け入れない`, () => {
    const padded = BODY + 'う'.repeat(Math.ceil([...BODY].length * 0.3));
    expect(isAcceptableCorrection(BODY, padded).ok).toBe(false);
    const halved = [...BODY].slice(0, Math.floor([...BODY].length / 2)).join('');
    expect(isAcceptableCorrection(BODY, halved).ok).toBe(false);
  });
});

describe('checkNoteNumbers', () => {
  it('数字を直した出力は採用し、fixes をそのまま返す', async () => {
    const fixed = BODY.replace('合計147件', '合計147件 (内訳 48 + 99)');
    const client = makeFakeClient(
      JSON.stringify({ body_md: fixed, fixes: ['合計の内訳を明示'], unresolved: [] }),
    );

    const result = await run(baseInput(), client);

    expect(result.applied).toBe(true);
    expect(result.body_md).toBe(fixed);
    expect(result.fixes).toEqual(['合計の内訳を明示']);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it('直すところが無い場合は本文がそのまま返り fixes は空', async () => {
    const client = makeFakeClient(JSON.stringify({ body_md: BODY, fixes: [], unresolved: [] }));

    const result = await run(baseInput(), client);

    expect(result.applied).toBe(true);
    expect(result.body_md).toBe(BODY);
    expect(result.fixes).toEqual([]);
  });

  it('構成まで書き直した出力は採用せず、入力本文を素通しする', async () => {
    // 見出しを増やして返してくるケース。採用すると記事の構成が壊れる。
    const rewritten = `${BODY}${PARA}## まとめ${PARA}${'え'.repeat(600)}`;
    const client = makeFakeClient(
      JSON.stringify({ body_md: rewritten, fixes: ['いろいろ直した'], unresolved: [] }),
    );

    const result = await run(baseInput(), client);

    expect(result.applied).toBe(false);
    expect(result.body_md).toBe(BODY);
    expect(result.fixes).toEqual([]);
    expect(result.unresolved[0]).toContain('適用できなかった');
    // 1 回目は再試行し、2 回目も駄目なら素通しする。
    expect(client.complete).toHaveBeenCalledTimes(2);
  });

  it('JSON が壊れていても例外を投げず、入力本文を素通しする (記事を落とさない)', async () => {
    const client = makeFakeClient('これは JSON ではありません');

    const result = await run(baseInput(), client);

    expect(result.applied).toBe(false);
    expect(result.body_md).toBe(BODY);
    expect(result.unresolved[0]).toContain('適用できなかった');
  });

  it('有料記事はマーカーを渡し、返ってきた位置を再抽出する', async () => {
    const paywallPos = [...BODY].findIndex((_, i) => i === 300);
    const withMarker = (() => {
      const chars = [...BODY];
      return `${chars.slice(0, paywallPos).join('')}${PARA}${PAYWALL_MARKER}${PARA}${chars
        .slice(paywallPos)
        .join('')}`;
    })();
    const client = makeFakeClient(
      JSON.stringify({ body_md: withMarker, fixes: [], unresolved: [] }),
    );

    const result = await run(baseInput({ paid: true, paywall_line_pos: paywallPos }), client);

    expect(result.applied).toBe(true);
    expect(result.body_md).not.toContain(PAYWALL_MARKER);
    expect(result.paywall_line_pos).toBeDefined();

    const args = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    const userMessage = args.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain(PAYWALL_MARKER);
    expect(userMessage).toContain('無料部分と有料部分で同じ項目の数字が違っていないか');
  });

  it('有料記事でマーカーが返ってこなければ採用しない (位置ズレで課金事故になる)', async () => {
    const paywallPos = 300;
    const client = makeFakeClient(JSON.stringify({ body_md: BODY, fixes: [], unresolved: [] }));

    const result = await run(baseInput({ paid: true, paywall_line_pos: paywallPos }), client);

    expect(result.applied).toBe(false);
    expect(result.body_md).toBe(BODY);
    expect(result.paywall_line_pos).toBe(paywallPos);
  });

  it('無料記事のプロンプトには確認項目が並ぶ', async () => {
    const client = makeFakeClient(JSON.stringify({ body_md: BODY, fixes: [], unresolved: [] }));

    await run(baseInput(), client);

    const args = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    const userMessage = args.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('表の内訳を実際に足して');
    expect(userMessage).toContain('件数 ÷ 母数');
    expect(userMessage).toContain('見出し・構成・段落の数は変えない');
    expect(userMessage).not.toContain(PAYWALL_MARKER);
  });
});
