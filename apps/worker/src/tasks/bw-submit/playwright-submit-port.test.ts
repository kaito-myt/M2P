import { describe, it, expect } from 'vitest';

import { bwCategory, fitToSentence } from './playwright-submit-port.js';

describe('bwCategory', () => {
  it('ラノベ → ライトノベル/ファンタジー', () => {
    expect(bwCategory('light_novel', 'なにか')).toEqual({ top: 'ライトノベル', sub: 'ファンタジー' });
  });
  it('小説 → 文芸・小説/エッセイ', () => {
    expect(bwCategory('novel', 'ふつうの小説')).toEqual({ top: '文芸・小説', sub: 'エッセイ' });
  });
  it('官能を含むタイトルは官能小説サブ', () => {
    expect(bwCategory('novel', '官能の夜')).toEqual({ top: '文芸・小説', sub: '官能小説' });
  });
  it('実用/未知 → 実用（評論・情報）', () => {
    expect(bwCategory('practical', 'x')).toEqual({ top: '実用（評論・情報）', sub: null });
    expect(bwCategory(null, 'x')).toEqual({ top: '実用（評論・情報）', sub: null });
  });
});

describe('fitToSentence (却下理由② 内容紹介の途中切れ防止)', () => {
  it('全文が収まり文末で終わるならそのまま', () => {
    const t = 'これは紹介文です。とても良い本です。';
    expect(fitToSentence(t, 100)).toBe(t);
  });
  it('maxlength を超える場合は limit 内の最後の句点で切る(完全文だけ残す)', () => {
    const t = '一文目です。二文目です。三文目はとても長くて制限を超えてしまう内容になっています。';
    const out = fitToSentence(t, 14);
    expect(out).toBe('一文目です。二文目です。');
    expect(out.endsWith('。')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(14);
  });
  it('末尾が文の途中(句点なし)なら最後の文末まで戻す', () => {
    const t = '一文目です。二文目は途中で切れて';
    expect(fitToSentence(t, 0)).toBe('一文目です。');
  });
  it('感嘆符・疑問符・閉じ括弧も文末として扱う', () => {
    expect(fitToSentence('わかりますか？続きは不完全', 0)).toBe('わかりますか？');
    expect(fitToSentence('彼は言った「またね」そして', 0)).toBe('彼は言った「またね」');
  });
  it('句点が全く無い短文はそのまま返す(切る材料が無い)', () => {
    expect(fitToSentence('タイトルのみ', 0)).toBe('タイトルのみ');
  });
  it('空文字は空文字', () => {
    expect(fitToSentence('', 100)).toBe('');
    expect(fitToSentence('   ', 100)).toBe('');
  });
});
