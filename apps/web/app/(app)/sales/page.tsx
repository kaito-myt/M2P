/**
 * S-017 売上・KPI ダッシュボード (T-08-07, F-037/F-038/F-039, T-12-07).
 *
 * RSC page: 期間/アカウント/ジャンルフィルタを searchParams から読み取り、
 * getBooksKpiList + getSalesKpiSummary で集計し、Client Components に渡す。
 *
 * Filter approach: searchParams → RSC re-render (cost dashboard パターンに準拠)。
 *
 * Phase 1: 売上推移グラフ・ヒートマップは book-level aggregates (per-period)。
 *          per-month breakdown は T-08-08 クエリ拡張後に改善可能。
 * Phase 2 (T-12-07): 自動取得ステータスバナー追加。
 *
 * 仕様根拠: docs/04 S-017 / docs/05 §10 / SP-08 T-08-07 / SP-12 T-12-07
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';
import { getBooksKpiList, getSalesKpiSummary, getMonthlyGenreSales } from '@a2p/db/books-kpi';

import { messages } from '@/lib/messages';
import {
  serializeBookKpiRow,
  buildMonthRange,
  monthRangeBounds,
  parsePeriodParam,
  buildTrendChartFromAggregates,
  buildHeatmapFromAggregates,
  buildSalesInsights,
  type BookKpiRowSerialized,
} from '@/lib/sales-kpi-view';
import {
  getLatestSalesFetchRun,
  serializeSalesFetchRun,
  type SalesFetchRunSerialized,
} from '@/lib/sales-fetch-status';

import { SalesKpiShell } from '@/components/sales/sales-kpi-shell';
import { SalesKpiStripe } from '@/components/sales/sales-kpi-stripe';
import { SalesTrendChart } from '@/components/sales/sales-trend-chart';
import { SalesInsights } from '@/components/sales/sales-insights';
import { GenreMonthHeatmap } from '@/components/sales/genre-month-heatmap';
import { BooksKpiTable } from '@/components/sales/books-kpi-table';
import { SalesFetchStatusBanner } from '@/components/sales/sales-fetch-status-banner';
import { SalesReportImport } from '@/components/sales/sales-report-import';
import { PageHeading } from '@/components/common/page-heading';

export const metadata: Metadata = {
  title: `${messages.salesKpi.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.salesKpi;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function SalesKpiPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Parse filter params。既定は直近6ヶ月 (period=1 だと当月のみ=売上未計上でグラフが空に
  // なりがちなため。当月KENPは翌月確定なので当月単独表示は実質いつも空になる)。
  const periodRaw = sp(params, 'period') ?? '6';
  const accountId = sp(params, 'accountId');
  const genre = sp(params, 'genre');

  const periodMonths = parsePeriodParam(periodRaw);
  const months = buildMonthRange(periodMonths);
  const bounds = monthRangeBounds(months);

  const filter = {
    accountId: accountId && accountId !== 'all' ? accountId : undefined,
    genre: genre && genre !== 'all' ? genre : undefined,
    periodFrom: bounds?.from,
    periodTo: bounds?.to,
  };

  // Parallel DB queries
  const [kpiRows, summary, accounts, monthlyGenreSales] = await Promise.all([
    getBooksKpiList(prisma, filter),
    getSalesKpiSummary(prisma, filter),
    prisma.account.findMany({
      select: { id: true, pen_name: true },
      orderBy: { pen_name: 'asc' },
    }),
    getMonthlyGenreSales(prisma, filter),
  ]);

  // シングルユーザー運用: フィルタ指定アカウントまたは最初の active アカウントを対象にする
  const targetAccountId =
    accountId && accountId !== 'all'
      ? accountId
      : accounts[0]?.id ?? null;

  let latestRun: SalesFetchRunSerialized | null = null;
  if (targetAccountId) {
    const run = await getLatestSalesFetchRun(targetAccountId);
    latestRun = run ? serializeSalesFetchRun(run) : null;
  }

  const serializedBooks: BookKpiRowSerialized[] = kpiRows.map(serializeBookKpiRow);

  const heatmapMatrix = buildHeatmapFromAggregates(monthlyGenreSales, months);
  // トレンドの積み上げ順とヒートマップの行順を揃える (同じジャンル=同じ色/順序)。
  const trendData = buildTrendChartFromAggregates(monthlyGenreSales, months, heatmapMatrix.genres);

  const insights = buildSalesInsights(serializedBooks, trendData);

  const isEmpty = summary.total_books === 0 && summary.total_royalty_jpy === 0;

  return (
    <div className="flex flex-col gap-space-loose" data-testid="sales-kpi-page">
      <PageHeading
        eyebrow={m.breadcrumbAnalytics}
        title={m.pageTitle}
        description={m.pageSubtitle}
        actions={
          <>
            <SalesReportImport accounts={accounts} />
            <Link
              href="/sales/manual"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-default bg-charcoal px-3 py-2 text-button-sm text-cream-light hover:bg-charcoal/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              data-testid="manual-input-cta"
            >
              {m.manualInputButton}
            </Link>
          </>
        }
      />

      {/* 自動取得ステータスバナー (T-12-07, F-038) */}
      {targetAccountId && (
        <SalesFetchStatusBanner
          latestRun={latestRun}
          accountId={targetAccountId}
        />
      )}

      <SalesKpiShell
        accounts={accounts}
        currentPeriod={periodRaw}
        currentAccountId={accountId ?? 'all'}
        currentGenre={genre ?? 'all'}
      >
        {/* KPI stripe — always shown */}
        <section aria-labelledby="sales-kpi-heading">
          <h2 id="sales-kpi-heading" className="sr-only">KPI サマリ</h2>
          <SalesKpiStripe summary={summary} />
        </section>

        {isEmpty ? (
          /* Empty state */
          <div
            className="flex flex-col items-center gap-space-snug rounded-card border border-border-warm bg-cream-light p-space-loose text-center"
            data-testid="sales-kpi-empty"
          >
            <p className="text-body font-medium text-charcoal">{m.empty.title}</p>
            <p className="text-body text-muted">{m.empty.body}</p>
            <Link
              href="/sales/manual"
              className="mt-2 inline-flex cursor-pointer items-center rounded-card bg-charcoal px-4 py-2 text-button-sm text-white hover:bg-charcoal/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {m.empty.cta}
            </Link>
          </div>
        ) : (
          <>
            {/* 売上推移・ヒートマップ (各横幅いっぱいに縦積み) */}
            <div className="flex flex-col gap-space-loose">
              <SalesTrendChart data={trendData} />
              <GenreMonthHeatmap matrix={heatmapMatrix} />
            </div>

            {/* 分析サマリ (売れ筋 / ジャンル構成 / 前月比 / 黒字・ゼロ売上) */}
            <SalesInsights insights={insights} />

            {/* Books KPI table */}
            <section aria-labelledby="books-kpi-heading">
              <h2
                id="books-kpi-heading"
                className="mb-space-snug text-card-title text-foreground"
              >
                {m.table.sectionTitle}
              </h2>
              <p className="mb-space-snug text-caption text-muted">
                {m.table.virtualizeNote}
              </p>
              <BooksKpiTable books={serializedBooks} />
            </section>
          </>
        )}
      </SalesKpiShell>
    </div>
  );
}
