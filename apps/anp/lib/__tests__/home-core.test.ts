import { describe, expect, it } from 'vitest';

import { computeAccountKpis, jstMonthRange, toNumber } from '../home-core';

describe('jstMonthRange', () => {
  it('JST 2026-09-21 09:00 (=UTC 00:00) は 9月の範囲を返す', () => {
    const now = new Date('2026-09-21T00:00:00Z');
    const { start, end, ym } = jstMonthRange(now);
    expect(ym).toBe('2026-09');
    expect(start.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // JST 2026-09-01 00:00
    expect(end.toISOString()).toBe('2026-09-30T15:00:00.000Z'); // JST 2026-10-01 00:00
  });
});

describe('toNumber', () => {
  it('Decimal 風オブジェクト(.toNumber())を数値化する', () => {
    expect(toNumber({ toNumber: () => 123.6 })).toBe(124);
  });
  it('数値・文字列をそのまま/変換する', () => {
    expect(toNumber(10)).toBe(10);
    expect(toNumber('20')).toBe(20);
    expect(toNumber(null)).toBe(0);
  });
});

describe('computeAccountKpis', () => {
  const now = new Date('2026-09-21T00:00:00Z'); // JST 2026-09-21 09:00

  it('公開数(累計/30日)・当月売上・当月コスト・純利益をアカウント別に集計する', () => {
    const accounts = [
      { id: 'acc1', display_name: 'A', niche: 'n', status: 'active', followers_total: 10 },
      { id: 'acc2', display_name: 'B', niche: 'n', status: 'paused', followers_total: 0 },
    ];
    const articles = [
      {
        id: 'art1',
        note_account_id: 'acc1',
        publish_status: 'published',
        published_at: new Date('2026-09-10T00:00:00Z'), // 30日以内
        created_at: new Date('2026-09-05T00:00:00Z'), // 当月作成
        cost_jpy_total: 100,
      },
      {
        id: 'art2',
        note_account_id: 'acc1',
        publish_status: 'published',
        published_at: new Date('2026-06-01T00:00:00Z'), // 30日より前
        created_at: new Date('2026-06-01T00:00:00Z'), // 先月以前作成
        cost_jpy_total: 50,
      },
      {
        id: 'art3',
        note_account_id: 'acc2',
        publish_status: 'ready',
        published_at: null,
        created_at: new Date('2026-09-15T00:00:00Z'),
        cost_jpy_total: 30,
      },
    ];
    const salesThisMonth = [
      { note_article_id: 'art1', revenue_jpy: 500, views: 20 },
      { note_article_id: 'art2', revenue_jpy: 200, views: 5 }, // 先月公開でも当月実績として計上
    ];

    const result = computeAccountKpis({ accounts, articles, salesThisMonth, now });

    const acc1 = result.find((r) => r.id === 'acc1')!;
    expect(acc1.publishedTotal).toBe(2);
    expect(acc1.published30d).toBe(1);
    expect(acc1.costThisMonth).toBe(100); // art1 のみ当月作成
    expect(acc1.revenueThisMonth).toBe(700); // art1+art2
    expect(acc1.netProfitThisMonth).toBe(600);

    const acc2 = result.find((r) => r.id === 'acc2')!;
    expect(acc2.publishedTotal).toBe(0);
    expect(acc2.published30d).toBe(0);
    expect(acc2.costThisMonth).toBe(30);
    expect(acc2.revenueThisMonth).toBe(0);
    expect(acc2.netProfitThisMonth).toBe(-30);
  });

  it('アカウントが無ければ空配列を返す', () => {
    expect(computeAccountKpis({ accounts: [], articles: [], salesThisMonth: [], now })).toEqual([]);
  });
});
