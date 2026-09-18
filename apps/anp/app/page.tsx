/**
 * ANP ホーム（ミッションコントロール, F-ANP-42 最小版 / docs/11-anp-design.md §3.5・§8）。
 *
 * A2P の S-002 (`apps/web`) を土台に、当月の公開記事数/総ビュー/総売上/AIコスト/純利益と
 * アカウント別内訳を RSC で表示する。認証必須。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';

import { logout } from './actions';

/** M2P ポータルへ戻る URL。未設定時はローカル dev の 3002。本番は AUTH_COOKIE_DOMAIN 配下。 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : '');

interface PlannedSection {
  title: string;
  body: string;
  phase: string;
}

const ROADMAP: PlannedSection[] = [
  {
    title: '有料記事の価格/公開設定',
    body: '本人情報登録(KYC)完了後、価格・有料ライン位置の入力欄を実装して有料記事の実公開に対応する。',
    phase: 'Phase 2 継続',
  },
  {
    title: 'org 自律運用連携',
    body: 'A2P の org (CEO+本部長+担当者) に note 出版本部/note 販促本部を追加し、自律ループで運用する。',
    phase: 'Phase 3 継続',
  },
  {
    title: 'A2P⇄note 相互送客の拡充',
    body: '書籍LPへの note 導線など、双方向のクロスツール送客を強化する。',
    phase: 'Phase 4',
  },
];

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return Math.round((v as { toNumber: () => number }).toNumber());
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

/** JST 基準の当月レンジ (UTC Date に変換済み)。 */
function jstMonthRange(now: Date): { start: Date; end: Date; ym: string } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 9 * 3600_000);
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0) - 9 * 3600_000);
  const ym = `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start, end, ym };
}

interface AccountKpi {
  id: string;
  displayName: string;
  niche: string;
  status: string;
  followersTotal: number;
  publishedThisMonth: number;
  viewsThisMonth: number;
  revenueThisMonth: number;
}

async function loadHomeData(): Promise<{
  totalPublished: number;
  totalViews: number;
  totalRevenue: number;
  totalCost: number;
  netProfit: number;
  accounts: AccountKpi[];
}> {
  const { start, end, ym } = jstMonthRange(new Date());

  const [accounts, articlesThisMonth, allArticles, salesThisMonth, costAgg] = await Promise.all([
    prisma.noteAccount.findMany({
      select: { id: true, display_name: true, niche: true, status: true, followers_total: true },
      orderBy: { created_at: 'desc' },
    }),
    prisma.noteArticle.findMany({
      where: { publish_status: 'published', published_at: { gte: start, lt: end } },
      select: { id: true, note_account_id: true },
    }),
    prisma.noteArticle.findMany({ select: { id: true, note_account_id: true } }),
    prisma.noteSalesRecord.findMany({
      where: { year_month: ym },
      select: { note_article_id: true, views: true, revenue_jpy: true },
    }),
    prisma.tokenUsage.aggregate({
      where: { role: { startsWith: 'anp.' }, created_at: { gte: start, lt: end } },
      _sum: { cost_jpy: true },
    }),
  ]);

  const articleToAccount = new Map(allArticles.map((a) => [a.id, a.note_account_id]));

  const perAccount = new Map<string, { published: number; views: number; revenue: number }>();
  for (const a of accounts) perAccount.set(a.id, { published: 0, views: 0, revenue: 0 });

  for (const article of articlesThisMonth) {
    const bucket = perAccount.get(article.note_account_id);
    if (bucket) bucket.published += 1;
  }
  let totalViews = 0;
  let totalRevenue = 0;
  for (const sale of salesThisMonth) {
    const accountId = articleToAccount.get(sale.note_article_id);
    totalViews += sale.views;
    totalRevenue += sale.revenue_jpy;
    if (accountId) {
      const bucket = perAccount.get(accountId);
      if (bucket) {
        bucket.views += sale.views;
        bucket.revenue += sale.revenue_jpy;
      }
    }
  }

  const totalCost = toNumber(costAgg._sum.cost_jpy);

  return {
    totalPublished: articlesThisMonth.length,
    totalViews,
    totalRevenue,
    totalCost,
    netProfit: totalRevenue - totalCost,
    accounts: accounts.map((a) => {
      const bucket = perAccount.get(a.id)!;
      return {
        id: a.id,
        displayName: a.display_name,
        niche: a.niche,
        status: a.status,
        followersTotal: a.followers_total,
        publishedThisMonth: bucket.published,
        viewsThisMonth: bucket.views,
        revenueThisMonth: bucket.revenue,
      };
    }),
  };
}

export default async function AnpHomePage() {
  const session = await auth();
  const username = session?.user?.username ?? session?.user?.name ?? '';
  const data = await loadHomeData();

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <header className="flex flex-wrap items-center justify-between gap-space-snug">
        <div className="flex min-w-0 items-center gap-space-snug">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-card border border-border-warm bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/anp-logo.png" alt="ANP" className="h-full w-full object-contain p-1" />
          </span>
          <div className="min-w-0">
            <h1 className="text-sub-heading font-medium text-charcoal">ANP</h1>
            <p className="mt-0.5 text-body text-muted">
              Automated Note Publishing{username ? ` ・ ${username} さん` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-space-snug">
          <Link
            href="/accounts"
            className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white no-underline hover:opacity-90"
          >
            note アカウント管理
          </Link>
          {PORTAL_URL && (
            <a
              href={PORTAL_URL}
              className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal no-underline hover:bg-charcoal-04"
            >
              ← M2P ポータル
            </a>
          )}
          <form action={logout}>
            <button
              type="submit"
              className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <div
        className="mt-space-loose rounded-container border px-space-relaxed py-space-relaxed"
        style={{ background: '#eef4f1', borderColor: '#1f4d3f33' }}
      >
        <p className="text-caption" style={{ color: '#1f4d3f' }}>
          {messages.home.heroLabel}
        </p>
        <p className="mt-1 text-sub-heading font-medium" style={{ color: '#1f4d3f' }}>
          {yen(data.netProfit)}
        </p>
        <p className="mt-1 text-caption text-muted">{messages.home.heroSubtext(data.totalRevenue, data.totalCost)}</p>
      </div>

      <section aria-label="当月KPI" className="mt-space-relaxed grid grid-cols-2 gap-space-snug sm:grid-cols-4">
        {[
          { label: messages.home.statPublishedArticles, value: `${data.totalPublished.toLocaleString('ja-JP')} 本` },
          { label: messages.home.statViews, value: `${data.totalViews.toLocaleString('ja-JP')}` },
          { label: messages.home.statRevenue, value: yen(data.totalRevenue) },
          { label: messages.home.statCost, value: yen(data.totalCost) },
        ].map((s) => (
          <div key={s.label} className="rounded-container border border-border-warm bg-cream-light p-space-snug">
            <p className="text-caption text-muted">{s.label}</p>
            <p className="mt-1 text-card-title font-medium text-charcoal">{s.value}</p>
          </div>
        ))}
      </section>

      <section aria-label={messages.home.accountsBreakdownTitle} className="mt-space-loose">
        <h2 className="text-card-title font-medium text-charcoal">{messages.home.accountsBreakdownTitle}</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-2 text-body text-muted">{messages.home.accountsBreakdownEmpty}</p>
        ) : (
          <div className="mt-space-snug overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[640px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{messages.home.columnAccount}</th>
                  <th className="px-3 py-2 text-left font-medium">{messages.home.columnStatus}</th>
                  <th className="px-3 py-2 text-right font-medium">{messages.home.columnPublished}</th>
                  <th className="px-3 py-2 text-right font-medium">{messages.home.columnViews}</th>
                  <th className="px-3 py-2 text-right font-medium">{messages.home.columnRevenue}</th>
                  <th className="px-3 py-2 text-right font-medium">{messages.home.columnFollowers}</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id} className="border-b border-border-warm last:border-b-0">
                    <td className="px-3 py-2">
                      <Link href={`/accounts/${a.id}`} className="text-charcoal no-underline hover:underline">
                        {a.displayName}
                      </Link>
                      <span className="ml-1 text-caption text-muted">({a.niche})</span>
                    </td>
                    <td className="px-3 py-2 text-caption text-muted">{a.status}</td>
                    <td className="px-3 py-2 text-right">{a.publishedThisMonth.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 text-right">{a.viewsThisMonth.toLocaleString('ja-JP')}</td>
                    <td className="px-3 py-2 text-right">{yen(a.revenueThisMonth)}</td>
                    <td className="px-3 py-2 text-right">{a.followersTotal.toLocaleString('ja-JP')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label={messages.home.roadmapTitle} className="mt-space-loose grid grid-cols-1 gap-space-relaxed sm:grid-cols-2">
        <h2 className="col-span-full text-card-title font-medium text-charcoal">{messages.home.roadmapTitle}</h2>
        {ROADMAP.map((s) => (
          <div key={s.title} className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-body font-medium text-charcoal">{s.title}</h3>
              <span className="shrink-0 rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                {s.phase}
              </span>
            </div>
            <p className="mt-2 text-body text-muted">{s.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto pt-space-loose text-caption text-muted">
        <p>M2P (Money-Making Platform) · ANP — Automated Note Publishing Tool · 設計: docs/11-anp-design.md</p>
      </footer>
    </div>
  );
}

// Railway のビルド時に静的プリレンダリングで DB (postgres.railway.internal) へ接続しようとして失敗する
// (2026-09-15 以降の ANP デプロイが全て FAILED だった原因)。DB を読むページは常に動的レンダリングにする。
export const dynamic = 'force-dynamic';
