/**
 * [F-ANP-54] ジャンル別「勝ち筋」テーブルの単体テスト。
 * 運営者から提示された売れている記事のサムネ 6 枚が 2 系統にはっきり分かれたことが根拠
 * (副業・AI 系 = 明るい/かわいい、競馬・予想系 = 黒金/劇的)。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NOTE_GENRE,
  NOTE_GENRES,
  classifyNicheGenre,
} from '../src/note-genre.js';

describe('classifyNicheGenre', () => {
  it('本番の 2 アカウントを正しく振り分ける', () => {
    expect(classifyNicheGenre('競馬予想').key).toBe('gamble');
    expect(classifyNicheGenre('副業×AI活用').key).toBe('money');
  });

  it('部分一致で拾う', () => {
    for (const n of ['地方競馬の買い方', '馬券術', 'ボートレース予想']) {
      expect(classifyNicheGenre(n).key).toBe('gamble');
    }
    for (const n of ['AIで時短', '在宅ワーク', 'ブログ運営', 'お金の管理']) {
      expect(classifyNicheGenre(n).key).toBe('money');
    }
  });

  it('どれにも当たらなければ汎用', () => {
    expect(classifyNicheGenre('家庭菜園').key).toBe('default');
    expect(classifyNicheGenre(null).key).toBe('default');
    expect(classifyNicheGenre('').key).toBe('default');
    expect(DEFAULT_NOTE_GENRE.key).toBe('default');
  });

  it('全ジャンルに画作り・コピー・タイトルの方針が揃っている', () => {
    for (const g of NOTE_GENRES) {
      expect(g.art.length).toBeGreaterThan(30);
      expect(g.copy.length).toBeGreaterThan(30);
      expect(g.titleTone.length).toBeGreaterThan(10);
    }
  });

  it('競馬系と副業系は正反対の指示になっている (取り違えると必ず外す)', () => {
    const gamble = classifyNicheGenre('競馬予想');
    const money = classifyNicheGenre('副業×AI活用');
    expect(gamble.art).toContain('黒');
    expect(gamble.art).toContain('かわいい絵は使わない');
    expect(money.art).toContain('明るく淡い地');
    expect(money.art).toContain('黒い地にしない');
    // 数値の断片コピー (「20枚45分」) の禁止は副業系で明示されている。
    expect(money.copy).toContain('数値の断片');
  });
});
