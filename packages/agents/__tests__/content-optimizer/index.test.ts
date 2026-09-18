/**
 * F-061 — content_optimizer ユーザーメッセージ組み立て単体テスト。
 * 運営者要望「投稿にSNSのキャラクター性が出るように」— character_sheet の反映を確認する。
 */
import { describe, expect, it } from 'vitest';

import type { ContentOptimizerInput } from '@a2p/contracts/agents/content-optimizer';

import { buildOptimizerUserMessage } from '../../src/content-optimizer/index.js';

function input(overrides: Partial<ContentOptimizerInput> = {}): ContentOptimizerInput {
  return {
    channel: 'x',
    genre: null,
    concept: '',
    tone_of_voice: '',
    content_pillars: [],
    persona: '',
    hashtag_core: [],
    recent_posted: [],
    drafts: [{ id: 'd1', kind: 'value', body: '元本文' }],
    playbook_guidance: '',
    character_sheet: '',
    ...overrides,
  };
}

describe('buildOptimizerUserMessage', () => {
  it('character_sheet があればキャラクター設定セクションと確認指示を入れる', () => {
    const msg = buildOptimizerUserMessage(input({ character_sheet: '口癖: なんだよね' }), 'X (旧 Twitter)');
    expect(msg).toContain('【キャラクター設定');
    expect(msg).toContain('口癖: なんだよね');
    expect(msg).toContain('最低1つ表れているか確認');
  });

  it('character_sheet が空ならキャラクター設定セクションを入れない', () => {
    const msg = buildOptimizerUserMessage(input({ character_sheet: '' }), 'X (旧 Twitter)');
    expect(msg).not.toContain('【キャラクター設定');
  });
});
