import { describe, expect, it } from 'vitest';

import { formatJstDate, formatJstDateTime, formatJstShort } from '../datetime';

/**
 * [F-ANP-52] `toLocaleString('ja-JP')` はロケールを決めるだけで **TZ は実行環境依存**。
 * サーバー (Railway = UTC) で描画すると 9 時間ずれるため、JST 固定の整形に統一した。
 */
describe('JST 固定の日時整形', () => {
  // 2026-09-29T15:30:00Z = 2026-09-30 00:30 JST (日付が変わる境界)
  const boundary = new Date('2026-09-29T15:30:00.000Z');

  it('UTC の日付をまたぐ時刻でも JST で出す', () => {
    expect(formatJstDateTime(boundary)).toBe('2026-09-30 00:30');
    expect(formatJstDate(boundary)).toBe('2026-09-30');
    expect(formatJstShort(boundary)).toBe('09-30 00:30');
  });

  it('ISO 文字列も受ける', () => {
    expect(formatJstDateTime('2026-09-29T15:30:00.000Z')).toBe('2026-09-30 00:30');
  });

  it('JST 正午はそのまま', () => {
    expect(formatJstDateTime(new Date('2026-09-29T03:00:00.000Z'))).toBe('2026-09-29 12:00');
  });

  it('24 時制で出す (午後も 0 埋め 2 桁)', () => {
    expect(formatJstDateTime(new Date('2026-09-29T10:05:00.000Z'))).toBe('2026-09-29 19:05');
  });

  it('null / 空 / 不正な値は "-"', () => {
    expect(formatJstDateTime(null)).toBe('-');
    expect(formatJstDateTime(undefined)).toBe('-');
    expect(formatJstDateTime('')).toBe('-');
    expect(formatJstDateTime('not a date')).toBe('-');
    expect(formatJstDate(null)).toBe('-');
    expect(formatJstShort(null)).toBe('-');
  });
});
