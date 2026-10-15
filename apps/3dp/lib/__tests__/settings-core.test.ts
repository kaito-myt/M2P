import { describe, expect, it } from 'vitest';

import { checkDerivativeRisk } from '@a2p/contracts/tdp/derivative-guard';

import {
  DENYLIST_MAX_TERMS,
  DENYLIST_MAX_TERM_LENGTH,
  MONTHLY_LIMIT_MAX,
  formatDenylist,
  parseDenylist,
  validateMonthlyLimit,
} from '../settings-core';

describe('parseDenylist', () => {
  it('1 行 1 語で読み、前後空白と空行を落とす', () => {
    expect(parseDenylist('  ブランドA \n\n 作品B\n')).toEqual(['ブランドA', '作品B']);
  });

  it('全半角・大文字小文字違いは重複として落とす (リスト件数を運用判断に使えるように)', () => {
    expect(parseDenylist('ＡＢＣ\nabc\nAbc')).toEqual(['ＡＢＣ']);
  });

  it('保存するのは原文 (運営者が自分の書いた語を見つけられる必要がある)', () => {
    expect(parseDenylist('　スペース 入り　\n')).toEqual(['スペース 入り']);
  });

  it('長すぎる語は落とす (文章の誤貼り付け対策)', () => {
    const long = 'あ'.repeat(DENYLIST_MAX_TERM_LENGTH + 1);
    expect(parseDenylist(`ok\n${long}`)).toEqual(['ok']);
  });

  it('CRLF でも行として読める', () => {
    expect(parseDenylist('A\r\nB\r\n')).toEqual(['A', 'B']);
  });

  it('上限件数で打ち切る', () => {
    const raw = Array.from({ length: DENYLIST_MAX_TERMS + 10 }, (_, i) => `t${i}`).join('\n');
    expect(parseDenylist(raw)).toHaveLength(DENYLIST_MAX_TERMS);
  });

  it('formatDenylist は textarea へ往復できる', () => {
    const terms = parseDenylist('A\nB\nC');
    expect(parseDenylist(formatDenylist(terms))).toEqual(terms);
  });
});

describe('validateMonthlyLimit', () => {
  it('0 を許す (出品を完全に止める設定)', () => {
    expect(validateMonthlyLimit(0)).toEqual({ ok: true, value: 0 });
  });

  it('上限を超える値は丸めずに失敗させる (黙って増やすのは R-1 の逆)', () => {
    expect(validateMonthlyLimit(MONTHLY_LIMIT_MAX + 1)).toEqual({ ok: false });
  });

  it('負値・小数・非数は失敗', () => {
    expect(validateMonthlyLimit(-1)).toEqual({ ok: false });
    expect(validateMonthlyLimit(1.5)).toEqual({ ok: false });
    expect(validateMonthlyLimit('abc')).toEqual({ ok: false });
    expect(validateMonthlyLimit(null)).toEqual({ ok: false });
    expect(validateMonthlyLimit(undefined)).toEqual({ ok: false });
  });

  it('数値文字列は受け付ける (input[type=number] の値は文字列で来る)', () => {
    expect(validateMonthlyLimit('8')).toEqual({ ok: true, value: 8 });
  });
});

describe('設定画面の禁止語がガードに効く (R-2 の往復)', () => {
  it('画面で登録した語がそのまま checkDerivativeRisk で弾かれる', () => {
    const denylist = parseDenylist('  サンプルブランド \n');
    const result = checkDerivativeRisk(['サンプルブランド の椅子'], denylist);
    expect(result.allowed).toBe(false);
    expect(result.risks[0]?.kind).toBe('denylisted_term');
    expect(result.denylist_size).toBe(1);
  });

  it('全角で登録して半角で書かれても弾ける (正規化規則が一致している)', () => {
    const denylist = parseDenylist('ＡＢＣ');
    expect(checkDerivativeRisk(['abc 風の棚'], denylist).allowed).toBe(false);
  });

  it('禁止語が空でも一般的な様式名は通る (弾きすぎない)', () => {
    expect(checkDerivativeRisk(['和風の行灯'], parseDenylist('')).allowed).toBe(true);
  });
});
