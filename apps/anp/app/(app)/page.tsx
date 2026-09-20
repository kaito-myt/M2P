/**
 * ANP ホーム（ミッションコントロール, F-ANP-42 仕上げ / docs/11-anp-design.md §3.5・§8）。
 *
 * 当月の公開記事数/総ビュー/総売上/AIコスト/純利益、アカウント別 KPI(フォロワー/公開数
 * 累計・30日/当月売上・コスト・純利益)、今日のパイプライン(実行中/失敗)、セッション要
 * 再取込アラート、直近公開記事を RSC で直接集計して表示する。集計ロジックは
 * `lib/home-core.ts` に純関数化してユニットテストする。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { computeAccountKpis, jstMonthRange, toNumber } from '@/lib/home-core';

const NOTE_JOB_KIND_PREFIXES = ['pipeline.note.', 'note.', 'promotion.note.'];

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

async function loadHomeData() {
  const now = new Date();
  const { start, end, ym } = jstMonthRange(now);
  const failureSince = new Date(now.getTime() - 24 * 3600_000);

  const [
    accounts,
    articlesThisMonth,
    allArticles,
    salesThisMonth,
    costAgg,
    pendingReauth,
    runningJobs,
    failedJobs,
    recentArticles,
  ] = await Promise.all([
    prisma.noteAccount.findMany({
      select: { id: true, display_name: true, niche: true, status: true, followers_total: true },
      orderBy: { created_at: 'desc' },
    }),
    prisma.noteArticle.findMany({
      where: { publish_status: 'published', published_at: { gte: start, lt: end } },
      select: { id: true, note_account_id: true },
    }),
    prisma.noteArticle.findMany({
      select: { id: true, note_account_id: true, publish_status: true, published_at: true, created_at: true, cost_jpy_total: true },
    }),
    prisma.noteSalesRecord.findMany({
      where: { year_month: ym },
      select: { note_article_id: true, views: true, revenue_jpy: true },
    }),
    prisma.tokenUsage.aggregate({
      where: { role: { startsWith: 'anp.' }, created_at: { gte: start, lt: end } },
      _sum: { cost_jpy: true },
    }),
    prisma.noteAuthRequest.findMany({
      where: { purpose: 'session_expired', status: 'pending' },
      select: { note_account_id: true },
    }),
    prisma.job.findMany({
      where: { status: { in: ['queued', 'running'] }, OR: NOTE_JOB_KIND_PREFIXES.map((p) => ({ kind: { startsWith: p } })) },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, kind: true, status: true, created_at: true },
    }),
    prisma.job.findMany({
      where: {
        status: 'failed',
        created_at: { gte: failureSince },
        OR: NOTE_JOB_KIND_PREFIXES.map((p) => ({ kind: { startsWith: p } })),
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { id: true, kind: true, error: true, created_at: true },
    }),
    prisma.noteArticle.findMany({
      where: { publish_status: 'published' },
      orderBy: { published_at: 'desc' },
      take: 5,
      select: { id: true, title: true, note_url: true, published_at: true, account: { select: { display_name: true } } },
    }),
  ]);

  let totalViews = 0;
  let totalRevenue = 0;
  for (const sale of salesThisMonth) {
    totalViews += sale.views;
    totalRevenue += sale.revenue_jpy;
  }
  const totalCost = toNumber(costAgg._sum.cost_jpy);

  const accountKpis = computeAccountKpis({ accounts, articles: allArticles, salesThisMonth, now });
  const reauthAccountIds = new Set(
    accounts.filter((a) => a.status === 'paused').map((a) => a.id).concat(
      pendingReauth.map((r) => r.note_account_id).filter((id): id is string => !!id),
    ),
  );

  return {
    totalPublished: articlesThisMonth.length,
    totalViews,
    totalRevenue,
    totalCost,
    netProfit: totalRevenue - totalCost,
    accountKpis,
    reauthCount: reauthAccountIds.size,
    runningJobs,
    failedJobs,
    recentArticles,
  };
}

export default async function AnpHomePage() {
  const data = await loadHomeData();
  const hm = messages.home;

  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <div
        className="rounded-container border px-space-relaxed py-space-relaxed"
        style={{ background: '#eef4f1', borderColor: '#1f4d3f33' }}
      >
        <p className="text-caption" style={{ color: '#1f4d3f' }}>
          {hm.heroLabel}
        </p>
        <p className="mt-1 text-sub-heading font-medium" style={{ color: '#1f4d3f' }}>
          {yen(data.netProfit)}
        </p>
        <p className="mt-1 text-caption text-muted">{hm.heroSubtext(data.totalRevenue, data.totalCost)}</p>
      </div>

      {data.reauthCount > 0 && (
        <div className="mt-space-relaxed rounded-container border border-destructive-bg bg-destructive-bg px-space-relaxed py-space-snug">
          <p className="text-body font-medium text-destructive">{hm.reauthAlertTitle}</p>
          <p className="mt-0.5 text-caption text-destructive">{hm.reauthAlertBody(data.reauthCount)}</p>
          <Link href="/accounts" className="mt-1 inline-block text-caption text-destructive underline">
            {hm.reauthAlertLink}
          </Link>
        </div>
      )}

      <section aria-label="当月KPI" className="mt-space-relaxed grid grid-cols-2 gap-space-snug sm:grid-cols-4">
        {[
          { label: hm.statPublishedArticles, value: `${data.totalPublished.toLocaleString('ja-JP')} 本` },
          { label: hm.statViews, value: `${data.totalViews.toLocaleString('ja-JP')}` },
          { label: hm.statRevenue, value: yen(data.totalRevenue) },
          { label: hm.statCost, value: yen(data.totalCost) },
        ].map((s) => (
          <div key={s.label} className="rounded-container border border-border-warm bg-cream-light p-space-snug">
            <p className="text-caption text-muted">{s.label}</p>
            <p className="mt-1 text-card-title font-medium text-charcoal">{s.value}</p>
          </div>
        ))}
      </section>

      <section aria-label={hm.accountsBreakdownTitle} className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{hm.accountsBreakdownTitle}</h2>
        {data.accountKpis.length === 0 ? (
          <p className="mt-2 text-body text-muted">{hm.accountsBreakdownEmpty}</p>
        ) : (
          <div className="mt-space-snug overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[860px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{hm.columnAccount}</th>
                  <th className="px-3 py-2 text-left font-medium">{hm.columnStatus}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnFollowers}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnPublishedTotal}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnPublished30d}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnRevenue}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnCostThisMonth}</th>
                  <th className="px-3 py-2 text-right font-medium">{hm.columnNetProfit}</th>
                </tr>
              </thead>
              <tbody>
                {data.accountKpis.map((a) => (
                  <tr key={a.id} className="border-b border-border-warm last:border-b-0">
                    <td className="px-3 py-2">
                      <Link href={`/accounts/${a.id}`} className="text-charcoal no-underline hover:underline">
                        {a.displayName}
                      </Link>
                      <span className="ml-1 text-caption text-muted">({a.niche})</span>
                    </td>
                    <td className="px-3 py-2 text-caption text-muted">{a.status}</td>
                    <td className="px-3 py-2 text-right">{a.followersTotal.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 text-right">{a.publishedTotal.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 text-right">{a.published30d.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 text-right">{yen(a.revenueThisMonth)}</td>
                    <td className="px-3 py-2 text-right">{yen(a.costThisMonth)}</td>
                    <td className="px-3 py-2 text-right">{yen(a.netProfitThisMonth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label={hm.pipelineTitle} className="mt-space-loose grid grid-cols-1 gap-space-relaxed sm:grid-cols-2">
        <div>
          <h2 className="text-section-title text-charcoal">{hm.pipelineRunning}</h2>
          {data.runningJobs.length === 0 ? (
            <p className="mt-2 text-body text-muted">{hm.pipelineRunningEmpty}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {data.runningJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-caption text-charcoal">
                  <span>{j.kind}</span>
                  <span className="text-muted">{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-section-title text-charcoal">{hm.pipelineFailed}</h2>
          {data.failedJobs.length === 0 ? (
            <p className="mt-2 text-body text-muted">{hm.pipelineFailedEmpty}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {data.failedJobs.map((j) => (
                <li key={j.id} className="rounded-card border border-destructive-bg bg-destructive-bg px-3 py-1.5 text-caption text-destructive">
                  <p className="font-medium">{j.kind}</p>
                  {j.error && <p className="mt-0.5 truncate">{j.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-label={hm.recentArticlesTitle} className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{hm.recentArticlesTitle}</h2>
        {data.recentArticles.length === 0 ? (
          <p className="mt-2 text-body text-muted">{hm.recentArticlesEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {data.recentArticles.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-card border border-border-warm bg-cream-light px-3 py-2 text-body">
                <Link href={`/articles/${a.id}`} className="text-charcoal no-underline hover:underline">
                  {a.title}
                </Link>
                <span className="text-caption text-muted">
                  {a.account.display_name} ・ {a.published_at ? a.published_at.toLocaleDateString('ja-JP') : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
