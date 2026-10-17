/**
 * S-3DP-01 ホーム (docs/12-3dp-design.md §9)。
 *
 * Inc-1 の時点では売上チャネル (BOOTH) が未接続なので、出せるのは
 *   ① 当月の出品枠 (R-1 の残枠 — `canListMore()` の判定をそのまま表示)
 *   ② `tdp_products` の状態別件数
 * の 2 つ。売上と「要承認の商品」は Inc-4 / Inc-5 で足す。
 * 集計ロジックは `lib/home-core.ts` に純関数化してユニットテストする。
 */
import Link from 'next/link';

import { TDP_MONTHLY_LIMIT_DEFAULT } from '@a2p/contracts/tdp/settings';
import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { buildQuotaView, buildStatusRows, jstMonthRange, totalCount } from '@/lib/home-core';

const m = messages.home;

async function loadHomeData() {
  const now = new Date();
  const { start, end } = jstMonthRange(now);

  const [settings, groups, listedThisMonth] = await Promise.all([
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { tdp_monthly_publish_limit: true },
    }),
    prisma.tdpProduct.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.tdpProduct.count({ where: { listed_at: { gte: start, lt: end } } }),
  ]);

  const rows = buildStatusRows(groups.map((g) => ({ status: g.status, count: g._count._all })));
  return {
    quota: buildQuotaView({
      listedThisMonth,
      monthlyLimit: settings?.tdp_monthly_publish_limit ?? TDP_MONTHLY_LIMIT_DEFAULT,
    }),
    rows,
    total: totalCount(rows),
  };
}

export default async function TdpHomePage() {
  const { quota, rows, total } = await loadHomeData();

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header>
        <h1 className="text-sub-heading text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      {/* 当月の出品枠 (R-1) — このツールで一番見るべき単一指標なのでヒーローに置く。 */}
      <section className="mt-space-loose" aria-labelledby="quota-heading">
        <h2 id="quota-heading" className="text-section-title text-charcoal">
          {m.quotaTitle}
        </h2>
        <div className="mt-space-snug flex flex-wrap items-baseline gap-x-space-snug gap-y-1">
          <span className="text-display-alt tabular-nums text-charcoal" data-testid="tdp-quota-remaining">
            {quota.remaining}
          </span>
          <span className="text-body text-muted">
            {m.quotaUnit} / {m.quotaOf} {quota.limit} {m.quotaUnit}
          </span>
        </div>
        <p className="mt-1 text-caption text-muted">
          {m.quotaListed} {quota.listed} {m.quotaUnit}
        </p>
        {!quota.allowed && (
          <p className="mt-space-snug max-w-2xl rounded-card bg-accent-bg px-space-snug py-space-tight text-caption text-accent">
            {quota.reason ?? m.quotaExhausted}
          </p>
        )}
        <p className="mt-space-snug max-w-2xl text-caption text-muted">{m.quotaNote}</p>
      </section>

      {/* 状態別件数 — ヘアラインの高密度リスト (角丸カードの反復はしない)。 */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose" aria-labelledby="status-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-space-snug">
          <h2 id="status-heading" className="text-section-title text-charcoal">
            {m.statusTitle}
          </h2>
          <Link href="/products" className="text-button-sm text-charcoal-82 underline-offset-4 hover:text-charcoal hover:underline">
            {m.toProducts}
          </Link>
        </div>

        {total === 0 ? (
          <p className="mt-space-relaxed text-body text-muted">{m.empty}</p>
        ) : (
          <ul className="mt-space-relaxed divide-y divide-border-warm border-y border-border-warm" data-testid="tdp-status-list">
            {rows.map((row) => (
              <li
                key={row.status}
                className="flex items-center justify-between gap-space-snug px-space-tight py-space-relaxed hover:bg-charcoal-03"
              >
                <span className="text-button-sm text-charcoal-82">
                  {messages.productStatus[row.status] ?? row.status}
                </span>
                <span className="tabular-nums text-body text-charcoal">{row.count}</span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-space-snug px-space-tight py-space-relaxed">
              <span className="text-button-sm font-medium text-charcoal">{m.totalProducts}</span>
              <span className="tabular-nums text-body font-medium text-charcoal" data-testid="tdp-total-count">
                {total}
              </span>
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}

// DB を読むページは常に動的レンダリング (ビルド時に DB へ繋ごうとして失敗するのを防ぐ)。
export const dynamic = 'force-dynamic';
