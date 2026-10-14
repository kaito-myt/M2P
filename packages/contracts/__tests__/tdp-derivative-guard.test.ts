/**
 * 3DP 依拠性ガード (docs/12 R-2) のテスト。
 *
 * BOOTH の AI 規制 (2025-07-18) は「特定の作品・作家への依拠性が高い商品」と
 * 「それを大量・連続的に出品する行為」を監視対象にし、アカウント停止まで行う。
 * ガードが緩いとアカウントを失うので、**通るべきものが通ること**と
 * **弾くべきものが弾かれること**を両方押さえる。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DERIVATIVE_DENYLIST,
  canListMore,
  checkDerivativeRisk,
} from '../src/tdp/derivative-guard.js';

const NOW = () => new Date('2026-10-14T09:00:00.000Z');

describe('checkDerivativeRisk — 通すべき企画', () => {
  it('汎用のプロップ・家具は通る', () => {
    for (const text of [
      'VRChat ワールド用のシンプルな木製ダイニングチェア。1 マテリアル・低ポリ。',
      '街灯 3 種セット。夜のワールドに置く前提で、発光部分はエミッシブ。',
      'カフェ用の小物セット (カップ・ソーサー・砂糖壺・メニュー立て)',
      '観葉植物 5 種。モンステラ・パキラ・サンスベリアなど。',
    ]) {
      const r = checkDerivativeRisk([text], DEFAULT_DERIVATIVE_DENYLIST, NOW);
      expect(r.allowed, `${text} -> ${JSON.stringify(r.risks)}`).toBe(true);
    }
  });

  it('一般的な様式名 (和風・北欧風など) は弾かない', () => {
    // ここを弾くと作れるものが無くなる。特定作品ではなく広く使われる様式の呼称。
    for (const text of [
      '和風の行灯。障子紙の質感を出す。',
      '北欧風のローテーブル。明るい木目。',
      '中華風の円卓と椅子。',
      'アンティーク風の真鍮ランプ。',
    ]) {
      const r = checkDerivativeRisk([text], DEFAULT_DERIVATIVE_DENYLIST, NOW);
      expect(r.allowed, `${text} -> ${JSON.stringify(r.risks)}`).toBe(true);
    }
  });

  it('プラットフォーム名への「対応」は通す (動作環境の表示であって依拠ではない)', () => {
    for (const text of [
      'VRChat 対応アクセサリ。Quest 向けに低ポリで作る。',
      'Unity 用パーツ。prefab 同梱。',
      'VRM 対応アクセサリ',
    ]) {
      const r = checkDerivativeRisk([text], DEFAULT_DERIVATIVE_DENYLIST, NOW);
      expect(r.allowed, `${text} -> ${JSON.stringify(r.risks)}`).toBe(true);
    }
  });

  it('汎用のアクセサリは通る', () => {
    const r = checkDerivativeRisk(
      ['シンプルな指輪 5 種。金・銀・銅・黒・ローズゴールド。リグ不要。'],
      DEFAULT_DERIVATIVE_DENYLIST,
      NOW,
    );
    expect(r.allowed).toBe(true);
  });

  it('空の入力は通る (何も企画されていない状態を弾かない)', () => {
    expect(checkDerivativeRisk([], [], NOW).allowed).toBe(true);
    expect(checkDerivativeRisk([null, undefined, '   '], [], NOW).allowed).toBe(true);
  });
});

describe('checkDerivativeRisk — 弾くべき企画', () => {
  it('特定作品に寄せる「〜風」を弾く', () => {
    const r = checkDerivativeRisk(['ジブリ風の森の小屋'], [], NOW);
    expect(r.allowed).toBe(false);
    expect(r.risks[0]!.kind).toBe('style_imitation');
    expect(r.risks[0]!.matched).toContain('風');
  });

  it('オマージュ・インスパイアも弾く (言い換えで抜けさせない)', () => {
    for (const text of ['某有名作品へのオマージュ', '人気ゲームにインスパイアされた剣', 'あの作品テイストの机']) {
      const r = checkDerivativeRisk([text], [], NOW);
      expect(r.allowed, text).toBe(false);
    }
  });

  it('二次創作・公式・原作などの語を弾く', () => {
    for (const [text, kind] of [
      ['二次創作のアクセサリ', 'fan_work_wording'],
      ['原作に忠実な再現モデル', 'fan_work_wording'],
      ['公式コラボ商品', 'denylisted_term'],
      ['キャラクター再現を目指した小物', 'fan_work_wording'],
    ] as const) {
      const r = checkDerivativeRisk([text], DEFAULT_DERIVATIVE_DENYLIST, NOW);
      expect(r.allowed, text).toBe(false);
      expect(r.risks.some((x) => x.kind === kind), `${text} -> ${JSON.stringify(r.risks)}`).toBe(true);
    }
  });

  it('特定アバター専用・対応を弾く (3DP の範囲外)', () => {
    for (const text of [
      'マヌカちゃん専用衣装',
      'セレスティア対応アクセサリ',
      '桔梗用モデル',
    ]) {
      const r = checkDerivativeRisk([text], [], NOW);
      expect(r.allowed, text).toBe(false);
      expect(r.risks.some((x) => x.kind === 'specific_avatar_fit'), text).toBe(true);
    }
  });

  it('作家・権利者への言及を弾く', () => {
    for (const text of ['〇〇先生のデザインを参考に', '@someartist の絵を元に']) {
      const r = checkDerivativeRisk([text], [], NOW);
      expect(r.allowed, text).toBe(false);
      expect(r.risks.some((x) => x.kind === 'creator_reference'), text).toBe(true);
    }
  });

  it('商標記号を弾く', () => {
    const r = checkDerivativeRisk(['Brand™ のロゴ入りマグカップ'], [], NOW);
    expect(r.allowed).toBe(false);
    expect(r.risks.some((x) => x.kind === 'trademark_marker')).toBe(true);
  });

  it('運営者の禁止語は全半角・大文字小文字・空白を無視して当たる', () => {
    const deny = ['Example Work'];
    for (const text of ['ＥＸＡＭＰＬＥ　ＷＯＲＫ の小物', 'exampleworkの机', 'Example  Work 風の椅子']) {
      const r = checkDerivativeRisk([text], deny, NOW);
      expect(r.allowed, text).toBe(false);
      expect(r.risks.some((x) => x.kind === 'denylisted_term'), text).toBe(true);
    }
  });

  it('商品名・プロンプト・紹介文のどこに入っていても弾く', () => {
    // 企画は通っても生成プロンプトに書かれていたら意味がないので、全ての文字列を見る。
    const r = checkDerivativeRisk(
      ['普通の椅子', 'a chair inspired by 二次創作', 'VRChat 用'],
      [],
      NOW,
    );
    expect(r.allowed).toBe(false);
  });

  it('同じ語に複数回当たっても理由は 1 件にまとめる', () => {
    const r = checkDerivativeRisk(['二次創作の机と二次創作の椅子'], [], NOW);
    expect(r.risks.filter((x) => x.matched === '二次創作')).toHaveLength(1);
  });

  it('判定結果は決定論的 (同じ入力なら毎回同じ)', () => {
    const a = checkDerivativeRisk(['ジブリ風の小屋'], ['X'], NOW);
    const b = checkDerivativeRisk(['ジブリ風の小屋'], ['X'], NOW);
    expect(a).toEqual(b);
  });

  it('監査用に禁止語リストの件数と判定時刻を残す', () => {
    const r = checkDerivativeRisk(['普通の椅子'], ['a', 'b', 'c'], NOW);
    expect(r.denylist_size).toBe(3);
    expect(r.checked_at).toBe('2026-10-14T09:00:00.000Z');
  });
});

describe('canListMore — 月間出品上限 (R-1)', () => {
  it('残枠があれば出品できる', () => {
    expect(canListMore({ listedThisMonth: 3, monthlyLimit: 8 })).toEqual({
      allowed: true,
      remaining: 5,
    });
  });

  it('上限に達したら出品しない', () => {
    const r = canListMore({ listedThisMonth: 8, monthlyLimit: 8 });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    // 「なぜ止めているか」を運営者に説明できること (上限は目標ではない)
    expect(r.reason).toContain('大量・連続的な出品');
  });

  it('超過していても remaining は負にしない', () => {
    expect(canListMore({ listedThisMonth: 12, monthlyLimit: 8 }).remaining).toBe(0);
  });

  it('上限 0 なら一切出品しない (停止スイッチとして使える)', () => {
    expect(canListMore({ listedThisMonth: 0, monthlyLimit: 0 }).allowed).toBe(false);
  });
});
