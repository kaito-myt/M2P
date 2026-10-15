import { describe, expect, it } from 'vitest';

import {
  PRODUCT_STATUSES,
  buildQuotaView,
  buildStatusRows,
  jstMonthRange,
  totalCount,
} from '../home-core';

describe('buildStatusRows', () => {
  it('0 件の状態も行として残す (ゲートが空いていることの確認になるため)', () => {
    const rows = buildStatusRows([{ status: 'planned', count: 3 }]);
    expect(rows).toHaveLength(PRODUCT_STATUSES.length);
    expect(rows.find((r) => r.status === 'planned')?.count).toBe(3);
    expect(rows.find((r) => r.status === 'review')?.count).toBe(0);
  });

  it('正準順に並べる', () => {
    const rows = buildStatusRows([
      { status: 'listed', count: 1 },
      { status: 'planned', count: 1 },
    ]);
    expect(rows.slice(0, PRODUCT_STATUSES.length).map((r) => r.status)).toEqual([...PRODUCT_STATUSES]);
  });

  it('未知の status は末尾に残す (消すと合計が合わなくなる)', () => {
    const rows = buildStatusRows([{ status: 'zzz_unknown', count: 2 }]);
    expect(rows.at(-1)).toEqual({ status: 'zzz_unknown', count: 2 });
    expect(totalCount(rows)).toBe(2);
  });

  it('同じ status が複数来たら合算する', () => {
    const rows = buildStatusRows([
      { status: 'ready', count: 2 },
      { status: 'ready', count: 5 },
    ]);
    expect(rows.find((r) => r.status === 'ready')?.count).toBe(7);
  });

  it('空入力でも全状態 0 の行を返す', () => {
    const rows = buildStatusRows([]);
    expect(totalCount(rows)).toBe(0);
    expect(rows).toHaveLength(PRODUCT_STATUSES.length);
  });
});

describe('buildQuotaView', () => {
  it('残枠があれば allowed=true で reason を持たない', () => {
    const q = buildQuotaView({ listedThisMonth: 3, monthlyLimit: 8 });
    expect(q).toMatchObject({ limit: 8, listed: 3, remaining: 5, allowed: true });
    expect(q.reason).toBeUndefined();
  });

  it('使い切ったら allowed=false + R-1 の理由を返す', () => {
    const q = buildQuotaView({ listedThisMonth: 8, monthlyLimit: 8 });
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
    expect(q.reason).toContain('上限');
  });

  it('上限を超えて出てしまっていても remaining は負にしない', () => {
    const q = buildQuotaView({ listedThisMonth: 12, monthlyLimit: 8 });
    expect(q.remaining).toBe(0);
    expect(q.allowed).toBe(false);
  });

  it('上限 0 = 出品停止', () => {
    const q = buildQuotaView({ listedThisMonth: 0, monthlyLimit: 0 });
    expect(q.allowed).toBe(false);
    expect(q.remaining).toBe(0);
  });

  it('負の入力は 0 に寄せる (DB 不整合で画面が壊れないように)', () => {
    const q = buildQuotaView({ listedThisMonth: -3, monthlyLimit: -1 });
    expect(q.listed).toBe(0);
    expect(q.limit).toBe(0);
    expect(q.remaining).toBe(0);
  });
});

describe('jstMonthRange', () => {
  it('JST の月初 = UTC 月初 -9h', () => {
    const { start, end } = jstMonthRange(new Date('2026-10-15T03:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-30T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T15:00:00.000Z');
  });

  it('UTC では前月でも JST で当月なら当月扱いになる', () => {
    // 2026-09-30T16:00Z = 2026-10-01T01:00 JST → 10 月。
    const { start } = jstMonthRange(new Date('2026-09-30T16:00:00Z'));
    expect(start.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('JST ではまだ前月の UTC 月初は前月扱いになる', () => {
    // 2026-10-01T00:00Z = 2026-10-01T09:00 JST → 10 月。
    // 2026-09-30T14:59Z = 2026-09-30T23:59 JST → 9 月。
    const { start } = jstMonthRange(new Date('2026-09-30T14:59:00Z'));
    expect(start.toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });

  it('年またぎ (12 月→1 月)', () => {
    const { start, end } = jstMonthRange(new Date('2026-12-31T16:00:00Z')); // = 2027-01-01 01:00 JST
    expect(start.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-31T15:00:00.000Z');
  });
});
