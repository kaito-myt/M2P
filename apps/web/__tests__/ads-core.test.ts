import { describe, expect, it } from 'vitest';

import {
  aggregateCampaignRows,
  buildAdsBookRows,
  buildAdsTrend,
  computeAdsKpi,
  formatMomPct,
  formatPct,
  formatRoas,
  pctChange,
  previousAdsWindow,
  resolveAdsPeriod,
  type AdCampaignStatRaw,
  type AdProductStatRaw,
  type AdsDailyRow,
} from '../lib/ads-core';

describe('resolveAdsPeriod', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  it('defaults to current month when period is undefined/invalid', () => {
    expect(resolveAdsPeriod(undefined, now)).toEqual({
      period: 'current',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      yearMonth: '2026-09',
    });
    expect(resolveAdsPeriod('bogus', now)).toEqual({
      period: 'current',
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      yearMonth: '2026-09',
    });
  });

  it('resolves prev to the previous calendar month', () => {
    expect(resolveAdsPeriod('prev', now)).toEqual({
      period: 'prev',
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      yearMonth: '2026-08',
    });
  });

  it('resolves last30 to a 30-day window ending today (no yearMonth)', () => {
    const r = resolveAdsPeriod('last30', now);
    expect(r.period).toBe('last30');
    expect(r.toDate).toBe('2026-09-21');
    expect(r.fromDate).toBe('2026-08-23');
    expect(r.yearMonth).toBeUndefined();
  });

  it('handles January (year rollback) for prev', () => {
    const jan = new Date('2026-01-15T00:00:00.000Z');
    expect(resolveAdsPeriod('prev', jan)).toEqual({
      period: 'prev',
      fromDate: '2025-12-01',
      toDate: '2025-12-31',
      yearMonth: '2025-12',
    });
  });
});

describe('previousAdsWindow', () => {
  it('shifts back one month when yearMonth is set (current/prev)', () => {
    expect(previousAdsWindow({ fromDate: '2026-09-01', toDate: '2026-09-30', yearMonth: '2026-09' })).toEqual({
      fromDate: '2026-08-01',
      toDate: '2026-08-31',
      yearMonth: '2026-08',
    });
  });

  it('shifts back the same span for last30 windows', () => {
    expect(previousAdsWindow({ fromDate: '2026-08-23', toDate: '2026-09-21' })).toEqual({
      fromDate: '2026-07-24',
      toDate: '2026-08-22',
    });
  });
});

describe('computeAdsKpi', () => {
  const rows: AdsDailyRow[] = [
    { ads_date: '2026-09-01', spend_jpy: 1000, sales_jpy: 4000, impressions: 1000, clicks: 40, orders: 2 },
    { ads_date: '2026-09-02', spend_jpy: 500, sales_jpy: 1000, impressions: 500, clicks: 10, orders: 1 },
  ];

  it('sums totals and derives roas/acos/ctr/cpc', () => {
    const kpi = computeAdsKpi(rows);
    expect(kpi.spendJpy).toBe(1500);
    expect(kpi.salesJpy).toBe(5000);
    expect(kpi.roas).toBeCloseTo(3.33, 2);
    expect(kpi.acosPct).toBeCloseTo(30, 1);
    expect(kpi.impressions).toBe(1500);
    expect(kpi.clicks).toBe(50);
    expect(kpi.ctrPct).toBeCloseTo(3.3, 1);
    expect(kpi.cpc).toBe(30);
    expect(kpi.orders).toBe(3);
  });

  it('returns null roas/acos/ctr/cpc for zero denominators', () => {
    const kpi = computeAdsKpi([]);
    expect(kpi).toEqual({
      spendJpy: 0,
      salesJpy: 0,
      roas: null,
      acosPct: null,
      impressions: 0,
      clicks: 0,
      ctrPct: null,
      cpc: null,
      orders: 0,
    });
  });
});

describe('pctChange', () => {
  it('computes signed percentage change', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
  });

  it('returns null when previous is 0 (undefined change)', () => {
    expect(pctChange(100, 0)).toBeNull();
  });
});

describe('buildAdsTrend', () => {
  it('sorts ascending by date and maps spend/sales', () => {
    const rows: AdsDailyRow[] = [
      { ads_date: '2026-09-02', spend_jpy: 200, sales_jpy: 800, impressions: 0, clicks: 0, orders: 0 },
      { ads_date: '2026-09-01', spend_jpy: 100, sales_jpy: 400, impressions: 0, clicks: 0, orders: 0 },
    ];
    expect(buildAdsTrend(rows)).toEqual([
      { date: '2026-09-01', spendJpy: 100, salesJpy: 400 },
      { date: '2026-09-02', spendJpy: 200, salesJpy: 800 },
    ]);
  });
});

describe('aggregateCampaignRows', () => {
  it('sums per campaign and picks the latest non-null state/budget', () => {
    const rows: AdCampaignStatRaw[] = [
      { campaign_id: 'C1', campaign_name: 'C1', campaign_state: null, budget_jpy: null, ads_date: '2026-09-01', spend_jpy: 100, sales_jpy: 500, clicks: 5, impressions: 100, orders: 1 },
      { campaign_id: 'C1', campaign_name: 'C1', campaign_state: 'enabled', budget_jpy: 1000, ads_date: '2026-09-02', spend_jpy: 200, sales_jpy: 1000, clicks: 10, impressions: 200, orders: 2 },
      { campaign_id: 'C2', campaign_name: 'C2', campaign_state: 'paused', budget_jpy: 500, ads_date: '2026-09-01', spend_jpy: 50, sales_jpy: 0, clicks: 1, impressions: 50, orders: 0 },
    ];
    const out = aggregateCampaignRows(rows);
    const c1 = out.find((r) => r.campaignId === 'C1');
    const c2 = out.find((r) => r.campaignId === 'C2');
    expect(c1).toMatchObject({ spendJpy: 300, salesJpy: 1500, state: 'enabled', budgetJpy: 1000, clicks: 15, orders: 3, roas: 5 });
    expect(c2).toMatchObject({ spendJpy: 50, salesJpy: 0, roas: 0, acosPct: null, state: 'paused', budgetJpy: 500 });
  });

  it('sorts by ROAS descending (nulls last)', () => {
    const rows: AdCampaignStatRaw[] = [
      { campaign_id: 'LOW', campaign_name: 'Low', campaign_state: null, budget_jpy: null, ads_date: '2026-09-01', spend_jpy: 100, sales_jpy: 100, clicks: 1, impressions: 1, orders: 0 },
      { campaign_id: 'ZERO', campaign_name: 'Zero', campaign_state: null, budget_jpy: null, ads_date: '2026-09-01', spend_jpy: 0, sales_jpy: 0, clicks: 0, impressions: 0, orders: 0 },
      { campaign_id: 'HIGH', campaign_name: 'High', campaign_state: null, budget_jpy: null, ads_date: '2026-09-01', spend_jpy: 100, sales_jpy: 1000, clicks: 1, impressions: 1, orders: 1 },
    ];
    const order = aggregateCampaignRows(rows).map((r) => r.campaignId);
    expect(order).toEqual(['HIGH', 'LOW', 'ZERO']);
  });

  it('falls back to campaignId as the display name when name is never set', () => {
    const rows: AdCampaignStatRaw[] = [
      { campaign_id: 'C9', campaign_name: null, campaign_state: null, budget_jpy: null, ads_date: '2026-09-01', spend_jpy: 0, sales_jpy: 0, clicks: 0, impressions: 0, orders: 0 },
    ];
    expect(aggregateCampaignRows(rows)[0]?.campaignName).toBe('C9');
  });
});

describe('buildAdsBookRows', () => {
  it('aggregates by ASIN and joins book title + royalty', () => {
    const rows: AdProductStatRaw[] = [
      { asin: 'B001', spend_jpy: 100, sales_jpy: 500, orders: 1 },
      { asin: 'B001', spend_jpy: 50, sales_jpy: 0, orders: 0 },
      { asin: 'B002', spend_jpy: 200, sales_jpy: 0, orders: 0 },
    ];
    const titles = new Map([['B001', '売れる本の書き方']]);
    const royalties = new Map([['B001', 3000]]);

    const out = buildAdsBookRows(rows, titles, royalties);
    const b1 = out.find((r) => r.asin === 'B001');
    const b2 = out.find((r) => r.asin === 'B002');
    expect(b1).toMatchObject({ title: '売れる本の書き方', spendJpy: 150, salesJpy: 500, royaltyJpy: 3000 });
    expect(b2).toMatchObject({ title: '(未登録 ASIN)', spendJpy: 200, royaltyJpy: null });
  });

  it('labels null-asin rows as unregistered and excludes them from royalty lookup', () => {
    const rows: AdProductStatRaw[] = [{ asin: null, spend_jpy: 10, sales_jpy: 0, orders: 0 }];
    const out = buildAdsBookRows(rows, new Map(), new Map());
    expect(out[0]).toMatchObject({ asin: null, title: '(未登録 ASIN)', royaltyJpy: null });
  });

  it('sorts by spend descending', () => {
    const rows: AdProductStatRaw[] = [
      { asin: 'LOW', spend_jpy: 10, sales_jpy: 0, orders: 0 },
      { asin: 'HIGH', spend_jpy: 999, sales_jpy: 0, orders: 0 },
    ];
    const order = buildAdsBookRows(rows, new Map(), new Map()).map((r) => r.asin);
    expect(order).toEqual(['HIGH', 'LOW']);
  });
});

describe('formatting helpers', () => {
  it('formatRoas', () => {
    expect(formatRoas(3.333)).toBe('3.33x');
    expect(formatRoas(null)).toBe('—');
  });

  it('formatPct', () => {
    expect(formatPct(12.34)).toBe('12.3%');
    expect(formatPct(null)).toBe('—');
  });

  it('formatMomPct adds a leading + for non-negative values', () => {
    expect(formatMomPct(12.3)).toBe('+12.3%');
    expect(formatMomPct(-4.5)).toBe('-4.5%');
    expect(formatMomPct(null)).toBe('—');
  });
});
