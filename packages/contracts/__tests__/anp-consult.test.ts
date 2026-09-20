/**
 * F-ANP-04 — AI 相談のブリーフ草案 → 設計ブリーフ変換と出力スキーマ。
 */
import { describe, expect, it } from 'vitest';

import {
  briefDraftToDesignBrief,
  NoteAccountConsultOutputSchema,
  NoteAccountConsultResearchPlanSchema,
} from '../src/agents/anp';

describe('briefDraftToDesignBrief', () => {
  it('idea が無ければ null', () => {
    expect(briefDraftToDesignBrief({})).toBeNull();
    expect(briefDraftToDesignBrief({ idea: '   ' })).toBeNull();
  });

  it('空文字のフィールドを落とし persona_type は auto 既定', () => {
    const brief = briefDraftToDesignBrief({
      idea: ' 副業×AI ',
      goal: '',
      target_reader_hint: '30代会社員',
      reference_accounts: [' @a ', '', 'https://note.com/b'],
    });
    expect(brief).toEqual({
      idea: '副業×AI',
      target_reader_hint: '30代会社員',
      persona_type: 'auto',
      reference_accounts: ['@a', 'https://note.com/b'],
    });
  });
});

describe('NoteAccountConsultOutputSchema', () => {
  it('reply のみでも既定値で通る', () => {
    const out = NoteAccountConsultOutputSchema.parse({ reply: 'ok' });
    expect(out.brief_draft).toEqual({});
    expect(out.ready_to_design).toBe(false);
    expect(out.suggested_questions).toEqual([]);
  });

  it('リサーチ計画は queries 最大 3 件', () => {
    expect(NoteAccountConsultResearchPlanSchema.safeParse({ queries: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(NoteAccountConsultResearchPlanSchema.parse({}).queries).toEqual([]);
  });
});
