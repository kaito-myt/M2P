/**
 * S-3DP-01 ホーム (docs/12-3dp-design.md §9)。
 *
 * 3DP のホームは「量を増やすための計器盤」ではなく「続けるか止めるかの現在値」。
 * ヒーローは当月純利益と 1 商品あたりの売上 (売上が無い間は「—」+ 理由。0 円と未取得を混ぜない)。
 * 出品枠は小さく「当月の出品 N 件 / 上限 M」。バーも「残り N」も出さない (UR-1)。
 * 集計ロジックは `lib/home-core.ts` に純関数化してユニットテストする。
 */
import Link from 'next/link';

import { jstMonthRange } from '@a2p/contracts/cost-attribution';
import { prisma } from '@a2p/db';

import {
  PRODUCT_STATUSES,
  buildHero,
  buildLaunchChecklist,
  buildQuotaSummary,
  buildStatusRows,
  determineStage,
  totalCount,
  visibleChecklist,
} from '@/lib/home-core';
import { messages } from '@/lib/messages';
import { loadTdpSettings, type TdpSettingsReader } from '@/lib/tdp-settings';

const m = messages.home;

/** 読めなかったものは null (0 件とは別物)。 */
async function loadHomeData() {
  const { monthStart, nextMonthStart } = jstMonthRange(new Date());

  const [loaded, groups, listedThisMonth] = await Promise.all([
    loadTdpSettings(prisma as unknown as TdpSettingsReader),
    prisma.tdpProduct.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => null),
    prisma.tdpProduct
      .count({ where: { listed_at: { gte: monthStart, lt: nextMonthStart } } })
      .catch(() => null),
  ]);
  // 生のエラー文 (接続先・SQL を含みうる) は画面に出さず、ログに残す (§17.11)。
  if (loaded.warnings.length > 0) console.error('[3dp/home]', loaded.warnings);
  if (groups === null || listedThisMonth === null) console.error('[3dp/home] tdp_products の集計に失敗しました');

  const rows = groups ? buildStatusRows(groups.map((g) => ({ status: g.status, count: g._count._all }))) : null;
  return { loaded, rows, listedThisMonth };
}

export default async function TdpHomePage() {
  const { loaded, rows, listedThisMonth } = await loadHomeData();
  const { settings, degraded, reason } = loaded;

  const total = rows ? totalCount(rows) : null;
  const listedProducts = rows?.find((r) => r.status === 'listed')?.count ?? 0;
  // 件数が読めないときは Stage 0 と同じ表示 (チェックを全項目出す) に倒す。
  const stage = total === null ? 'stage0' : determineStage({ total, listed: listedProducts });

  const quota = buildQuotaSummary({
    listedThisMonth,
    monthlyLimit: degraded ? null : settings.tdp_monthly_publish_limit,
  });
  // 売上チャネルが未接続の間は常に未取得。取得が始まる増分でここを実データに差し替える。
  const hero = buildHero({ salesFetched: false, netProfitJpy: null, salesTotalJpy: null, listedProducts });
  const checks = visibleChecklist(
    stage,
    buildLaunchChecklist({ settings, settingsOk: !degraded, productTotal: total }),
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <header>
        <h1 className="text-sub-heading text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      {degraded && (
        <div role="alert" className="mt-space-relaxed border-y border-border-warm py-space-snug" data-testid="tdp-home-warning">
          <p className="text-button-sm font-medium text-destructive">
            {reason === 'no_row' ? m.degraded.noRow : m.degraded.readFailed}
          </p>
          <p className="mt-1 text-caption text-muted">{m.degraded.shownDefault}</p>
        </div>
      )}

      {checks.length > 0 && (
        <section className="mt-space-loose" aria-labelledby="launch-heading" data-testid="tdp-launch-check">
          <h2 id="launch-heading" className="text-section-title text-charcoal">
            {m.launch.title}
          </h2>
          <p className="mt-1 max-w-2xl text-caption text-muted">{m.launch.description}</p>
          <ul className="mt-space-relaxed divide-y divide-border-warm border-y border-border-warm">
            {checks.map((c) => {
              const item = m.launch.items[c.id]!;
              return (
                <li
                  key={c.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-space-snug gap-y-1 px-space-tight py-space-relaxed"
                  data-testid={`tdp-launch-${c.id}`}
                  data-state={c.state}
                >
                  <div className="min-w-0 max-w-xl">
                    <p className="text-button-sm text-charcoal">
                      <span className="mr-space-snug tabular-nums text-charcoal-82">[{m.launch.state[c.state]}]</span>
                      {item.label}
                    </p>
                    <p className="mt-1 text-caption text-muted">{item[c.state]}</p>
                  </div>
                  {c.state !== 'done' && (
                    <Link
                      href={item.href}
                      className="text-button-sm text-charcoal-82 underline-offset-4 hover:text-charcoal hover:underline"
                    >
                      {item.link}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ヒーロー — 成果は純利益と 1 商品あたりの売上。出品数は成果として見せない (UR-1)。 */}
      <section className="mt-space-loose" aria-label={m.hero.netProfitLabel} data-testid="tdp-hero">
        <div className="grid gap-space-relaxed sm:grid-cols-2">
          {(
            [
              ['net-profit', m.hero.netProfitLabel, hero.netProfit],
              ['sales-per-product', m.hero.salesPerProductLabel, hero.salesPerProduct],
            ] as const
          ).map(([id, label, metric]) => (
            <div key={id}>
              <p className="text-caption text-muted">{label}</p>
              <p
                className={`mt-1 text-display-alt tabular-nums ${metric.available ? 'text-charcoal' : 'text-charcoal-40'}`}
                data-testid={`tdp-hero-${id}`}
              >
                {metric.value}
              </p>
              {metric.reason && (
                <p className="mt-1 text-caption text-muted" data-testid={`tdp-hero-${id}-reason`}>
                  {metric.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 出品枠 (R-1) — 小さく。バーも「残り N」も出さない。数は buildQuotaView 経由で設定画面と一致。 */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose" aria-labelledby="quota-heading">
        <h2 id="quota-heading" className="text-section-title text-charcoal">
          {m.quotaTitle}
        </h2>
        <p className="mt-space-snug text-body tabular-nums text-charcoal" data-testid="tdp-quota-line">
          {quota.listed === null
            ? m.quotaListedUnknown
            : quota.limit === null
              ? m.quotaListedOnly(quota.listed)
              : m.quotaLine(quota.listed, quota.limit)}
        </p>
        {quota.limit === null && <p className="mt-1 text-caption text-muted">{m.quotaLimitUnknown}</p>}
        {quota.clamped && quota.configuredLimit !== null && quota.limit !== null && (
          <p className="mt-1 text-caption text-muted" data-testid="tdp-quota-clamped">
            {m.quotaClamped(quota.configuredLimit, quota.limit)}
          </p>
        )}
        {quota.allowed === false && (
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

        {rows === null ? (
          <p className="mt-space-relaxed text-body text-muted" role="alert">
            {m.statusCountUnknown}
          </p>
        ) : (
          <>
            {total === 0 && <p className="mt-space-relaxed text-body text-muted">{m.empty}</p>}
            <ul className="mt-space-relaxed divide-y divide-border-warm border-y border-border-warm" data-testid="tdp-status-list">
              {rows.map((row) => {
                const known = (PRODUCT_STATUSES as readonly string[]).includes(row.status);
                const emphasis = row.status === 'review' || row.status === 'approved';
                const label = messages.productStatus[row.status] ?? row.status;
                return (
                  <li key={row.status} className="hover:bg-charcoal-03" data-testid={`tdp-status-row-${row.status}`}>
                    {known ? (
                      <Link
                        href={`/products?status=${row.status}`}
                        className="flex items-center justify-between gap-space-snug px-space-tight py-space-relaxed no-underline"
                      >
                        <span className={`text-button-sm ${emphasis ? 'font-medium text-charcoal' : 'text-charcoal-82'}`}>
                          {label}
                        </span>
                        <span className={`tabular-nums text-body ${row.count === 0 ? 'text-charcoal-40' : 'text-charcoal'}`}>
                          {row.count}
                        </span>
                      </Link>
                    ) : (
                      <div className="flex items-center justify-between gap-space-snug px-space-tight py-space-relaxed">
                        <span className="text-button-sm text-charcoal-82">{label}</span>
                        <span className="tabular-nums text-body text-charcoal">{row.count}</span>
                      </div>
                    )}
                  </li>
                );
              })}
              <li className="flex items-center justify-between gap-space-snug px-space-tight py-space-relaxed">
                <span className="text-button-sm font-medium text-charcoal">{m.totalProducts}</span>
                <span className="tabular-nums text-body font-medium text-charcoal" data-testid="tdp-total-count">
                  {total}
                </span>
              </li>
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// DB を読むページは常に動的レンダリング (ビルド時に DB へ繋ごうとして失敗するのを防ぐ)。
export const dynamic = 'force-dynamic';
