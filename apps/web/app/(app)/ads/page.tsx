/**
 * S-030 広告（Amazon Ads）ダッシュボード (F-090拡張, 2026-09-21).
 *
 * RSC page: 接続状態（最終取得日時＋「今すぐ取得」）、当月 KPI（広告費/売上/ROAS/ACOS/
 * インプレッション/クリック/CTR/CPC/注文数、前月比）、日次トレンド、キャンペーン別、
 * 書籍(ASIN)別（広告費 vs 印税）を表示する。期間は当月/先月/直近30日の3択。
 *
 * 仕様根拠: 親タスク指示 (2026-09-21) / docs/04 §S-030 / docs/05 §追加 DB テーブル・
 *           追加 worker タスク (ads.spend.fetch 拡張)。
 */
import type { Metadata } from 'next';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import {
  aggregateCampaignRows,
  buildAdsBookRows,
  buildAdsTrend,
  computeAdsKpi,
  pctChange,
  previousAdsWindow,
  resolveAdsPeriod,
  type AdCampaignStatRaw,
  type AdProductStatRaw,
  type AdsDailyRow,
} from '@/lib/ads-core';
import { formatRelativeTime } from '@/lib/sales-fetch-view';

import { PageHeading } from '@/components/common/page-heading';
import { AdsConnectionBanner } from '@/components/ads/ads-connection-banner';
import { AdsPeriodSelector } from '@/components/ads/ads-period-selector';
import { AdsKpiStripe } from '@/components/ads/ads-kpi-stripe';
import { AdsTrendChart } from '@/components/ads/ads-trend-chart';
import { AdsCampaignTable } from '@/components/ads/ads-campaign-table';
import { AdsBookTable } from '@/components/ads/ads-book-table';

export const metadata: Metadata = {
  title: `${messages.ads.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.ads;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

function currentYearMonth(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default async function AdsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const now = new Date();
  const range = resolveAdsPeriod(sp(params, 'period'), now);
  const prevRange = previousAdsWindow(range);

  const [
    latestFetch,
    dailyRowsRaw,
    prevAgg,
    campaignRowsRaw,
    productRowsRaw,
  ] = await Promise.all([
    prisma.adSpend.findFirst({ orderBy: { fetched_at: 'desc' }, select: { fetched_at: true } }),
    prisma.adSpend.findMany({
      where: { ads_date: { gte: range.fromDate, lte: range.toDate } },
      select: { ads_date: true, spend_jpy: true, sales_jpy: true, impressions: true, clicks: true, orders: true },
      orderBy: { ads_date: 'asc' },
    }),
    prisma.adSpend.aggregate({
      where: { ads_date: { gte: prevRange.fromDate, lte: prevRange.toDate } },
      _sum: { spend_jpy: true, sales_jpy: true },
    }),
    prisma.adCampaignStat.findMany({
      where: { ads_date: { gte: range.fromDate, lte: range.toDate } },
      select: {
        campaign_id: true,
        campaign_name: true,
        campaign_state: true,
        budget_jpy: true,
        ads_date: true,
        spend_jpy: true,
        sales_jpy: true,
        clicks: true,
        impressions: true,
        orders: true,
      },
    }),
    prisma.adProductStat.findMany({
      where: { ads_date: { gte: range.fromDate, lte: range.toDate } },
      select: { asin: true, spend_jpy: true, sales_jpy: true, orders: true },
    }),
  ]);

  const asins = [...new Set(productRowsRaw.map((r) => r.asin).filter((a): a is string => !!a))];
  const books = asins.length > 0
    ? await prisma.book.findMany({ where: { asin: { in: asins } }, select: { id: true, title: true, asin: true } })
    : [];
  const bookTitleByAsin = new Map(books.filter((b) => b.asin).map((b) => [b.asin as string, b.title]));
  const bookIdByAsin = new Map(books.filter((b) => b.asin).map((b) => [b.asin as string, b.id]));

  const salesRecords = books.length > 0
    ? await prisma.salesRecord.findMany({
        where: { year_month: currentYearMonth(now), book_id: { in: books.map((b) => b.id) } },
        select: { book_id: true, royalty_jpy: true },
      })
    : [];
  const bookIdToAsin = new Map(books.filter((b) => b.asin).map((b) => [b.id, b.asin as string]));
  const royaltyByAsin = new Map<string, number>();
  for (const rec of salesRecords) {
    const asin = bookIdToAsin.get(rec.book_id);
    if (asin) royaltyByAsin.set(asin, rec.royalty_jpy);
  }

  const dailyRows: AdsDailyRow[] = dailyRowsRaw.map((r) => ({
    ads_date: r.ads_date,
    spend_jpy: r.spend_jpy,
    sales_jpy: r.sales_jpy,
    impressions: r.impressions,
    clicks: r.clicks,
    orders: r.orders,
  }));
  const kpi = computeAdsKpi(dailyRows);
  const momSpendPct = pctChange(kpi.spendJpy, prevAgg._sum.spend_jpy ?? 0);
  const momSalesPct = pctChange(kpi.salesJpy, prevAgg._sum.sales_jpy ?? 0);
  const trend = buildAdsTrend(dailyRows);

  const campaignRowsInput: AdCampaignStatRaw[] = campaignRowsRaw.map((r) => ({
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    campaign_state: r.campaign_state,
    budget_jpy: r.budget_jpy,
    ads_date: r.ads_date,
    spend_jpy: r.spend_jpy,
    sales_jpy: r.sales_jpy,
    clicks: r.clicks,
    impressions: r.impressions,
    orders: r.orders,
  }));
  const campaignRows = aggregateCampaignRows(campaignRowsInput);

  const productRowsInput: AdProductStatRaw[] = productRowsRaw.map((r) => ({
    asin: r.asin,
    spend_jpy: r.spend_jpy,
    sales_jpy: r.sales_jpy,
    orders: r.orders,
  }));
  const bookRows = buildAdsBookRows(productRowsInput, bookTitleByAsin, royaltyByAsin);

  const connected = latestFetch != null;
  const lastFetchedAt = latestFetch ? formatRelativeTime(latestFetch.fetched_at.toISOString(), now) : null;

  return (
    <div className="flex flex-col gap-space-loose" data-testid="ads-page">
      <PageHeading eyebrow={m.breadcrumbAnalytics} title={m.pageTitle} description={m.pageSubtitle} />

      <AdsConnectionBanner connected={connected} lastFetchedAt={lastFetchedAt} />

      <div className="flex flex-wrap items-center justify-between gap-space-snug">
        <AdsPeriodSelector currentPeriod={range.period} />
      </div>

      <section aria-labelledby="ads-kpi-heading">
        <h2 id="ads-kpi-heading" className="sr-only">KPI サマリ</h2>
        <AdsKpiStripe kpi={kpi} momSpendPct={momSpendPct} momSalesPct={momSalesPct} />
      </section>

      <AdsTrendChart data={trend} />

      <section aria-labelledby="ads-campaigns-heading" className="flex flex-col gap-space-snug">
        <h2 id="ads-campaigns-heading" className="text-card-title text-foreground">
          {m.campaigns.sectionTitle}
        </h2>
        <AdsCampaignTable rows={campaignRows} />
      </section>

      <section aria-labelledby="ads-books-heading" className="flex flex-col gap-space-snug">
        <h2 id="ads-books-heading" className="text-card-title text-foreground">
          {m.books.sectionTitle}
        </h2>
        <AdsBookTable rows={bookRows} bookIdByAsin={bookIdByAsin} />
      </section>
    </div>
  );
}
