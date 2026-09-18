/**
 * F-051 — promoter エージェントのユーザーメッセージ組み立て単体テスト。
 * 運営者要望「投稿にSNSのキャラクター性が出るように」— character_sheet の反映を確認する。
 */
import { describe, expect, it, vi } from 'vitest';

import type { PromotionInput } from '@a2p/contracts/agents/promoter';

vi.mock('@a2p/db', () => ({
  prisma: {
    prompt: { findFirst: vi.fn() },
    tokenUsage: { create: vi.fn() },
    modelAssignment: { findFirst: vi.fn() },
    apiCredential: { findUnique: vi.fn() },
  },
}));

const { buildUserMessage } = await import('../../src/promoter/index.js');

function input(overrides: Partial<PromotionInput> = {}): PromotionInput {
  return {
    bookId: 'book-1',
    genre: null,
    playbook_guidance: '',
    character_sheet: '',
    book: {
      title: '朝1分の習慣術',
      keywords: [],
      author: '著者名',
    },
    ...overrides,
  };
}

describe('promoter buildUserMessage', () => {
  it('character_sheet があればキャラクター設定セクションと反映指示を入れる', () => {
    const msg = buildUserMessage(input({ character_sheet: '口癖: なんだよね' }));
    expect(msg).toContain('【キャラクター設定');
    expect(msg).toContain('口癖: なんだよね');
    expect(msg).toContain('自分語りは全体の2〜3割まで');
  });

  it('character_sheet が空ならキャラクター設定セクションを入れない', () => {
    const msg = buildUserMessage(input({ character_sheet: '' }));
    expect(msg).not.toContain('【キャラクター設定');
  });

  it('note_article の第三者視点ルールは character_sheet 追加後も維持される', () => {
    const msg = buildUserMessage(input({ character_sheet: '口癖: なんだよね' }));
    expect(msg).toContain('著者本人');
    expect(msg).toContain('書いてはいけない');
  });
});
