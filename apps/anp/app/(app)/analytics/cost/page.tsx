/**
 * S-ANP-12 — コストダッシュボード (docs/11-anp-design.md §3.5 F-ANP-42)。
 * `token_usage` の `anp.*` 役割分を当月/前月で集計 (日次・役割別・モデル別・プロバイダ別) し、
 * 記事別・アカウント別は `note_articles.cost_jpy_total` (当月作成分)。月末着地の単純予測付き。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { computeCostDashboard, costQueryRange, percentChange, type CostUsageRow } from '@/lib/analytics-core';
import { messages } from '@/lib/messages';
import { anpRoleLabel } from '@/lib/model-settings-core';

import { BarList, DailyBars, KpiCard } from '../dashboard-parts';

export const dynamic = 'force-dynamic';

const m = messages.analytics.cost;
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const num = (n: number) => n.toLocaleString('ja-JP');

export default async function CostDashboardPage() {
  const now = new Date();
  const { start, end } = costQueryRange(now);
  const [usageRaw, articles, accounts] = await Promise.all([
    prisma.$queryRaw<Array<{ date: string; provider: string; model: string; role: string; cost_jpy: unknown; call_count: bigint; input_tokens: bigint; output_tokens: bigint }>>`
      SELECT
        TO_CHAR(created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS date,
        provider,
        model,
        role,
        SUM(cost_jpy) AS cost_jpy,
        COUNT(*) AS call_count,
        SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens
      FROM token_usage
      WHERE role LIKE 'anp.%' AND created_at >= ${start} AND created_at < ${end}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1
    `,
    prisma.noteArticle.findMany({
      where: { created_at: { gte: start, lt: end } },
      select: { id: true, title: true, note_account_id: true, status: true, publish_status: true, cost_jpy_total: true, created_at: true },
    }),
    prisma.noteAccount.findMany({ where: { status: { not: 'archived' } }, select: { id: true, display_name: true } }),
  ]);
  const usage: CostUsageRow[] = usageRaw.map((u) => ({
    date: u.date,
    provider: u.provider,
    model: u.model,
    role: u.role,
    cost_jpy: u.cost_jpy,
    call_count: Number(u.call_count),
    input_tokens: Number(u.input_tokens),
    output_tokens: Number(u.output_tokens),
  }));
  const d = computeCostDashboard({ usage, articles, accounts, now });
  const roleLabel = (role: string) => (anpRoleLabel(role) === role ? role : `${anpRoleLabel(role)} (${role})`);

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription(d.ym)}</p>
      </header>

      <section className="mt-space-relaxed grid grid-cols-2 gap-space-snug md:grid-cols-3 lg:grid-cols-5" data-testid="cost-kpis">
        <KpiCard label={m.kpi.total} value={yen(d.totalThisMonth)} delta={percentChange(d.totalThisMonth, d.totalLastMonth)} sub={m.kpi.lastMonth(yen(d.totalLastMonth))} />
        <KpiCard label={m.kpi.forecast} value={d.forecastMonthEnd != null ? yen(d.forecastMonthEnd) : '—'} sub={m.kpi.forecastSub} />
        <KpiCard label={m.kpi.calls} value={num(d.callsThisMonth)} sub={m.kpi.tokens(num(d.tokensThisMonth.input), num(d.tokensThisMonth.output))} />
        <KpiCard label={m.kpi.perArticle} value={d.avgCostPerArticle != null ? yen(d.avgCostPerArticle) : '—'} sub={m.kpi.perArticleSub} />
        <KpiCard label={m.kpi.perPublished} value={d.avgCostPerPublished != null ? yen(d.avgCostPerPublished) : '—'} sub={m.kpi.perPublishedSub} />
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.dailyTitle}</h2>
        <DailyBars className="mt-space-snug" points={d.daily} format={yen} />
      </section>

      <section className="mt-space-loose grid grid-cols-1 gap-space-relaxed lg:grid-cols-2">
        <div>
          <h2 className="text-section-title text-charcoal">{m.byRoleTitle}</h2>
          {d.byRole.length === 0 ? (
            <p className="mt-2 text-body text-muted">{m.empty}</p>
          ) : (
            <BarList className="mt-space-snug" items={d.byRole.map((r) => ({ key: r.key, label: roleLabel(r.key), sub: m.share(r.share, r.calls), value: r.cost, display: yen(r.cost) }))} />
          )}
        </div>
        <div>
          <h2 className="text-section-title text-charcoal">{m.byModelTitle}</h2>
          {d.byModel.length === 0 ? (
            <p className="mt-2 text-body text-muted">{m.empty}</p>
          ) : (
            <BarList className="mt-space-snug" items={d.byModel.map((r) => ({ key: r.key, label: r.label, sub: m.share(r.share, r.calls), value: r.cost, display: yen(r.cost) }))} />
          )}
        </div>
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.accountsTitle}</h2>
        {d.accounts.length === 0 ? (
          <p className="mt-2 text-body text-muted">{m.empty}</p>
        ) : (
          <div className="mt-space-snug overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[640px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{m.account.name}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.cost}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.articles}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.published}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.account.perArticle}</th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border-warm last:border-b-0 hover:bg-charcoal-04">
                    <td className="px-3 py-2">
                      <Link href={`/accounts/${a.id}`} className="text-charcoal no-underline hover:underline">
                        {a.displayName}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{yen(a.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.articles}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.published}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.costPerArticle != null ? yen(a.costPerArticle) : '—'}</td>
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
          <p className="mt-2 text-body text-muted">{m.empty}</p>
        ) : (
          <BarList
            className="mt-space-snug"
            items={d.topArticles.map((a) => ({
              key: a.id,
              label: a.title,
              href: `/articles/${a.id}`,
              sub: `${a.accountName} ・ ${messages.accountDetail.articleStatus[a.status as keyof typeof messages.accountDetail.articleStatus] ?? a.status} ・ ${new Date(a.created_at).toLocaleDateString('ja-JP')}`,
              value: a.cost,
              display: yen(a.cost),
            }))}
          />
        )}
      </section>
      <p className="mt-space-relaxed text-caption text-muted">{m.footnote}</p>
    </div>
  );
}
