import { describe, expect, it } from 'vitest';
import { jstMonthRange, jstYearMonth } from '../src/cost-attribution';
import { canListMore } from '../src/tdp/derivative-guard';
import { computeSlots } from '../src/tdp/hold';

function legacyCanListMore(args: { listedThisMonth: number; monthlyLimit: number }) {
  const remaining = Math.max(0, args.monthlyLimit - args.listedThisMonth);
  if (remaining > 0) return { allowed: true, remaining };
  return {
    allowed: false,
    remaining: 0,
    reason:
      `当月の出品上限 ${args.monthlyLimit} 件に達しました。BOOTH は「大量・連続的な出品」を` +
      '監視対象にしており (2025-07-18 発表)、閾値は非開示です。来月まで出品しません。',
  };
}

describe('canListMore 回帰 (旧実装との一致)', () => {
  it('listed 0..12 x limit 0..12 の 169 通りで一致する', () => {
    let n = 0;
    for (let listed = 0; listed <= 12; listed++) {
      for (let limit = 0; limit <= 12; limit++) {
        const args = { listedThisMonth: listed, monthlyLimit: limit };
        expect(canListMore(args)).toEqual(legacyCanListMore(args));
        n++;
      }
    }
    expect(n).toBe(169);
  });
});

describe('computeSlots', () => {
  it('limit=20 は 12 に切られる', () => {
    expect(computeSlots({ limit: 20, publishedThisMonth: 0, activeReservations: 0 })).toMatchObject({
      limit: 12,
      remaining: 12,
      allowed: true,
    });
  });

  it('予約2 + 公開7 + 上限8 は remaining=0, allowed=false', () => {
    expect(computeSlots({ limit: 8, publishedThisMonth: 7, activeReservations: 2 })).toEqual({
      limit: 8,
      published: 7,
      reserved: 2,
      used: 9,
      remaining: 0,
      allowed: false,
    });
  });

  it('残り 1 なら許可する', () => {
    expect(computeSlots({ limit: 8, publishedThisMonth: 6, activeReservations: 1 })).toMatchObject({
      remaining: 1,
      allowed: true,
    });
  });
});

describe('canListMore の天井クランプ', () => {
  it('保存値 20 でも 12 件出品済みなら止まり、適用上限 12 と設定値 20 の両方を示す', () => {
    const r = canListMore({ listedThisMonth: 12, monthlyLimit: 20 });
    expect(r).toMatchObject({ allowed: false, remaining: 0 });
    expect(r.reason).toContain('出品上限 12 件に達しました');
    expect(r.reason).not.toContain('20 件に達しました');
    expect(r.reason).toContain('設定値 20 件');
    expect(r.reason).toContain('コード側の上限 12 件');
  });
  it('境界: 保存値 13 / 出品済み 12 でも止まる', () => {
    const r = canListMore({ listedThisMonth: 12, monthlyLimit: 13 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('設定値 13 件');
  });
  it('クランプ前なら読み替えの文は付かない', () => {
    expect(canListMore({ listedThisMonth: 12, monthlyLimit: 12 }).reason).not.toContain('読み替え');
  });
});

describe('JST 月境界', () => {
  it('UTC 2026-09-30T14:59:59Z は 9 月', () => {
    expect(jstYearMonth(new Date('2026-09-30T14:59:59Z'))).toBe('2026-09');
    expect(jstMonthRange(new Date('2026-09-30T14:59:59Z')).monthStart.toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });
  it('UTC 2026-09-30T15:00:00Z は 10 月', () => {
    expect(jstYearMonth(new Date('2026-09-30T15:00:00Z'))).toBe('2026-10');
    expect(jstMonthRange(new Date('2026-09-30T15:00:00Z')).monthStart.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });
});
