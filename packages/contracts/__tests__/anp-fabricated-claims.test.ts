import { describe, expect, it } from 'vitest';

import {
  claimsAggregationTheme,
  claimsPopulationStat,
  dropAggregationThemes,
  mergeNoteAccountSettings,
  NoteAccountSettingsSchema,
  resolveDataSource,
} from '../src/agents/anp.js';
import {
  AGGREGATION_CLAIM_TITLES,
  OWN_LOG_SENTENCES,
  POPULATION_STAT_SENTENCES,
  PROCEDURE_TITLES,
} from './fixtures/anp-fabricated-claims.js';

// 全て 2026-10-19 時点の本番公開記事の原文 (fixtures の冒頭コメント参照)。
describe('claimsPopulationStat (F-ANP-58)', () => {
  it.each(POPULATION_STAT_SENTENCES)('母集団の統計を所見として書いている: %s', (s) => {
    const r = claimsPopulationStat(s);
    expect(r.claims).toBe(true);
    expect(r.hits[0]?.reason).toBeTruthy();
  });

  it.each(OWN_LOG_SENTENCES)('著者自身の作業ログ・題材としての架空は巻き込まない: %s', (s) => {
    expect(claimsPopulationStat(s)).toEqual({ claims: false, hits: [] });
  });

  it('「架空」と開示していても、開示していなくても同じく検出する (開示語で弾かない)', () => {
    const disclosed = '今回の架空例では、6年合計の複勝率は38.3%ですが、各年の対象件数は18〜22件。';
    const silent = '6年合計の複勝率は38.3%ですが、各年の対象件数は18〜22件。';
    expect(claimsPopulationStat(disclosed).claims).toBe(true);
    expect(claimsPopulationStat(silent).claims).toBe(true);
  });

  it('本文全体から当たった文だけを理由つきで返す', () => {
    const body = [
      ...OWN_LOG_SENTENCES.slice(0, 3),
      POPULATION_STAT_SENTENCES[1]!,
      ...OWN_LOG_SENTENCES.slice(3, 5),
      POPULATION_STAT_SENTENCES[4]!,
    ].join('\n\n');
    const r = claimsPopulationStat(body);
    expect(r.claims).toBe(true);
    expect(r.hits.map((h) => h.sentence)).toEqual([POPULATION_STAT_SENTENCES[1], POPULATION_STAT_SENTENCES[4]]);
  });

  it('作業ログだけの本文は何も検出しない', () => {
    expect(claimsPopulationStat(OWN_LOG_SENTENCES.join('\n\n')).claims).toBe(false);
  });
});

describe('claimsAggregationTheme (F-ANP-58)', () => {
  it.each(AGGREGATION_CLAIM_TITLES)('集計した結果を売る仮題: %s', (t) => {
    expect(claimsAggregationTheme(t).claims).toBe(true);
  });

  it.each(PROCEDURE_TITLES)('手順・判断基準・自分の記録は通す: %s', (t) => {
    expect(claimsAggregationTheme(t)).toEqual({ claims: false, hits: [] });
  });

  it('フックだけが集計を売っていても検出し、どちらの項目かを返す', () => {
    const r = claimsAggregationTheme(PROCEDURE_TITLES[2]!, AGGREGATION_CLAIM_TITLES[3]!);
    expect(r.claims).toBe(true);
    expect(r.hits.map((h) => h.field)).toEqual(['hook']);
  });
});

describe('dropAggregationThemes (F-ANP-58)', () => {
  const candidates = [
    ...AGGREGATION_CLAIM_TITLES.map((title) => ({ title, hook: '' })),
    ...PROCEDURE_TITLES.map((title) => ({ title, hook: '' })),
  ];

  it('データ源が無いと集計企画だけを理由つきで落とす', () => {
    const { kept, dropped } = dropAggregationThemes(candidates, null);
    expect(dropped.map((d) => d.title)).toEqual([...AGGREGATION_CLAIM_TITLES]);
    expect(dropped.every((d) => d.reasons.length > 0)).toBe(true);
    expect(kept.map((k) => k.title)).toEqual([...PROCEDURE_TITLES]);
  });

  it('データ源を宣言していれば何も落とさない', () => {
    const { kept, dropped } = dropAggregationThemes(candidates, 'JRA-VAN 過去10年');
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(candidates.length);
  });
});

describe('settings_json.data_source (F-ANP-58)', () => {
  it('既知キーなので保存 (mergeNoteAccountSettings) で消えない', () => {
    const current = { data_source: 'JRA-VAN 過去10年', engage_usage: { day: 'x', follow: 1, like: 1 } };
    const next = NoteAccountSettingsSchema.parse({ data_source: 'JRA-VAN 過去10年' });
    expect(mergeNoteAccountSettings(current, next)).toEqual(current);
  });

  it('未設定・空白のみ・不正値は「データ源なし」', () => {
    for (const v of [undefined, null, {}, { data_source: '' }, { data_source: '   ' }, { data_source: 5 }]) {
      expect(resolveDataSource(v)).toBeNull();
    }
    expect(resolveDataSource({ data_source: ' JRA-VAN ' })).toBe('JRA-VAN');
  });
});
