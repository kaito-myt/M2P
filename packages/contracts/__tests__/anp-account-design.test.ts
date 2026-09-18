import { describe, expect, it } from 'vitest';

import {
  NOTE_HANDLE_PATTERN,
  NoteAccountDesignBriefSchema,
  NoteAccountDesignSchema,
} from '../src/agents/anp.js';

/**
 * docs/11-anp-design.md §3.1/§7 F-ANP-01/03 — note アカウント設計の契約テスト。
 */

function validDesign() {
  return {
    display_name_candidates: ['副業AIラボ', 'AI副業ノート', '週末AI副業部'],
    handle_candidates: ['ai_fukugyo_lab', 'ai_side_note', 'weekend_ai_biz'],
    bio: '会社員の週末副業×AI活用を発信します。',
    concept: '副業初心者がAIで最初の1万円を稼ぐまでを伴走するアカウント。',
    target_reader: '副業に興味がある会社員',
    tone: '親しみやすい・断定的',
    persona_type: 'person' as const,
    character_sheet: '名前は「たくみ」、30代前半の会社員。'.repeat(10).slice(0, 500),
    content_pillars: [
      { name: 'AIツール活用術', description: '毎日使えるAIツール紹介', example_titles: ['a', 'b', 'c'] },
    ],
    genre_policy: ['side_business', 'business'],
    monetization_policy: {
      free_ratio: 0.3,
      price_band: [300, 1000] as [number, number],
      membership: false,
      paid_line_strategy: '無料パートで手順の全体像を示し、テンプレートは有料にする。',
    },
    posting_cadence: { times_per_week: 3, time_of_day: '毎週火・金・日の21:00' },
    first_themes: [
      { title: '副業AI活用の始め方', hook: 'まず何をすればいいか迷う人向け' },
    ],
    kpi_targets: { followers_30d: 100, articles_30d: 12, revenue_90d_jpy: 30000 },
    avatar_prompt: 'a photorealistic icon, no text',
    header_prompt: 'a wide banner, no text',
    rationale: 'ニッチ特化と無料信頼構築の原則に基づく。',
  };
}

describe('NoteAccountDesignBriefSchema', () => {
  it('idea のみでも通る (他は任意)', () => {
    const parsed = NoteAccountDesignBriefSchema.parse({ idea: '副業×AIで稼ぐ' });
    expect(parsed.idea).toBe('副業×AIで稼ぐ');
    expect(parsed.persona_type).toBe('auto');
  });

  it('idea が空文字だと拒否される', () => {
    expect(() => NoteAccountDesignBriefSchema.parse({ idea: '' })).toThrow();
  });

  it('feedback フィールドを保持する (フィードバック再生成用)', () => {
    const parsed = NoteAccountDesignBriefSchema.parse({
      idea: '副業×AI',
      feedback: 'もっとカジュアルなトーンにしたい',
    });
    expect(parsed.feedback).toBe('もっとカジュアルなトーンにしたい');
  });
});

describe('NoteAccountDesignSchema', () => {
  it('妥当な設計案を受け入れる', () => {
    const parsed = NoteAccountDesignSchema.parse(validDesign());
    expect(parsed.display_name_candidates).toHaveLength(3);
    expect(parsed.monetization_policy.price_band).toEqual([300, 1000]);
  });

  it('persona_type=brand のとき character_sheet は null でよい', () => {
    const parsed = NoteAccountDesignSchema.parse({
      ...validDesign(),
      persona_type: 'brand',
      character_sheet: null,
    });
    expect(parsed.character_sheet).toBeNull();
  });

  it('display_name_candidates が空配列だと拒否される', () => {
    expect(() => NoteAccountDesignSchema.parse({ ...validDesign(), display_name_candidates: [] })).toThrow();
  });

  it('content_pillars が無いと拒否される', () => {
    const d = validDesign() as Record<string, unknown>;
    delete d.content_pillars;
    expect(() => NoteAccountDesignSchema.parse(d)).toThrow();
  });
});

describe('NOTE_HANDLE_PATTERN', () => {
  it('半角英数字とアンダースコアのみ許可する', () => {
    expect(NOTE_HANDLE_PATTERN.test('ai_fukugyo_lab')).toBe(true);
    expect(NOTE_HANDLE_PATTERN.test('ai-fukugyo')).toBe(false);
    expect(NOTE_HANDLE_PATTERN.test('あいう')).toBe(false);
    expect(NOTE_HANDLE_PATTERN.test('')).toBe(false);
  });
});
