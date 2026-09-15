/**
 * ANP Writer (`src/anp/writer.ts`) 単体テスト。
 * 重点: `<<<PAYWALL>>>` マーカーの split/insert 往復整合性・絵文字 codepoint 安全性・
 * マーカー欠落/重複時の挙動 (code-reviewer REQUEST_CHANGES 対応)。
 */
import { describe, expect, it, vi } from 'vitest';

import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient, LLMCompleteArgs, LLMCompleteResult } from '@a2p/contracts/agents';
import type { NoteWriterInput } from '@a2p/contracts/agents/anp';

// Prisma を引かないよう @a2p/db を mock。
vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelCatalog: { findFirst: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { PAYWALL_MARKER, splitPaywallMarker, generateNoteBody } = await import(
  '../../src/anp/writer.js'
);
const { insertMarker } = await import('../../src/anp/editor.js');

// ---------------------------------------------------------------------------
// 1. splitPaywallMarker — 純粋関数の挙動
// ---------------------------------------------------------------------------

describe('splitPaywallMarker', () => {
  it('paid=false はマーカー処理をせずそのまま返す', () => {
    const r = splitPaywallMarker('本文のみ', false);
    expect(r).toEqual({ body: '本文のみ' });
  });

  it('paid=true でマーカー未検出なら paywallLinePos は undefined', () => {
    const r = splitPaywallMarker('マーカーなしの本文', true);
    expect(r.paywallLinePos).toBeUndefined();
    expect(r.body).toBe('マーカーなしの本文');
  });

  it('単一マーカー: 除去して codepoint 位置を返す', () => {
    const before = '無料パートの本文';
    const body = `${before}\n\n${PAYWALL_MARKER}\n\n有料パートの本文`;
    const r = splitPaywallMarker(body, true);
    expect(r.body).not.toContain(PAYWALL_MARKER);
    expect(r.body).not.toContain('**');
    expect(r.paywallLinePos).toBe([...`${before}\n\n`].length);
  });

  it('太字装飾付き (**<<<PAYWALL>>>**) も検出・除去する', () => {
    const body = `前半\n\n**${PAYWALL_MARKER}**\n\n後半`;
    const r = splitPaywallMarker(body, true);
    expect(r.body).not.toContain('*');
    expect(r.body).not.toContain(PAYWALL_MARKER);
    expect(r.paywallLinePos).toBeDefined();
  });

  it('マーカー重複時: 先頭位置を採用しつつ全出現を除去する', () => {
    const before = '前半テキスト';
    const body = `${before}\n\n${PAYWALL_MARKER}\n\n中盤${PAYWALL_MARKER}後半`;
    const r = splitPaywallMarker(body, true);
    expect(r.body).not.toContain(PAYWALL_MARKER);
    expect(r.paywallLinePos).toBe([...`${before}\n\n`].length);
  });

  it('絵文字 (サロゲートペア) を含む本文でも codepoint 位置が壊れない', () => {
    const before = '導入😀文字列';
    const body = `${before}\n\n${PAYWALL_MARKER}\n\n続き🎉テキスト`;
    const r = splitPaywallMarker(body, true);
    // codepoint 単位の位置 — サロゲートペアを 1 文字として数える
    expect(r.paywallLinePos).toBe([...`${before}\n\n`].length);
    // 絵文字自体は破壊されずそのまま本文に残る
    expect(r.body).toContain('😀');
    expect(r.body).toContain('🎉');
  });
});

// ---------------------------------------------------------------------------
// 2. splitPaywallMarker → insertMarker → splitPaywallMarker 往復整合性
// ---------------------------------------------------------------------------

describe('splitPaywallMarker と insertMarker の往復', () => {
  it('通常の日本語本文で位置と本文が完全一致する', () => {
    const original = `導入文です。\n\n${PAYWALL_MARKER}\n\n続きの本文です。`;
    const first = splitPaywallMarker(original, true);
    expect(first.paywallLinePos).toBeDefined();

    const reinserted = insertMarker(first.body, true, first.paywallLinePos);
    const second = splitPaywallMarker(reinserted, true);

    expect(second.paywallLinePos).toBe(first.paywallLinePos);
    expect(second.body).toBe(first.body);
  });

  it('絵文字を含む本文でも往復で位置・本文が保持される', () => {
    const original = `導入😀文\n\n${PAYWALL_MARKER}\n\n続き🎉本文`;
    const first = splitPaywallMarker(original, true);
    expect(first.paywallLinePos).toBeDefined();

    const reinserted = insertMarker(first.body, true, first.paywallLinePos);
    const second = splitPaywallMarker(reinserted, true);

    expect(second.paywallLinePos).toBe(first.paywallLinePos);
    expect(second.body).toBe(first.body);
    expect(second.body).toContain('😀');
    expect(second.body).toContain('🎉');
  });
});

// ---------------------------------------------------------------------------
// 3. generateNoteBody — マーカー欠落時は invalid_output として再試行し、尽きたら throw
// ---------------------------------------------------------------------------

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
        id: 'p-anp-writer-1',
        body: 'あなたは note ライターです。{niche} {target_reader} {tone} {theme_title} {theme_hook} {lead} {headings} {paid} {free_ratio} {target_chars} {feedback}',
        version: 1,
        genre: null,
      })),
    },
  };
}

function baseInput(overrides: Partial<NoteWriterInput> = {}): NoteWriterInput {
  return {
    note_article_id: 'art-1',
    account: { niche: '副業×AI', target_reader: '会社員', tone: '丁寧' },
    theme: { title: 'タイトル', hook: 'フック' },
    lead: 'リード文',
    headings: ['見出し1', '見出し2'],
    paid: true,
    target_chars: 4000,
    free_ratio: 0.3,
    ...overrides,
  };
}

describe('generateNoteBody — paywall marker missing', () => {
  it('paid=true でマーカー未検出の応答が続く場合、再試行を尽くして AgentError を throw する', async () => {
    const bodyWithoutMarker = 'マーカーが無い本文です。'.padEnd(300, 'あ');
    const text = JSON.stringify({ body_md: bodyWithoutMarker, char_count: 300 });
    const fakeClient = makeFakeClient(text);

    await expect(
      generateNoteBody(baseInput(), {
        createAgentClient: vi.fn(async () => fakeClient),
        promptLoaderDeps: { prisma: makePromptRepo() },
      }),
    ).rejects.toThrow(AgentError);

    // MAX_PARSE_RETRIES=2 回とも呼ばれ、editing に進めない (呼出側は例外を受けて Job=failed)。
    expect(fakeClient.complete).toHaveBeenCalledTimes(2);
  });

  it('paid=false の場合はマーカー欠落を問わず成功する', async () => {
    const body = '無料記事の本文です。'.padEnd(300, 'あ');
    const text = JSON.stringify({ body_md: body, char_count: 300 });
    const fakeClient = makeFakeClient(text);

    const result = await generateNoteBody(baseInput({ paid: false }), {
      createAgentClient: vi.fn(async () => fakeClient),
      promptLoaderDeps: { prisma: makePromptRepo() },
    });

    expect(result.paywall_line_pos).toBeUndefined();
    expect(fakeClient.complete).toHaveBeenCalledTimes(1);
  });

  it('F-ANP-31: related_books が渡された場合、書名がユーザーメッセージに含まれる', async () => {
    const body = '無料記事の本文です。'.padEnd(300, 'あ');
    const text = JSON.stringify({ body_md: body, char_count: 300 });
    const fakeClient = makeFakeClient(text);

    await generateNoteBody(
      baseInput({ paid: false, related_books: [{ title: '関連書籍タイトルA', asin: 'B012345678' }] }),
      {
        createAgentClient: vi.fn(async () => fakeClient),
        promptLoaderDeps: { prisma: makePromptRepo() },
      },
    );

    const call = (fakeClient.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0] as LLMCompleteArgs;
    const userMessage = call.messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('関連書籍タイトルA');
    expect(userMessage).toContain('さりげなく触れてよい');
  });
});
