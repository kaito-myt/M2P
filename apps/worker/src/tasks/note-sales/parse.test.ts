import { describe, expect, it } from 'vitest';

import {
  aggregateMembership,
  parseDashboardRow,
  parseFollowerCount,
  parseMembershipRow,
  parseNoteStatNumber,
} from './parse.js';

describe('parseNoteStatNumber', () => {
  it('"-" は 0', () => {
    expect(parseNoteStatNumber('-')).toBe(0);
  });
  it('空文字/undefined/null は 0', () => {
    expect(parseNoteStatNumber('')).toBe(0);
    expect(parseNoteStatNumber(undefined)).toBe(0);
    expect(parseNoteStatNumber(null)).toBe(0);
  });
  it('カンマ区切りを整数化する', () => {
    expect(parseNoteStatNumber('3,814')).toBe(3814);
  });
  it('円サフィックスを取り除く', () => {
    expect(parseNoteStatNumber('1,234円')).toBe(1234);
  });
  it('数字以外の文字列は 0', () => {
    expect(parseNoteStatNumber('abc')).toBe(0);
  });
});

describe('parseDashboardRow', () => {
  it('note.com/<handle>/n/<noteId> の href と 6 セルを構造化する', () => {
    const r = parseDashboardRow('https://note.com/goodbooks_intro/n/n5545faed9256', [
      'タイトル公開中2026年9月13日',
      '2',
      '-',
      '-',
      '-',
      '-',
    ]);
    expect(r).toEqual({
      noteUrl: 'https://note.com/goodbooks_intro/n/n5545faed9256',
      impressions: 2,
      views: 0,
      likes: 0,
      comments: 0,
      revenueJpy: 0,
    });
  });

  it('href が note 記事URLでなければ null', () => {
    expect(parseDashboardRow('https://note.com/notemag/n/n2c65107d4eb1', ['t', '1', '1', '1', '1', '1'])).not.toBeNull();
    expect(parseDashboardRow('https://example.com/foo', ['t', '1', '1', '1', '1', '1'])).toBeNull();
    expect(parseDashboardRow(null, ['t', '1', '1', '1', '1', '1'])).toBeNull();
  });

  it('セル数が不足していれば null', () => {
    expect(parseDashboardRow('https://note.com/h/n/nabc', ['t', '1'])).toBeNull();
  });

  it('売上列が非ゼロならそのまま反映する', () => {
    const r = parseDashboardRow('https://note.com/h/n/nabc', ['t', '10', '5', '2', '1', '1,500']);
    expect(r?.revenueJpy).toBe(1500);
  });
});

describe('parseFollowerCount', () => {
  it('"9フォロワー" から 9 を抽出する', () => {
    expect(parseFollowerCount('9フォロワー')).toBe(9);
  });
  it('カンマ区切りも解釈する', () => {
    expect(parseFollowerCount('1,234フォロワー')).toBe(1234);
  });
  it('マッチしなければ null', () => {
    expect(parseFollowerCount('フォロー中')).toBeNull();
    expect(parseFollowerCount(null)).toBeNull();
  });
});

describe('parseMembershipRow / aggregateMembership', () => {
  it('5 セルから入会/退会/売上を抽出する', () => {
    const r = parseMembershipRow(['マガジンA', '3', '10', '2', '5,000']);
    expect(r).toEqual({ joined: 10, left: 2, revenueJpy: 5000 });
  });

  it('セル不足なら null', () => {
    expect(parseMembershipRow(['a', 'b'])).toBeNull();
  });

  it('複数マガジンを純増数・売上合計で集約する', () => {
    const agg = aggregateMembership([
      { joined: 10, left: 2, revenueJpy: 5000 },
      { joined: 3, left: 5, revenueJpy: 1000 },
    ]);
    // 2マガジン目の純増は負(-2)だが 0 未満には倒さず加算対象外(マイナス寄与しない)。
    expect(agg).toEqual({ subscribers: 8, mrrJpy: 6000 });
  });
});
