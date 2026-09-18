import { describe, expect, it } from 'vitest';

import {
  MarketerThemeInputSchema,
  MarketerThemeOutputSchema,
  ThemeCompetitorSchema,
  ThemeSignalsSchema,
} from '../src/agents/marketer.js';

/**
 * 2026-09-16〜17: Marketer が competitors[].rank を "1位" のような文字列で返し、
 * 日次テーマ生成が 2 晩連続 schema validation failed で止まった障害の回帰テスト。
 */
describe('marketer schemas — 数値フィールドの寛容パース', () => {
  it('competitors[].rank は "1位" / "#3" / "12,000" / null を数値または undefined に倒す', () => {
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: '1位' }).rank).toBe(1);
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: '#3' }).rank).toBe(3);
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: '12,000' }).rank).toBe(12000);
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: 7 }).rank).toBe(7);
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: null }).rank).toBeUndefined();
    expect(ThemeCompetitorSchema.parse({ title: 'A', rank: '不明' }).rank).toBeUndefined();
  });

  it('signals の market_score / predicted_chapters は数値文字列を受け、上限違反は引き続き弾く', () => {
    const base = { reasoning: 'r', search_keywords: [] };
    expect(ThemeSignalsSchema.parse({ ...base, market_score: '82' }).market_score).toBe(82);
    expect(ThemeSignalsSchema.parse({ ...base, market_score: 82, predicted_chapters: '14章' }).predicted_chapters).toBe(14);
    expect(ThemeSignalsSchema.parse({ ...base, market_score: 82 }).predicted_chapters).toBe(8);
    expect(ThemeSignalsSchema.parse({ ...base, market_score: 82, search_volume: '約1,200', rank_estimate: 'top 50' })).toMatchObject({
      search_volume: 1200,
      rank_estimate: 50,
    });
    expect(ThemeSignalsSchema.safeParse({ ...base, market_score: '120' }).success).toBe(false);
    expect(ThemeSignalsSchema.safeParse({ ...base, market_score: 'high' }).success).toBe(false);
  });

  it('Marketer 出力全体: rank が文字列でも候補が通る (回帰)', () => {
    const out = MarketerThemeOutputSchema.safeParse({
      candidates: [
        {
          title: 'バズりたい女、清少納言',
          hook: '古典を現代の SNS 感覚で読み替えるラノベ',
          target_reader: '20-30 代の古典に興味がある読者',
          competitors: [{ title: '類書A', rank: '1位' }, { title: '類書B', rank: '#12' }],
          signals: { reasoning: 'r', market_score: '78', search_keywords: ['清少納言'] },
        },
      ],
    });
    expect(out.success).toBe(true);
  });

  it('keywordOrBrief は 4000 字まで受ける (2026-09-16 引き上げ)', () => {
    const r = MarketerThemeInputSchema.safeParse({ accountId: 'a', themeSessionId: 't', genre: null, keywordOrBrief: 'あ'.repeat(732), count: 1 });
    expect(r.success).toBe(true);
  });
});
