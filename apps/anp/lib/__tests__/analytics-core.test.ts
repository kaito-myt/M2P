import { describe, expect, it } from 'vitest';

import { computeCostDashboard, computeSalesDashboard, costQueryRange, percentChange, previousMonthKey, recentMonthKeys } from '../analytics-core';

// 2026-09-21 12:00 JST
const NOW = new Date('2026-09-21T03:00:00Z');

describe('month helpers', () => {
  it('recentMonthKeys / previousMonthKey follow JST months', () => {
    expect(recentMonthKeys(NOW, 3)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    // JST 3/1 00:30 = UTC 2/28 15:30 → 3 月扱い
    expect(recentMonthKeys(new Date('2026-02-28T15:30:00Z'), 1)).toEqual(['2026-03']);
  });

  it('costQueryRange spans previous month start to next month start (JST)', () => {
    const { start, end } = costQueryRange(NOW);
    expect(start.toISOString()).toBe('2026-07-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('percentChange', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 0)).toBeNull();
  });
});

describe('computeSalesDashboard', () => {
  const accounts = [
    { id: 'a1', display_name: 'ラボ', niche: 'AI', status: 'active', followers_total: 120 },
    { id: 'a2', display_name: '家計', niche: '節約', status: 'active', followers_total: 30 },
  ];
  const articles = [
    { id: 'p1', note_account_id: 'a1', title: '有料1', paid: true, price_jpy: 500, publish_status: 'published', published_at: new Date('2026-09-02T00:00:00Z'), note_url: 'https://note.com/x/n/1' },
    { id: 'p2', note_account_id: 'a1', title: '無料1', paid: false, price_jpy: null, publish_status: 'published', published_at: new Date('2026-08-20T00:00:00Z'), note_url: null },
    { id: 'p3', note_account_id: 'a2', title: '下書き', paid: false, price_jpy: null, publish_status: 'draft', published_at: null, note_url: null },
  ];
  const sales = [
    { note_article_id: 'p1', year_month: '2026-09', revenue_jpy: 1500, views: 300, likes: 20, buyers: 3 },
    { note_article_id: 'p2', year_month: '2026-09', revenue_jpy: 0, views: 900, likes: 40, buyers: 0 },
    { note_article_id: 'p2', year_month: '2026-08', revenue_jpy: 0, views: 400, likes: 10, buyers: 0 },
    { note_article_id: 'zzz', year_month: '2026-09', revenue_jpy: 999, views: 1, likes: 0, buyers: 1 },
  ];
  const membership = [
    { note_account_id: 'a1', year_month: '2026-09', subscribers: 4, mrr_jpy: 2000 },
    { note_account_id: 'a1', year_month: '2026-08', subscribers: 2, mrr_jpy: 1000 },
  ];

  it('aggregates this/last month totals, trend, accounts and top articles', () => {
    const d = computeSalesDashboard({ accounts, articles, sales, membership, now: NOW, months: 3 });
    expect(d.ym).toBe('2026-09');
    // 存在しない記事 (zzz) の売上も総計には入る (取得ソースの合計) が、アカウント/記事別には入らない
    expect(d.thisMonth).toEqual({ revenue: 2499, views: 1201, likes: 60, buyers: 4, mrr: 2000, subscribers: 4 });
    expect(d.lastMonth).toEqual({ revenue: 0, views: 400, likes: 10, buyers: 0, mrr: 1000, subscribers: 2 });
    expect(d.trend.map((t) => t.ym)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(d.trend[2]).toMatchObject({ revenue: 2499, published: 1 });
    expect(d.trend[1]).toMatchObject({ views: 400, published: 1 });

    const a1 = d.accounts.find((a) => a.id === 'a1')!;
    expect(a1).toMatchObject({ revenue: 1500, views: 1200, likes: 60, buyers: 3, mrr: 2000, subscribers: 4, publishedTotal: 2, publishedThisMonth: 1, paidArticles: 1 });
    expect(a1.topArticle).toMatchObject({ id: 'p1', revenue: 1500 });
    const a2 = d.accounts.find((a) => a.id === 'a2')!;
    expect(a2.revenue).toBe(0);
    expect(a2.topArticle).toBeNull();
    expect(d.accounts[0]!.id).toBe('a1');

    expect(d.topArticles.map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(d.topArticles[0]).toMatchObject({ accountName: 'ラボ', paid: true, revenue: 1500 });
  });
});

describe('computeCostDashboard', () => {
  const accounts = [
    { id: 'a1', display_name: 'ラボ' },
    { id: 'a2', display_name: '家計' },
  ];
  const usage = [
    { date: '2026-09-01', provider: 'anthropic', model: 'claude-opus-4-7', role: 'anp.theme', cost_jpy: '120.5', call_count: 3, input_tokens: 1000, output_tokens: 500 },
    { date: '2026-09-21', provider: 'anthropic', model: 'claude-sonnet-4-6', role: 'anp.writer', cost_jpy: '80', call_count: 2, input_tokens: 2000, output_tokens: 4000 },
    { date: '2026-09-21', provider: 'openai', model: 'gpt-image-1', role: 'anp.strategist', cost_jpy: '40', call_count: 1, input_tokens: 0, output_tokens: 0 },
    { date: '2026-08-15', provider: 'anthropic', model: 'claude-opus-4-7', role: 'anp.theme', cost_jpy: '300', call_count: 5, input_tokens: 100, output_tokens: 100 },
  ];
  const articles = [
    { id: 'p1', title: '記事1', note_account_id: 'a1', status: 'published', publish_status: 'published', cost_jpy_total: '150', created_at: new Date('2026-09-05T00:00:00Z') },
    { id: 'p2', title: '記事2', note_account_id: 'a1', status: 'writing', publish_status: 'draft', cost_jpy_total: '50', created_at: new Date('2026-09-20T00:00:00Z') },
    { id: 'p3', title: '先月', note_account_id: 'a2', status: 'published', publish_status: 'published', cost_jpy_total: '999', created_at: new Date('2026-08-05T00:00:00Z') },
  ];

  it('aggregates totals, daily, breakdowns, accounts and forecast', () => {
    const d = computeCostDashboard({ usage, articles, accounts, now: NOW });
    expect(d.ym).toBe('2026-09');
    expect(d.totalThisMonth).toBe(241); // 120.5 + 80 + 40 → round
    expect(d.totalLastMonth).toBe(300);
    expect(d.callsThisMonth).toBe(6);
    expect(d.tokensThisMonth).toEqual({ input: 3000, output: 4500 });
    expect(d.daily).toHaveLength(21);
    expect(d.daily[0]).toEqual({ date: '2026-09-01', cost: 120.5, calls: 3 });
    expect(d.daily[20]).toEqual({ date: '2026-09-21', cost: 120, calls: 3 });
    expect(d.byRole[0]).toMatchObject({ key: 'anp.theme', cost: 120.5, share: 50.1 });
    expect(d.byProvider.map((r) => r.key)).toEqual(['anthropic', 'openai']);
    expect(d.byModel[0]!.key).toBe('anthropic/claude-opus-4-7');
    expect(d.accounts[0]).toMatchObject({ id: 'a1', cost: 200, articles: 2, published: 1, costPerArticle: 100 });
    expect(d.accounts[1]).toMatchObject({ id: 'a2', cost: 0, articles: 0, costPerArticle: null });
    expect(d.topArticles.map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(d.avgCostPerArticle).toBe(100);
    expect(d.avgCostPerPublished).toBe(200);
    expect(d.forecastMonthEnd).toBe(Math.round((240.5 / 21) * 30));
  });
});
