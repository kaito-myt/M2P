/**
 * [F-ANP-53] note タイトルの型ローテーション単体テスト。
 *
 * 守りたい性質は 1 つ: **同じ型に収束しない**。2026-10-13 の実測で 100 本中 96 本が
 * `X｜Y` 形になっていた (プロンプトは「型を毎回変える」と書いてあったのに、である)。
 */
import { describe, expect, it } from 'vitest';

import {
  GENRE_TITLE_PATTERNS,
  TITLE_PATTERNS,
  barRatio,
  patternsForNiche,
  enforceTitlePattern,
  pickTitlePattern,
  recurringPhrases,
} from '../../src/anp/title-style.js';

/** 2026-10-13 時点の本番タイトル (実物)。全部が同じ型。 */
const REAL_RECENT = [
  '競馬の馬券を休む目安｜週末派が月の収支で確認する4項目',
  '競馬予想が外れた原因は？｜週末派が使う5分類の検証シート',
  '前走からの馬体重増減で買い目を変える？｜週末派の48,239頭検証',
  '競馬の週末予算5,000円｜週末派が買うレース数を決める3基準',
  '前走4角位置は短距離で12.7ポイント差｜週末派の6年・次走複勝率',
  '競馬の継続騎乗、週末派は買う？｜2023年・13,597頭の人気別比較',
  '競馬の競走除外、週末派は買い目をどうする？｜購入前の5ステップ',
  '芝の開催後半、先行馬を買う人へ｜6年で複勝率34.9%',
  '牝馬限定戦の見送り基準｜週末派へ、6年・1,842戦の頭数とクラス',
  '競馬の買い目点数を減らす｜週末派の3連単6点→2点の組み方',
];

describe('TITLE_PATTERNS', () => {
  it('キーが一意で、必要な項目が揃っている', () => {
    const keys = TITLE_PATTERNS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of TITLE_PATTERNS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.rule.length).toBeGreaterThan(10);
      expect(p.examples.length).toBeGreaterThanOrEqual(2);
      // 見本は自分の型どおりでなければ、型の説明と矛盾した例を見せることになる。
      for (const e of p.examples) expect(e.includes('｜')).toBe(p.usesBar);
    }
  });

  it('`｜` を使う型は全体の一部だけ (「全部が ｜」を構造的に不可能にする)', () => {
    const bar = TITLE_PATTERNS.filter((p) => p.usesBar).length;
    expect(bar).toBeGreaterThanOrEqual(1);
    expect(bar / TITLE_PATTERNS.length).toBeLessThanOrEqual(0.25);
  });
});

describe('pickTitlePattern', () => {
  it('同じ記事 id なら常に同じ型 (再実行で揺れない)', () => {
    expect(pickTitlePattern('art-123').key).toBe(pickTitlePattern('art-123').key);
  });

  it('記事が違えば型が散る (20 件で 4 種類以上)', () => {
    const keys = new Set(Array.from({ length: 20 }, (_, i) => pickTitlePattern(`cmv05${i}abc`).key));
    expect(keys.size).toBeGreaterThanOrEqual(4);
  });

  it('直近が `｜` だらけなら `｜` の型を飛ばす (偏りが自動で戻る)', () => {
    expect(barRatio(REAL_RECENT)).toBe(1);
    for (let i = 0; i < 30; i += 1) {
      expect(pickTitlePattern(`art-${String(i)}`, REAL_RECENT).usesBar).toBe(false);
    }
  });

  it('直近に `｜` が少なければ `｜` の型も回ってくる', () => {
    const noBar = ['売上0円のまま10点出品して分かったこと', '最初にやるべきは自己紹介動画です'];
    const keys = new Set(
      Array.from({ length: 30 }, (_, i) => pickTitlePattern(`art-${String(i)}`, noBar).key),
    );
    expect([...keys].some((k) => TITLE_PATTERNS.find((p) => p.key === k)?.usesBar)).toBe(true);
  });
});

describe('recurringPhrases', () => {
  it('本番タイトルから「週末派」の繰り返しを見つける', () => {
    const phrases = recurringPhrases(REAL_RECENT, { exclude: ['競馬予想'] });
    expect(phrases.some((p) => p.includes('週末派'))).toBe(true);
  });

  it('ニッチ名は指摘しない (検索キーワードなので繰り返して当然)', () => {
    const phrases = recurringPhrases(REAL_RECENT, { exclude: ['競馬予想'] });
    expect(phrases).not.toContain('競馬予想');
  });

  it('短い断片は長い言い回しに吸収される', () => {
    const phrases = recurringPhrases(REAL_RECENT, { exclude: ['競馬予想'] });
    // 「週末派」が採られたなら、その部分文字列である「末派」は別立てで返さない。
    if (phrases.some((p) => p.includes('週末派'))) expect(phrases).not.toContain('末派');
  });

  it('件数が少なすぎるときは何も言わない (偶然の一致で縛らない)', () => {
    expect(recurringPhrases(['あいうえお', 'あいうえお'])).toEqual([]);
  });

  it('繰り返しが無ければ空', () => {
    expect(
      recurringPhrases([
        '売上0円のまま10点出品して分かったこと',
        '最初にやるべきは自己紹介動画です',
        '3か月で5万円溶かして、やっと休めた',
        'ChatGPTとClaude、両方に課金して10日',
      ]),
    ).toEqual([]);
  });
});

describe('enforceTitlePattern', () => {
  const noBarPattern = TITLE_PATTERNS.find((p) => !p.usesBar)!;
  const barPattern = TITLE_PATTERNS.find((p) => p.usesBar)!;

  it('型どおりなら何もしない', () => {
    const out = { title: '売上0円のまま10点出品して分かったこと', title_alternatives: ['別案A'] };
    expect(enforceTitlePattern(out, noBarPattern)).toBe(out);
  });

  it('`｜` 形に戻ってしまったら、型どおりの代替案と入れ替える', () => {
    const out = {
      title: '競馬の馬券を休む目安｜週末派が月の収支で確認する4項目',
      title_alternatives: ['休む日を決めたら、月の収支が初めてプラスになった', 'まだ｜付きの案'],
    };
    const fixed = enforceTitlePattern(out, noBarPattern);
    expect(fixed.title).toBe('休む日を決めたら、月の収支が初めてプラスになった');
    // 元のタイトルは代替案として残す (捨てない)。
    expect(fixed.title_alternatives).toContain('競馬の馬券を休む目安｜週末派が月の収支で確認する4項目');
  });

  it('代替案にも型どおりのものが無ければ書き換えない (文章を捏造しない)', () => {
    const out = { title: 'A｜B', title_alternatives: ['C｜D'] };
    expect(enforceTitlePattern(out, noBarPattern)).toBe(out);
  });

  it('`｜` の型のときは逆向きにも効く', () => {
    const out = { title: '1文で書いたタイトル', title_alternatives: ['前半｜後半'] };
    expect(enforceTitlePattern(out, barPattern).title).toBe('前半｜後半');
  });
});

/**
 * [F-ANP-54] ジャンルごとに売れている型が違う。競馬系は「判定・言い切り」、
 * 副業系は「金額・失敗・独り言」を優先する。
 */
describe('ジャンル別の型', () => {
  it('ジャンルの一覧に未知のキーが混ざっていない', () => {
    const known = new Set(TITLE_PATTERNS.map((p) => p.key));
    for (const keys of Object.values(GENRE_TITLE_PATTERNS)) {
      for (const k of keys) expect(known.has(k)).toBe(true);
    }
  });

  it('競馬系は判定・言い切りが先、副業系は金額・失敗が先', () => {
    expect(patternsForNiche('競馬予想')[0]!.key).toBe('verdict');
    expect(patternsForNiche('副業×AI活用')[0]!.key).toBe('how_to_amount');
  });

  it('ジャンル固有の型は他ジャンルに出ない', () => {
    const money = patternsForNiche('副業×AI活用').map((p) => p.key);
    const gamble = patternsForNiche('競馬予想').map((p) => p.key);
    expect(money).not.toContain('verdict');
    expect(gamble).not.toContain('how_to_amount');
  });

  it('ニッチを渡すとそのジャンルの型からしか選ばない', () => {
    const allowed = new Set(patternsForNiche('競馬予想').map((p) => p.key));
    for (let i = 0; i < 30; i += 1) {
      expect(allowed.has(pickTitlePattern(`art-${String(i)}`, [], '競馬予想').key)).toBe(true);
    }
  });
});
