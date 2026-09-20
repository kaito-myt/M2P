import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';

import {
  ADS_SPEND_FETCH_TASK_NAME,
  runAdsSpendFetch,
  type AdsSpendFetchDeps,
  type AdsSpendFetchPrisma,
} from '../src/tasks/ads-spend-fetch.js';
import type { AmazonAdsCreds } from '../src/tasks/ads-spend/amazon-ads-client.js';

function makeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => makeLogger(),
  } as unknown as Logger;
}

const CREDS: AmazonAdsCreds = {
  clientId: 'client',
  clientSecret: 'secret',
  refreshToken: 'refresh',
  profileId: 'profile-1',
  region: 'fe',
};

function makePrismaMock() {
  const adSpendUpserts: unknown[] = [];
  const campaignUpserts: unknown[] = [];
  const productUpserts: unknown[] = [];
  const prisma: AdsSpendFetchPrisma = {
    adSpend: {
      upsert: vi.fn(async (args: unknown) => {
        adSpendUpserts.push(args);
        return {};
      }),
    },
    adCampaignStat: {
      upsert: vi.fn(async (args: unknown) => {
        campaignUpserts.push(args);
        return {};
      }),
    },
    adProductStat: {
      upsert: vi.fn(async (args: unknown) => {
        productUpserts.push(args);
        return {};
      }),
    },
    appSettings: {
      findUnique: vi.fn(async () => ({ latest_fx_rate: null })),
    },
  };
  return { prisma, adSpendUpserts, campaignUpserts, productUpserts };
}

const NOW = new Date('2026-09-21T00:00:00.000Z');

const SAMPLE_CAMPAIGN_ROWS = [
  { date: '2026-09-19', campaignId: 'C1', campaignName: 'Campaign 1', impressions: 100, clicks: 5, cost: 100, sales14d: 1000, purchases14d: 1 },
  { date: '2026-09-20', campaignId: 'C1', campaignName: 'Campaign 1', impressions: 120, clicks: 6, cost: 120, sales14d: 1200, purchases14d: 2 },
];

const SAMPLE_PRODUCT_ROWS = [
  {
    date: '2026-09-20',
    campaignId: 'C1',
    adGroupId: 'AG1',
    advertisedAsin: 'B000000001',
    advertisedSku: 'SKU1',
    impressions: 50,
    clicks: 2,
    cost: 40,
    sales14d: 400,
    purchases14d: 1,
    unitsSoldClicks14d: 1,
  },
];

const SAMPLE_CAMPAIGNS_LIST = { campaigns: [{ campaignId: 'C1', name: 'Campaign One', state: 'enabled', budget: { budget: 1000 } }] };

function baseDeps(overrides: Partial<AdsSpendFetchDeps> = {}): AdsSpendFetchDeps {
  const { prisma } = makePrismaMock();
  return {
    logger: makeLogger(),
    prisma,
    creds: CREDS,
    now: NOW,
    sleep: vi.fn(async () => {}),
    fetchCampaignReportRows: vi.fn(async (_c, _s, _e, kind) => (kind === 'SP' ? SAMPLE_CAMPAIGN_ROWS : [])),
    fetchProductReportRows: vi.fn(async () => SAMPLE_PRODUCT_ROWS),
    fetchCampaignsMeta: vi.fn(async () => [{ campaignId: 'C1', name: 'Campaign One', state: 'enabled', budget: 1000 }]),
    fetchCurrency: vi.fn(async () => 'JPY'),
    ...overrides,
  };
}

describe('ADS_SPEND_FETCH_TASK_NAME', () => {
  it('is ads.spend.fetch', () => {
    expect(ADS_SPEND_FETCH_TASK_NAME).toBe('ads.spend.fetch');
  });
});

describe('runAdsSpendFetch — not connected', () => {
  it('skips when creds are missing', async () => {
    const result = await runAdsSpendFetch({ creds: null, logger: makeLogger() });
    expect(result).toEqual({ ok: true, skipped: true, reason: 'not_connected' });
  });
});

describe('runAdsSpendFetch — happy path', () => {
  it('upserts ad_spend (daily aggregate), ad_campaign_stats, and ad_product_stats', async () => {
    const { prisma, adSpendUpserts, campaignUpserts, productUpserts } = makePrismaMock();
    const deps = baseDeps({ prisma });

    const result = await runAdsSpendFetch(deps);

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.days_upserted).toBe(2);
    expect(result.total_spend_jpy).toBe(220); // 100 + 120
    expect(result.campaign_rows).toBe(2); // SP only (SB/SD stubbed to [])
    expect(result.product_rows).toBe(1);

    expect(adSpendUpserts).toHaveLength(2);
    expect(campaignUpserts).toHaveLength(2);
    expect(productUpserts).toHaveLength(1);

    // 最新日 (2026-09-20) の行だけに campaign_state/budget_jpy が乗る
    const latestCampaignUpsert = campaignUpserts.find(
      (u) => (u as { create: { ads_date: string } }).create.ads_date === '2026-09-20',
    ) as { create: Record<string, unknown> } | undefined;
    expect(latestCampaignUpsert?.create.campaign_state).toBe('enabled');
    expect(latestCampaignUpsert?.create.budget_jpy).toBe(1000);

    const earlierCampaignUpsert = campaignUpserts.find(
      (u) => (u as { create: { ads_date: string } }).create.ads_date === '2026-09-19',
    ) as { create: Record<string, unknown> } | undefined;
    expect(earlierCampaignUpsert?.create.campaign_state).toBeNull();
    expect(earlierCampaignUpsert?.create.budget_jpy).toBeNull();

    const productUpsert = productUpserts[0] as { create: Record<string, unknown> };
    expect(productUpsert.create.asin).toBe('B000000001');
    expect(productUpsert.create.ad_product).toBe('SP');
  });

  it('upserts ad_spend with the composite unique key profile_id_ads_date', async () => {
    const { prisma, adSpendUpserts } = makePrismaMock();
    await runAdsSpendFetch(baseDeps({ prisma }));
    const first = adSpendUpserts[0] as { where: { profile_id_ads_date: { profile_id: string; ads_date: string } } };
    expect(first.where.profile_id_ads_date).toEqual({ profile_id: 'profile-1', ads_date: '2026-09-19' });
  });

  it('upserts ad_campaign_stats with the 4-field composite unique key', async () => {
    const { prisma, campaignUpserts } = makePrismaMock();
    await runAdsSpendFetch(baseDeps({ prisma }));
    const first = campaignUpserts[0] as {
      where: { profile_id_ad_product_campaign_id_ads_date: Record<string, string> };
    };
    expect(first.where.profile_id_ad_product_campaign_id_ads_date).toEqual({
      profile_id: 'profile-1',
      ad_product: 'SP',
      campaign_id: 'C1',
      ads_date: '2026-09-19',
    });
  });
});

describe('runAdsSpendFetch — SB/SD best-effort', () => {
  it('continues and records sb_sd_skipped when SB/SD report fetch throws', async () => {
    const { prisma } = makePrismaMock();
    const fetchCampaignReportRows = vi.fn(async (_c: unknown, _s: string, _e: string, kind: string) => {
      if (kind === 'SP') return SAMPLE_CAMPAIGN_ROWS;
      throw new Error(`403 not permitted for ${kind}`);
    });
    const deps = baseDeps({ prisma, fetchCampaignReportRows });

    const result = await runAdsSpendFetch(deps);

    expect(result.ok).toBe(true);
    expect(result.sb_sd_skipped).toEqual(['SB', 'SD']);
    // SP 側は正常に反映される
    expect(result.campaign_rows).toBe(2);
  });

  it('does not fail the whole task when campaigns/list (meta) fetch throws', async () => {
    const { prisma, campaignUpserts } = makePrismaMock();
    const fetchCampaignsMeta = vi.fn(async () => {
      throw new Error('sp/campaigns/list unavailable');
    });
    const deps = baseDeps({ prisma, fetchCampaignsMeta });

    const result = await runAdsSpendFetch(deps);

    expect(result.ok).toBe(true);
    expect(campaignUpserts).toHaveLength(2);
    // メタが取れないので campaign_state/budget は常に null
    for (const u of campaignUpserts) {
      expect((u as { create: Record<string, unknown> }).create.campaign_state).toBeNull();
      expect((u as { create: Record<string, unknown> }).create.budget_jpy).toBeNull();
    }
  });
});

describe('runAdsSpendFetch — non-JPY currency conversion', () => {
  it('converts spend/sales via fx rate and records amount_original', async () => {
    const { prisma, adSpendUpserts } = makePrismaMock();
    prisma.appSettings.findUnique = vi.fn(async () => ({ latest_fx_rate: 150 }));
    const deps = baseDeps({ prisma, fetchCurrency: vi.fn(async () => 'USD') });

    const result = await runAdsSpendFetch(deps);

    expect(result.total_spend_jpy).toBe((100 + 120) * 150);
    const first = adSpendUpserts[0] as { create: Record<string, unknown> };
    expect(first.create.currency).toBe('USD');
    expect(first.create.amount_original).toBe(100);
    expect(first.create.spend_jpy).toBe(15000);
  });
});

describe('runAdsSpendFetch — date chunking', () => {
  it('calls fetchCampaignReportRows once per SP/SB/SD per chunk (30-day window fits in one chunk)', async () => {
    const { prisma } = makePrismaMock();
    const fetchCampaignReportRows = vi.fn(async (_c: unknown, _s: string, _e: string, kind: string) =>
      kind === 'SP' ? SAMPLE_CAMPAIGN_ROWS : [],
    );
    const deps = baseDeps({ prisma, fetchCampaignReportRows });

    await runAdsSpendFetch(deps);

    // 30 日の窓は 31 日制限に収まるため 1 チャンク × (SP + SB + SD) = 3 回
    expect(fetchCampaignReportRows).toHaveBeenCalledTimes(3);
  });
});
