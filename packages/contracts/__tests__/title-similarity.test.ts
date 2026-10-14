/**
 * タイトル近似重複判定のテスト。
 *
 * 入力は**本番で実際に自己重複した 6 冊**。日次テーマ自動生成が 6 日連続で
 * 競馬本を作り、タイトル完全一致の除外では 1 件も捕まえられなかった。
 */
import { describe, expect, it } from 'vitest';

import {
  extractKeywords,
  findConceptOverlap,
  findNearDuplicate,
  normalizeForSimilarity,
  sharedKeywords,
  titleSimilarity,
} from '../src/title-similarity.js';

/** 本番で 6 日連続で生成された競馬本 (いずれも「血統×オッズ×AI で回収率100%超え」)。 */
const KEIBA = [
  'オッズ×血統×AI 三刀流で馬券を制す——週末だけで回収率100%超えを狙うデータ競馬完全攻略',
  'オッズ×血統×馬場バイアス 三角データ競馬予想術：回収率を底上げする「数字で読む」馬券戦略',
  '回収率120%への道：血統×ペース×AIで「負けない馬券」を組み立てる完全戦略書',
  '競馬データ革命――AIと血統指数で「勝てる軸馬」を科学的に見つける最強予想術',
  'AIが暴く！秋競馬必勝データ馬券術：スピード指数×血統×オッズで激走馬を狙い撃つ',
  '競馬で全然勝てない俺が、コース×血統×オッズの「3点セット」だけで回収率100%超えを達成した話',
];

describe('normalizeForSimilarity', () => {
  it('全半角・大文字小文字・記号・空白の違いを無くす', () => {
    expect(normalizeForSimilarity('ＡＩ×血統 ― 回収率！')).toBe('ai血統回収率');
    expect(normalizeForSimilarity('AI 血統 回収率')).toBe('ai血統回収率');
  });
});

describe('titleSimilarity', () => {
  it('完全一致は 1', () => {
    expect(titleSimilarity(KEIBA[0]!, KEIBA[0]!)).toBe(1);
  });

  it('記号と空白だけ違うタイトルは 1 と見なす', () => {
    expect(titleSimilarity('AI×血統で勝つ', 'ＡＩ 血統 で勝つ')).toBe(1);
  });

  it('全く別のジャンルは低い', () => {
    expect(titleSimilarity(KEIBA[0]!, '40代・50代のための「やめる」健康習慣')).toBeLessThan(0.1);
  });

  it('空文字は 0', () => {
    expect(titleSimilarity('', 'x')).toBe(0);
    expect(titleSimilarity('x', '')).toBe(0);
  });

  it('対称である', () => {
    expect(titleSimilarity(KEIBA[0]!, KEIBA[2]!)).toBeCloseTo(
      titleSimilarity(KEIBA[2]!, KEIBA[0]!),
      10,
    );
  });
});

describe('extractKeywords', () => {
  it('漢字・カタカナ・英数字の連続を骨格語として拾う', () => {
    const k = extractKeywords('オッズ×血統×AI 三刀流で馬券を制す');
    expect(k.has('オッズ')).toBe(true);
    expect(k.has('血統')).toBe(true);
    expect(k.has('ai')).toBe(true);
    expect(k.has('三刀流')).toBe(true);
    expect(k.has('馬券')).toBe(true);
  });

  it('ひらがなは拾わない (助詞・活用で揺れるため)', () => {
    // 「狙う」「狙い撃つ」で別語になってしまうのを避ける。
    const k = extractKeywords('だけで狙う');
    expect([...k]).toEqual([]);
  });

  it('1 文字の漢字は拾わない (ノイズになる)', () => {
    expect(extractKeywords('本を読む').has('本')).toBe(false);
  });
});

describe('findNearDuplicate — 文字列の近さだけでは企画重複を捕まえられない', () => {
  it('本番の競馬 6 本は互いに文字列としては遠い (これが見逃しの原因)', () => {
    // ここを明示しておく: 「タイトル完全一致で除外」も「文字列類似で除外」も
    // この 6 本には効かない。だから骨格語の共有を見る必要がある。
    for (let i = 1; i < KEIBA.length; i++) {
      expect(titleSimilarity(KEIBA[0]!, KEIBA[i]!), `0 vs ${i}`).toBeLessThan(0.5);
    }
    expect(findNearDuplicate(KEIBA[0]!, KEIBA.slice(1))).toBeNull();
  });

  it('言い換え程度の違いなら捕まえる', () => {
    const a = 'オッズ×血統×AIで馬券を制す';
    const b = 'オッズ×血統×AIで馬券を制する';
    expect(findNearDuplicate(a, [b])).not.toBeNull();
  });
});

describe('sharedKeywords / findConceptOverlap — 企画の重複を捕まえる', () => {
  it('文字列は遠いが骨格語を共有していることを検出する', () => {
    const shared = sharedKeywords(KEIBA[0]!, KEIBA[3]!);
    expect(shared).toContain('ai');
    expect(shared).toContain('血統');
  });

  it('本番の競馬 6 本は 1 本目に対して全て重複として検出される', () => {
    // 完全一致除外では 0 件、骨格語の共有では 5/5 件捕まる。
    for (let i = 1; i < KEIBA.length; i++) {
      const o = findConceptOverlap(KEIBA[i]!, [KEIBA[0]!]);
      expect(o, `${i}: ${KEIBA[i]}`).not.toBeNull();
      expect(o!.shared.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('何と重なったか・どの語が重なったかを返す (再生成の指示に使う)', () => {
    const o = findConceptOverlap(KEIBA[4]!, KEIBA.slice(0, 4));
    expect(o).not.toBeNull();
    expect(KEIBA.slice(0, 4)).toContain(o!.title);
    expect(o!.shared.length).toBeGreaterThan(0);
  });

  it('別ジャンルは重複にしない', () => {
    const other = [
      '40代・50代のための「やめる」健康習慣',
      '新NISA 2026 完全対応ガイド',
      '超雑談力の作り方 人見知りでも初対面で信頼される会話の型',
    ];
    expect(findConceptOverlap(KEIBA[0]!, other)).toBeNull();
  });

  it('骨格語が 1 つだけの偶然の一致は重複にしない', () => {
    // 「データ」だけ共有している別企画を弾かない。
    const o = findConceptOverlap('データで考える子育て', ['データ競馬の教科書']);
    expect(o).toBeNull();
  });

  it('しきい値は調整できる (1 語共有でも弾きたいとき)', () => {
    const o = findConceptOverlap('データで考える子育て', ['データ競馬の教科書'], {
      minSharedKeywords: 1,
    });
    expect(o).not.toBeNull();
    expect(o!.shared).toEqual(['データ']);
  });

  it('短いタイトルはバイグラム類似度を根拠にしない (誤検知した実例)', () => {
    // 「テーマ1」vs「テーマ10」が 0.67 になり、テストの 10 候補中 1 件が誤って
    // 重複判定された。短い文字列では 1 文字の違いが比率を支配する。
    expect(titleSimilarity('テーマ1', 'テーマ10')).toBeGreaterThan(0.5);
    expect(findConceptOverlap('テーマ10', ['テーマ1'])).toBeNull();
    expect(findNearDuplicate('テーマ10', ['テーマ1'])).toBeNull();
  });

  it('短くても完全一致は重複にする', () => {
    expect(findNearDuplicate('テーマ1', ['テーマ1'])).not.toBeNull();
    expect(findConceptOverlap('AI副業', ['ＡＩ副業'])).not.toBeNull();
  });

  it('既出が空なら重複なし', () => {
    expect(findConceptOverlap(KEIBA[0]!, [])).toBeNull();
  });

  it('判定は決定論的', () => {
    const a = findConceptOverlap(KEIBA[2]!, KEIBA.slice(0, 2));
    const b = findConceptOverlap(KEIBA[2]!, KEIBA.slice(0, 2));
    expect(a).toEqual(b);
  });
});
