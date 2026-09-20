import { describe, expect, it } from 'vitest';

import {
  aggregateDailySpend,
  buildCampaignStatRows,
  buildProductStatRows,
  chunkDateRange,
  extractNextToken,
  parseCampaignsListResponse,
  parseSpCampaignReportRows,
  parseSpProductReportRows,
  toAdsNumber,
  toJpy,
} from '../src/tasks/ads-spend/ads-report-transform.js';

describe('toAdsNumber', () => {
  it('coerces numeric-like values', () => {
    expect(toAdsNumber(12.5)).toBe(12.5);
    expect(toAdsNumber('12.5')).toBe(12.5);
  });

  it('returns 0 for non-finite / missing values', () => {
    expect(toAdsNumber(undefined)).toBe(0);
    expect(toAdsNumber(null)).toBe(0);
    expect(toAdsNumber('not-a-number')).toBe(0);
    expect(toAdsNumber(NaN)).toBe(0);
  });
});

describe('parseSpCampaignReportRows', () => {
  it('maps valid rows and coerces numeric columns', () => {
    const raw = [
      {
        date: '2026-09-10',
        campaignId: 'C1',
        campaignName: 'Campaign 1',
        impressions: '100',
        clicks: 5,
        cost: 250.5,
        sales14d: 3000,
        purchases14d: 2,
      },
    ];
    expect(parseSpCampaignReportRows(raw)).toEqual([
      {
        date: '2026-09-10',
        campaignId: 'C1',
        campaignName: 'Campaign 1',
        impressions: 100,
        clicks: 5,
        cost: 250.5,
        sales: 3000,
        orders: 2,
      },
    ]);
  });

  it('drops rows with missing date or campaignId', () => {
    const raw = [
      { date: 'not-a-date', campaignId: 'C1' },
      { date: '2026-09-10', campaignId: '' },
      { date: '2026-09-10' },
      null,
      'garbage',
    ];
    expect(parseSpCampaignReportRows(raw)).toEqual([]);
  });

  it('returns [] for non-array input', () => {
    expect(parseSpCampaignReportRows(undefined)).toEqual([]);
    expect(parseSpCampaignReportRows({ campaigns: [] })).toEqual([]);
  });

  it('defaults campaignName to null when absent', () => {
    const raw = [{ date: '2026-09-10', campaignId: 'C1' }];
    expect(parseSpCampaignReportRows(raw)[0]?.campaignName).toBeNull();
  });
});

describe('parseSpProductReportRows', () => {
  it('maps advertisedAsin/advertisedSku/unitsSoldClicks14d', () => {
    const raw = [
      {
        date: '2026-09-10',
        campaignId: 'C1',
        adGroupId: 'AG1',
        advertisedAsin: 'B000000001',
        advertisedSku: 'SKU1',
        impressions: 10,
        clicks: 1,
        cost: 50,
        sales14d: 1500,
        purchases14d: 1,
        unitsSoldClicks14d: 1,
      },
    ];
    expect(parseSpProductReportRows(raw)).toEqual([
      {
        date: '2026-09-10',
        campaignId: 'C1',
        adGroupId: 'AG1',
        asin: 'B000000001',
        sku: 'SKU1',
        impressions: 10,
        clicks: 1,
        cost: 50,
        sales: 1500,
        orders: 1,
        units: 1,
      },
    ]);
  });

  it('allows null asin/sku/adGroupId', () => {
    const raw = [{ date: '2026-09-10', campaignId: 'C1' }];
    const [row] = parseSpProductReportRows(raw);
    expect(row?.asin).toBeNull();
    expect(row?.sku).toBeNull();
    expect(row?.adGroupId).toBeNull();
  });
});

describe('aggregateDailySpend', () => {
  it('sums multiple campaigns per date', () => {
    const rows = [
      { date: '2026-09-10', campaignId: 'C1', campaignName: null, impressions: 100, clicks: 5, cost: 100, sales: 1000, orders: 1 },
      { date: '2026-09-10', campaignId: 'C2', campaignName: null, impressions: 50, clicks: 2, cost: 50, sales: 500, orders: 1 },
      { date: '2026-09-11', campaignId: 'C1', campaignName: null, impressions: 10, clicks: 1, cost: 10, sales: 100, orders: 0 },
    ];
    expect(aggregateDailySpend(rows)).toEqual([
      { date: '2026-09-10', impressions: 150, clicks: 7, spend: 150, sales: 1500, orders: 2 },
      { date: '2026-09-11', impressions: 10, clicks: 1, spend: 10, sales: 100, orders: 0 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(aggregateDailySpend([])).toEqual([]);
  });
});

describe('parseCampaignsListResponse', () => {
  it('maps campaigns[] with nested budget', () => {
    const raw = {
      campaigns: [
        { campaignId: 'C1', name: 'Campaign 1', state: 'enabled', budget: { budget: 1000, budgetType: 'daily' } },
        { campaignId: 'C2', name: 'Campaign 2', state: 'paused' },
      ],
    };
    expect(parseCampaignsListResponse(raw)).toEqual([
      { campaignId: 'C1', name: 'Campaign 1', state: 'enabled', budget: 1000 },
      { campaignId: 'C2', name: 'Campaign 2', state: 'paused', budget: null },
    ]);
  });

  it('returns [] when campaigns is missing or not an array', () => {
    expect(parseCampaignsListResponse({})).toEqual([]);
    expect(parseCampaignsListResponse(null)).toEqual([]);
    expect(parseCampaignsListResponse({ campaigns: 'nope' })).toEqual([]);
  });

  it('drops entries without campaignId', () => {
    expect(parseCampaignsListResponse({ campaigns: [{ name: 'no id' }] })).toEqual([]);
  });
});

describe('extractNextToken', () => {
  it('returns the token when present', () => {
    expect(extractNextToken({ nextToken: 'abc' })).toBe('abc');
  });

  it('returns null when absent or empty', () => {
    expect(extractNextToken({})).toBeNull();
    expect(extractNextToken({ nextToken: '' })).toBeNull();
    expect(extractNextToken(null)).toBeNull();
  });
});

describe('chunkDateRange', () => {
  it('returns a single chunk when the range fits within maxDays', () => {
    expect(chunkDateRange('2026-09-01', '2026-09-10', 31)).toEqual([{ start: '2026-09-01', end: '2026-09-10' }]);
  });

  it('splits into multiple chunks when the range exceeds maxDays', () => {
    // 2026-01-01 〜 2026-03-05 = 64 days, maxDays=31 → 3 chunks
    const chunks = chunkDateRange('2026-01-01', '2026-03-05', 31);
    expect(chunks).toEqual([
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-03-03' },
      { start: '2026-03-04', end: '2026-03-05' },
    ]);
  });

  it('returns [] for invalid or reversed ranges', () => {
    expect(chunkDateRange('not-a-date', '2026-09-10')).toEqual([]);
    expect(chunkDateRange('2026-09-10', '2026-09-01')).toEqual([]);
  });

  it('handles a single-day range', () => {
    expect(chunkDateRange('2026-09-10', '2026-09-10')).toEqual([{ start: '2026-09-10', end: '2026-09-10' }]);
  });
});

describe('toJpy', () => {
  it('returns the amount unchanged for JPY (case-insensitive)', () => {
    expect(toJpy(1000, 'JPY', null)).toBe(1000);
    expect(toJpy(1000, 'jpy', 999)).toBe(1000);
  });

  it('converts using the given fx rate for non-JPY currency', () => {
    expect(toJpy(10, 'USD', 150)).toBe(1500);
  });

  it('falls back to 150 when fx rate is null/zero', () => {
    expect(toJpy(10, 'USD', null)).toBe(1500);
    expect(toJpy(10, 'USD', 0)).toBe(1500);
  });
});

describe('buildCampaignStatRows', () => {
  const rows = [
    { date: '2026-09-01', campaignId: 'C1', campaignName: 'C1 v1', impressions: 100, clicks: 5, cost: 100, sales: 1000, orders: 1 },
    { date: '2026-09-02', campaignId: 'C1', campaignName: 'C1 v1', impressions: 200, clicks: 8, cost: 200, sales: 2000, orders: 2 },
  ];
  const meta = [{ campaignId: 'C1', name: 'Campaign One', state: 'enabled', budget: 500 }];

  it('applies campaign_state/budget only to the latest date row per campaign', () => {
    const out = buildCampaignStatRows(rows, meta, 'JPY', null);
    expect(out[0]).toMatchObject({ date: '2026-09-01', campaignState: null, budgetJpy: null });
    expect(out[1]).toMatchObject({ date: '2026-09-02', campaignState: 'enabled', budgetJpy: 500 });
  });

  it('falls back to meta name when the report row has no campaignName', () => {
    const rowsNoName = [{ date: '2026-09-01', campaignId: 'C1', campaignName: null, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 }];
    const out = buildCampaignStatRows(rowsNoName, meta, 'JPY', null);
    expect(out[0]?.campaignName).toBe('Campaign One');
  });

  it('converts to JPY and sets amount_original for non-JPY currency', () => {
    const out = buildCampaignStatRows(rows, meta, 'USD', 150);
    expect(out[0]).toMatchObject({ spendJpy: 15000, salesJpy: 150000, amountOriginal: 100, currency: 'USD' });
  });

  it('handles no meta match gracefully', () => {
    const out = buildCampaignStatRows(rows, [], 'JPY', null);
    expect(out[1]).toMatchObject({ campaignState: null, budgetJpy: null });
  });
});

describe('buildProductStatRows', () => {
  it('converts fields and rounds JPY amounts', () => {
    const rows = [
      { date: '2026-09-01', campaignId: 'C1', adGroupId: 'AG1', asin: 'B000000001', sku: 'SKU1', impressions: 10, clicks: 1, cost: 33.4, sales: 999.6, orders: 1, units: 1 },
    ];
    const out = buildProductStatRows(rows, 'JPY', null);
    expect(out[0]).toEqual({
      date: '2026-09-01',
      campaignId: 'C1',
      adGroupId: 'AG1',
      asin: 'B000000001',
      sku: 'SKU1',
      impressions: 10,
      clicks: 1,
      spendJpy: 33,
      salesJpy: 1000,
      orders: 1,
      units: 1,
      amountOriginal: null,
      currency: 'JPY',
    });
  });

  it('preserves null asin (未登録ASIN扱い)', () => {
    const rows = [{ date: '2026-09-01', campaignId: 'C1', adGroupId: null, asin: null, sku: null, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0 }];
    expect(buildProductStatRows(rows, 'JPY', null)[0]?.asin).toBeNull();
  });
});
