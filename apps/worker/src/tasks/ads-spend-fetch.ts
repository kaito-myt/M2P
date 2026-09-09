/**
 * [F-090] `ads.spend.fetch` — Amazon Advertising API から Sponsored Products の日次広告費を
 * 取得し `ad_spend` に upsert する。当月分は cost-meter / 純利益に自動算入される。
 *
 * creds(AMAZON_ADS_*) が未設定なら no-op でスキップ(未接続扱い)。JP マーケットプレイスの cost は
 * JPY なので spend_jpy にそのまま丸めて格納する。直近 ~30 日を毎回上書き(遅延 attribution を反映)。
 *
 * ※ 公式 API のため堅牢だが、実 creds 到着後に 1 回実走して列名/通貨を最終検証すること。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { adsCredsFromEnv, fetchDailyAdSpend, type AmazonAdsCreds } from './ads-spend/amazon-ads-client.js';

export const ADS_SPEND_FETCH_TASK_NAME = 'ads.spend.fetch';

export interface AdsSpendFetchResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  days_upserted?: number;
  total_spend_jpy?: number;
}

export interface AdsSpendFetchDeps {
  logger?: Logger;
  prisma?: typeof defaultPrisma;
  env?: Record<string, string | undefined>;
  creds?: AmazonAdsCreds | null;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function runAdsSpendFetch(deps: AdsSpendFetchDeps = {}): Promise<AdsSpendFetchResult> {
  const log = deps.logger ?? createLogger(`worker.${ADS_SPEND_FETCH_TASK_NAME}`);
  const prisma = deps.prisma ?? defaultPrisma;
  const env = deps.env ?? (process.env as Record<string, string | undefined>);
  const creds = deps.creds !== undefined ? deps.creds : adsCredsFromEnv(env);
  if (!creds) {
    log.info({ task: ADS_SPEND_FETCH_TASK_NAME }, 'Amazon Ads creds not configured — skip');
    return { ok: true, skipped: true, reason: 'not_connected' };
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  const rows = await fetchDailyAdSpend(creds, ymd(start), ymd(end), sleep);
  let total = 0;
  for (const r of rows) {
    const spendJpy = Math.round(r.spend);
    total += spendJpy;
    const yearMonth = r.date.slice(0, 7);
    await prisma.adSpend.upsert({
      where: { profile_id_ads_date: { profile_id: creds.profileId, ads_date: r.date } },
      create: {
        ads_date: r.date,
        year_month: yearMonth,
        profile_id: creds.profileId,
        spend_jpy: spendJpy,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        sales_jpy: Math.round(r.sales),
        orders: Math.round(r.orders),
        currency: 'JPY',
        source: 'amazon_ads_api',
      },
      update: {
        year_month: yearMonth,
        spend_jpy: spendJpy,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        sales_jpy: Math.round(r.sales),
        orders: Math.round(r.orders),
        fetched_at: new Date(),
      },
    });
  }
  log.info({ task: ADS_SPEND_FETCH_TASK_NAME, days: rows.length, total_spend_jpy: total }, 'ad spend upserted');
  return { ok: true, days_upserted: rows.length, total_spend_jpy: total };
}

export const adsSpendFetchTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  await runAdsSpendFetch();
};
