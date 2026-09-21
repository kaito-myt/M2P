/**
 * [F-090 / F-090拡張] `ads.spend.fetch` — Amazon Advertising API から広告費・パフォーマンスを
 * 取得し、日次合計(`ad_spend`)＋キャンペーン別(`ad_campaign_stats`)＋書籍(ASIN)別
 * (`ad_product_stats`) を upsert する。当月分は cost-meter / 純利益に自動算入される。
 *
 * creds(AMAZON_ADS_*) が未設定なら no-op でスキップ(未接続扱い)。直近 ~30 日を毎回上書き
 * (遅延 attribution を反映)。Reporting v3 の DAILY は 1 リクエスト最大 31 日のため
 * `chunkDateRange` で分割してから取得する。
 *
 * 取得内訳:
 *   - SP `spCampaigns`(campaign 粒度) → 日次合計を `ad_spend` へ(既存 F-090 挙動を維持) ＋
 *     キャンペーン別を `ad_campaign_stats` へ。
 *   - SP `spAdvertisedProduct`(ASIN 粒度) → `ad_product_stats` へ。
 *   - `POST /sp/campaigns/list` でキャンペーンの name/state/budget を取得し、各キャンペーンの
 *     最新日行にのみ反映(`buildCampaignStatRows`)。
 *   - SB/SD (`sbCampaigns`/`sdCampaigns`) は best-effort — KDP 著者アカウントでは権限が無い
 *     ことがあるため、失敗しても warn ログで skip しタスク全体は継続する。
 *
 * 通貨: JP マーケットプレイス(region=fe)は通常 JPY。`fetchProfileCurrency` で確認し、
 * JPY 以外なら `app_settings.latest_fx_rate` で円換算する(既存 `ad_spend.amount_original` と同じ扱い)。
 *
 * ※ 公式 API のため堅牢だが、実 creds 到着後に 1 回実走して列名/通貨/SB・SD 可否を最終検証すること。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { resolveAmazonAdsCredentials } from '@a2p/credentials';
import { prisma as defaultPrisma } from '@a2p/db';

import {
  adsCredsFromEnv,
  campaignReportConfig,
  fetchCampaignsListRaw,
  fetchProfileCurrency,
  fetchReportRows,
  productReportConfig,
  type AdProductKind,
  type AmazonAdsCreds,
} from './ads-spend/amazon-ads-client.js';
import {
  aggregateDailySpend,
  buildCampaignStatRows,
  buildProductStatRows,
  chunkDateRange,
  parseCampaignsListResponse,
  parseSpCampaignReportRows,
  parseSpProductReportRows,
  toJpy,
  type CampaignMeta,
  type CampaignStatUpsertRow,
  type ProductStatUpsertRow,
  type SpCampaignRow,
  type SpProductRow,
} from './ads-spend/ads-report-transform.js';

export const ADS_SPEND_FETCH_TASK_NAME = 'ads.spend.fetch';

export interface AdsSpendFetchResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  days_upserted?: number;
  total_spend_jpy?: number;
  campaign_rows?: number;
  product_rows?: number;
  sb_sd_skipped?: AdProductKind[];
}

// ---------------------------------------------------------------------------
// DI 境界 — prisma は narrow interface (テスト容易性)
// ---------------------------------------------------------------------------

export interface AdsSpendFetchPrisma {
  adSpend: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  adCampaignStat: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  adProductStat: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  appSettings: {
    findUnique: (args: unknown) => Promise<{ latest_fx_rate: unknown } | null>;
  };
}

type SleepFn = (ms: number) => Promise<void>;

export interface AdsSpendFetchDeps {
  logger?: Logger;
  prisma?: AdsSpendFetchPrisma;
  env?: Record<string, string | undefined>;
  creds?: AmazonAdsCreds | null;
  now?: Date;
  sleep?: SleepFn;
  /** DI: キャンペーン粒度レポートの生行を取得する (SP/SB/SD)。既定は実 API 呼び出し。 */
  fetchCampaignReportRows?: (
    creds: AmazonAdsCreds,
    startDate: string,
    endDate: string,
    kind: AdProductKind,
    sleep: SleepFn,
  ) => Promise<unknown[]>;
  /** DI: ASIN 粒度レポートの生行を取得する (SP のみ)。既定は実 API 呼び出し。 */
  fetchProductReportRows?: (
    creds: AmazonAdsCreds,
    startDate: string,
    endDate: string,
    sleep: SleepFn,
  ) => Promise<unknown[]>;
  /** DI: キャンペーン一覧メタ(name/state/budget)を取得する。既定は実 API 呼び出し。 */
  fetchCampaignsMeta?: (creds: AmazonAdsCreds, sleep: SleepFn) => Promise<CampaignMeta[]>;
  /** DI: プロファイル通貨を取得する。既定は実 API 呼び出し。 */
  fetchCurrency?: (creds: AmazonAdsCreds) => Promise<string>;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function defaultFetchCampaignsMeta(creds: AmazonAdsCreds, sleep: SleepFn): Promise<CampaignMeta[]> {
  const pages = await fetchCampaignsListRaw(creds, sleep);
  return pages.flatMap((page) => parseCampaignsListResponse(page));
}

export async function runAdsSpendFetch(deps: AdsSpendFetchDeps = {}): Promise<AdsSpendFetchResult> {
  const log = deps.logger ?? createLogger(`worker.${ADS_SPEND_FETCH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as AdsSpendFetchPrisma);
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  // 接続情報は M2P ポータルの API 管理 (DB) → env の順。DB 解決に失敗したら env のみで続行。
  const creds =
    deps.creds !== undefined
      ? deps.creds
      : ((await resolveAmazonAdsCredentials({ env }).catch((err: unknown) => {
          log.warn({ err }, 'Amazon Ads credentials resolve failed — falling back to env');
          return null;
        })) ?? adsCredsFromEnv(env));
  if (!creds) {
    log.info({ task: ADS_SPEND_FETCH_TASK_NAME }, 'Amazon Ads creds not configured — skip');
    return { ok: true, skipped: true, reason: 'not_connected' };
  }

  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const fetchCampaignReportRows =
    deps.fetchCampaignReportRows ??
    ((c, start, end, kind, s) => fetchReportRows(c, start, end, campaignReportConfig(kind), s));
  const fetchProductReportRows =
    deps.fetchProductReportRows ?? ((c, start, end, s) => fetchReportRows(c, start, end, productReportConfig(), s));
  const fetchCampaignsMeta = deps.fetchCampaignsMeta ?? defaultFetchCampaignsMeta;
  const fetchCurrency = deps.fetchCurrency ?? fetchProfileCurrency;

  const now = deps.now ?? new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const chunks = chunkDateRange(ymd(start), ymd(end), 31);

  const currency = await fetchCurrency(creds);
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { latest_fx_rate: true } });
  const fxRate = settings?.latest_fx_rate != null ? Number(settings.latest_fx_rate) : null;

  // --- SP: campaign 粒度 + ASIN 粒度 を全チャンク分収集 ---
  const spCampaignRows: SpCampaignRow[] = [];
  const spProductRows: SpProductRow[] = [];
  // --- SB/SD: best-effort (失敗しても warn で継続) ---
  const bestEffortCampaignRows = new Map<AdProductKind, SpCampaignRow[]>([
    ['SB', []],
    ['SD', []],
  ]);
  const sbSdSkipped: AdProductKind[] = [];

  for (const chunk of chunks) {
    const rawCampaign = await fetchCampaignReportRows(creds, chunk.start, chunk.end, 'SP', sleep);
    spCampaignRows.push(...parseSpCampaignReportRows(rawCampaign));

    const rawProduct = await fetchProductReportRows(creds, chunk.start, chunk.end, sleep);
    spProductRows.push(...parseSpProductReportRows(rawProduct));

    for (const kind of ['SB', 'SD'] as const) {
      try {
        const rawBestEffort = await fetchCampaignReportRows(creds, chunk.start, chunk.end, kind, sleep);
        bestEffortCampaignRows.get(kind)!.push(...parseSpCampaignReportRows(rawBestEffort));
      } catch (err) {
        if (!sbSdSkipped.includes(kind)) sbSdSkipped.push(kind);
        log.warn(
          { task: ADS_SPEND_FETCH_TASK_NAME, ad_product: kind, err: err instanceof Error ? err.message : String(err) },
          `${kind} report fetch failed — skip (best-effort, likely no permission on this profile)`,
        );
      }
    }
  }

  // --- キャンペーンメタ (name/state/budget) best-effort ---
  let campaignsMeta: CampaignMeta[] = [];
  try {
    campaignsMeta = await fetchCampaignsMeta(creds, sleep);
  } catch (err) {
    log.warn(
      { task: ADS_SPEND_FETCH_TASK_NAME, err: err instanceof Error ? err.message : String(err) },
      'sp/campaigns/list fetch failed — campaign name/state/budget will be omitted',
    );
  }

  // --- ad_spend (日次合計, SP のみ・既存 F-090 挙動を維持) ---
  const dailyRows = aggregateDailySpend(spCampaignRows);
  let totalSpendJpy = 0;
  for (const r of dailyRows) {
    const spendJpy = Math.round(toJpy(r.spend, currency, fxRate));
    const salesJpy = Math.round(toJpy(r.sales, currency, fxRate));
    totalSpendJpy += spendJpy;
    const yearMonth = r.date.slice(0, 7);
    const isJpy = !currency || currency.toUpperCase() === 'JPY';
    await prisma.adSpend.upsert({
      where: { profile_id_ads_date: { profile_id: creds.profileId, ads_date: r.date } },
      create: {
        ads_date: r.date,
        year_month: yearMonth,
        profile_id: creds.profileId,
        spend_jpy: spendJpy,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        sales_jpy: salesJpy,
        orders: Math.round(r.orders),
        currency: isJpy ? 'JPY' : currency,
        amount_original: isJpy ? null : r.spend,
        source: 'amazon_ads_api',
      },
      update: {
        year_month: yearMonth,
        spend_jpy: spendJpy,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        sales_jpy: salesJpy,
        orders: Math.round(r.orders),
        currency: isJpy ? 'JPY' : currency,
        amount_original: isJpy ? null : r.spend,
        fetched_at: new Date(),
      },
    });
  }

  // --- ad_campaign_stats (SP + best-effort SB/SD) ---
  const spCampaignStatRows = buildCampaignStatRows(spCampaignRows, campaignsMeta, currency, fxRate);
  const sbStatRows = buildCampaignStatRows(bestEffortCampaignRows.get('SB')!, [], currency, fxRate);
  const sdStatRows = buildCampaignStatRows(bestEffortCampaignRows.get('SD')!, [], currency, fxRate);
  const allCampaignStatRows: Array<{ kind: AdProductKind; row: CampaignStatUpsertRow }> = [
    ...spCampaignStatRows.map((row) => ({ kind: 'SP' as const, row })),
    ...sbStatRows.map((row) => ({ kind: 'SB' as const, row })),
    ...sdStatRows.map((row) => ({ kind: 'SD' as const, row })),
  ];

  for (const { kind, row } of allCampaignStatRows) {
    const yearMonth = row.date.slice(0, 7);
    await prisma.adCampaignStat.upsert({
      where: {
        profile_id_ad_product_campaign_id_ads_date: {
          profile_id: creds.profileId,
          ad_product: kind,
          campaign_id: row.campaignId,
          ads_date: row.date,
        },
      },
      create: {
        ads_date: row.date,
        year_month: yearMonth,
        profile_id: creds.profileId,
        ad_product: kind,
        campaign_id: row.campaignId,
        campaign_name: row.campaignName,
        campaign_state: row.campaignState,
        budget_jpy: row.budgetJpy,
        spend_jpy: row.spendJpy,
        impressions: row.impressions,
        clicks: row.clicks,
        sales_jpy: row.salesJpy,
        orders: row.orders,
        currency: row.currency,
        amount_original: row.amountOriginal,
      },
      update: {
        year_month: yearMonth,
        campaign_name: row.campaignName,
        // campaign_state/budget_jpy は最新日行のみ非 null (buildCampaignStatRows で決定済み)。
        // 過去行を誤って null 上書きしないよう、null のときは更新しない。
        ...(row.campaignState != null ? { campaign_state: row.campaignState } : {}),
        ...(row.budgetJpy != null ? { budget_jpy: row.budgetJpy } : {}),
        spend_jpy: row.spendJpy,
        impressions: row.impressions,
        clicks: row.clicks,
        sales_jpy: row.salesJpy,
        orders: row.orders,
        currency: row.currency,
        amount_original: row.amountOriginal,
        fetched_at: new Date(),
      },
    });
  }

  // --- ad_product_stats (SP のみ) ---
  const productStatRows: ProductStatUpsertRow[] = buildProductStatRows(spProductRows, currency, fxRate);
  for (const row of productStatRows) {
    const yearMonth = row.date.slice(0, 7);
    await prisma.adProductStat.upsert({
      where: {
        profile_id_ad_product_campaign_id_asin_ads_date: {
          profile_id: creds.profileId,
          ad_product: 'SP',
          campaign_id: row.campaignId,
          asin: row.asin,
          ads_date: row.date,
        },
      },
      create: {
        ads_date: row.date,
        year_month: yearMonth,
        profile_id: creds.profileId,
        ad_product: 'SP',
        campaign_id: row.campaignId,
        ad_group_id: row.adGroupId,
        asin: row.asin,
        sku: row.sku,
        spend_jpy: row.spendJpy,
        impressions: row.impressions,
        clicks: row.clicks,
        sales_jpy: row.salesJpy,
        orders: row.orders,
        units: row.units,
        currency: row.currency,
        amount_original: row.amountOriginal,
      },
      update: {
        year_month: yearMonth,
        ad_group_id: row.adGroupId,
        sku: row.sku,
        spend_jpy: row.spendJpy,
        impressions: row.impressions,
        clicks: row.clicks,
        sales_jpy: row.salesJpy,
        orders: row.orders,
        units: row.units,
        currency: row.currency,
        amount_original: row.amountOriginal,
        fetched_at: new Date(),
      },
    });
  }

  log.info(
    {
      task: ADS_SPEND_FETCH_TASK_NAME,
      days: dailyRows.length,
      total_spend_jpy: totalSpendJpy,
      campaign_rows: allCampaignStatRows.length,
      product_rows: productStatRows.length,
      currency,
      sb_sd_skipped: sbSdSkipped,
    },
    'ad spend + performance upserted',
  );

  return {
    ok: true,
    days_upserted: dailyRows.length,
    total_spend_jpy: totalSpendJpy,
    campaign_rows: allCampaignStatRows.length,
    product_rows: productStatRows.length,
    ...(sbSdSkipped.length > 0 ? { sb_sd_skipped: sbSdSkipped } : {}),
  };
}

export const adsSpendFetchTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  await runAdsSpendFetch();
};
