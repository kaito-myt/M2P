/**
 * S-ANP-11 — 売上ダッシュボード (docs/11-anp-design.md §3.5 F-ANP-41)。
 * 当月 KPI (売上 / ビュー / スキ / 購入者 / MRR) と前月比、6 か月推移、アカウント別、記事別トップ。
 * データは `note.sales.fetch` が取り込む `note_sales` / `note_membership_stats` (当月実績)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { computeSalesDashboard, percentChange, recentMonthKeys } from '@/lib/analytics-core';
import { messages } from '@/lib/messages';

import { BarList, KpiCard, TrendTable } from '../dashboard-parts';

export const dynamic = 'force-dynamic';

const m = messages.analytics.sales;
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const num = (n: number) => n.toLocaleString('ja-JP');

export default async function SalesDashboardPage() {
  const now = new Date();
  const months = recentMonthKeys(now, 6);
  const [accounts, articles, sales, membership, lastFetched] = await Promise.all([
    prisma.noteAccount.findMany({ where: { status: { not: 'archived' } }, select: { id: true, display_name: true, niche: true, status: true, followers_total: true } }),
    prisma.noteArticle.findMany({
      select: { id: true, note_account_id: true, title: true, paid: true, price_jpy: true, publish_status: true, published_at: true, note_url: true },
    }),
    prisma.noteSalesRecord.findMany({
      where: { year_month: { in: months } },
      select: { note_article_id: true, year_month: true, revenue_jpy: true, views: true, likes: true, buyers: true },
    }),
    prisma.noteMembershipStat.findMany({
      where: { year_month: { in: months } },
      select: { note_account_id: true, year_month: true, subscribers: true, mrr_jpy: true },
    }),
    prisma.noteSalesRecord.findFirst({ orderBy: { fetched_at: 'desc' }, select: { fetched_at: true } }),
  ]);
  const d = computeSalesDashboard({ accounts, articles, sales, membership, now });
  const delta = (cur: number, prev: number) => percentChange(cur, prev);

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">
          {m.pageDescription(d.ym)}
          {lastFetched ? ` ${m.lastFetched(lastFetched.fetched_at.toLocaleString('ja-JP'))}` : ` ${m.neverFetched}`}
        </p>
      </header>

      <section className="mt-space-relaxed grid grid-cols-2 gap-space-snug md:grid-cols-3 lg:grid-cols-5" data-testid="sales-kpis">
        <KpiCard label={m.kpi.revenue} value={yen(d.thisMonth.revenue)} delta={delta(d.thisMonth.revenue, d.lastMonth.revenue)} sub={m.kpi.lastMonth(yen(d.lastMonth.revenue))} />
        <KpiCard label={m.kpi.views} value={num(d.thisMonth.views)} delta={delta(d.thisMonth.views, d.lastMonth.views)} sub={m.kpi.lastMonth(num(d.lastMonth.views))} />
        <KpiCard label={m.kpi.likes} value={num(d.thisMonth.likes)} delta={delta(d.thisMonth.likes, d.lastMonth.likes)} sub={m.kpi.lastMonth(num(d.lastMonth.likes))} />
        <KpiCard label={m.kpi.buyers} value={num(d.thisMonth.buyers)} delta={delta(d.thisMonth.buyers, d.lastMonth.buyers)} sub={m.kpi.lastMonth(num(d.lastMonth.buyers))} />
        <KpiCard label={m.kpi.mrr} value={yen(d.thisMonth.mrr)} delta={delta(d.thisMonth.mrr, d.lastMonth.mrr)} sub={m.kpi.subscribers(d.thisMonth.subscribers)} />
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.trendTitle}</h2>
        <TrendTable
          className="mt-space-snug"
          columns={[m.trend.ym, m.trend.revenue, m.trend.views, m.trend.likes, m.trend.buyers, m.trend.mrr, m.trend.published]}
          rows={d.trend.map((t) => [t.ym, yen(t.revenue), num(t.views), num(t.likes), num(t.buyers), yen(t.mrr), num(t.published)])}
          bars={d.trend.map((t) => t.revenue)}
        />
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.accountsTitle}</h2>
        {d.accounts.length === 0 ? (
          <p className="mt-2 text-body text-muted">{m.accountsEmpty}</p>
        ) : (
          <div className="mt-space-snug overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[900px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{m.account.name}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.revenue}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.views}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.likes}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.buyers}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.mrr}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.followers}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.published}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.account.topArticle}</th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border-warm last:border-b-0 hover:bg-charcoal-04">
                    <td className="px-3 py-2">
                      <Link href={`/accounts/${a.id}`} className="text-charcoal no-underline hover:underline">
                        {a.displayName}
                      </Link>
                      <span className="ml-2 text-caption text-muted">{a.niche}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(a.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.views)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.likes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.buyers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {yen(a.mrr)}
                      <span className="ml-1 text-caption text-muted">({a.subscribers})</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(a.followersTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.publishedThisMonth}
                      <span className="ml-1 text-caption text-muted">/ {a.publishedTotal}</span>
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-caption">
                      {a.topArticle ? (
                        <Link href={`/articles/${a.topArticle.id}`} className="text-charcoal no-underline hover:underline">
                          {a.topArticle.title}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.topArticlesTitle}</h2>
        {d.topArticles.length === 0 ? (
          <p className="mt-2 text-body text-muted">{m.topArticlesEmpty}</p>
        ) : (
          <BarList
            className="mt-space-snug"
            items={d.topArticles.map((a) => ({
              key: a.id,
              label: a.title,
              href: `/articles/${a.id}`,
              sub: `${a.accountName} ・ ${a.paid ? m.paid(a.price_jpy) : m.free} ・ ${m.articleStats(a.views, a.likes, a.buyers)}`,
              value: a.revenue,
              display: yen(a.revenue),
            }))}
          />
        )}
      </section>
    </div>
  );
}
