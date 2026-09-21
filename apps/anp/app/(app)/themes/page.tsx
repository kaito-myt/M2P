/**
 * S-ANP-13 — テーマ一覧 (docs/11-anp-design.md §3.2 F-ANP-10)。
 *
 * 運営者要望 (2026-09-22)「テーマ一覧はアカウント詳細じゃなくて、メニューにテーマ一覧を作って」「記事もアカウント詳細には
 * 乗せなくていいよ」。全アカウントのテーマ候補を **状態タブ (すべて / 未承認 / 承認済み / 却下)** と **アカウント切替ピル**
 * で横断表示し、承認/却下とアカウント単位の「テーマ生成」をここで行う。状態は URL `?status=&account=`。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { AccountPills } from '@/components/account-pills';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';

import { GenerateThemesButton } from './generate-themes-button';
import { ThemeCard } from './theme-card';

export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'accepted', 'rejected'] as const;
type ThemeStatus = (typeof STATUSES)[number];
const isThemeStatus = (v: unknown): v is ThemeStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v);

const m = messages.themes;

export default async function ThemesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const accountFilter = typeof sp.account === 'string' && sp.account.length > 0 ? sp.account : '';
  const statusFilter: ThemeStatus | '' = isThemeStatus(sp.status) ? sp.status : '';

  const [accounts, statusRows, accountRows, themes] = await Promise.all([
    prisma.noteAccount.findMany({ where: { status: { not: 'archived' } }, orderBy: { display_name: 'asc' }, select: { id: true, display_name: true, status: true } }),
    // 状態タブのバッジ (アカウント条件のみ掛ける)
    prisma.noteTheme.groupBy({ by: ['status'], where: accountFilter ? { note_account_id: accountFilter } : {}, _count: { _all: true } }),
    // アカウントピルのバッジ (状態条件のみ掛ける)
    prisma.noteTheme.groupBy({ by: ['note_account_id'], where: statusFilter ? { status: statusFilter } : {}, _count: { _all: true } }),
    prisma.noteTheme.findMany({
      where: { ...(accountFilter ? { note_account_id: accountFilter } : {}), ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { created_at: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        hook: true,
        target_reader: true,
        recommend_paid: true,
        suggested_price: true,
        genre: true,
        status: true,
        rejected_reason: true,
        created_at: true,
        account: { select: { id: true, display_name: true } },
        articles: { select: { id: true, title: true, status: true, publish_status: true }, orderBy: { created_at: 'desc' }, take: 1 },
      },
    }),
  ]);
  const countByStatus = new Map(statusRows.map((r) => [r.status, r._count._all]));
  const totalForTabs = statusRows.reduce((s, r) => s + r._count._all, 0);
  const countByAccount = new Map(accountRows.map((r) => [r.note_account_id, r._count._all]));
  const totalForPills = accountRows.reduce((s, r) => s + r._count._all, 0);
  const selectedAccount = accountFilter ? accounts.find((a) => a.id === accountFilter) ?? null : null;

  const buildHref = (o: { status?: ThemeStatus | ''; account?: string }) => {
    const q = new URLSearchParams();
    const st = o.status ?? statusFilter;
    const acc = o.account ?? accountFilter;
    if (st) q.set('status', st);
    if (acc) q.set('account', acc);
    const qs = q.toString();
    return qs ? `/themes?${qs}` : '/themes';
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <header className="flex flex-wrap items-start justify-between gap-space-snug">
        <div>
          <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
          <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
        </div>
        {selectedAccount ? (
          <GenerateThemesButton noteAccountId={selectedAccount.id} accountName={selectedAccount.display_name} disabled={selectedAccount.status === 'pending_session' || selectedAccount.status === 'paused'} />
        ) : (
          <p className="text-caption text-muted">{m.selectAccountToGenerate}</p>
        )}
      </header>

      {/* 状態タブ */}
      <nav aria-label={m.statusTabsLabel} className="mt-space-relaxed flex flex-wrap gap-2" data-testid="themes-status-tabs">
        {([['', totalForTabs], ...STATUSES.map((s) => [s, countByStatus.get(s) ?? 0] as const)] as ReadonlyArray<readonly [ThemeStatus | '', number]>).map(([st, n]) => {
          const active = st === statusFilter;
          return (
            <Link
              key={st || 'all'}
              href={buildHref({ status: st })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
                active ? 'border-charcoal bg-charcoal text-white' : 'border-border-warm bg-white text-charcoal-82 hover:bg-charcoal-04',
              )}
            >
              {st ? messages.accountDetail.themeStatus[st] : m.statusAll}
              <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/80' : 'text-muted')}>{n}</span>
            </Link>
          );
        })}
      </nav>

      {/* アカウント切替 */}
      <div className="mt-space-snug flex flex-wrap items-center gap-x-space-snug gap-y-2">
        <span className="text-caption text-muted">{m.accountLabel}</span>
        <AccountPills
          accounts={accounts.map((a) => ({ id: a.id, label: a.display_name, count: countByAccount.get(a.id) ?? 0 }))}
          activeId={accountFilter}
          hrefFor={(id) => buildHref({ account: id })}
          allLabel={m.accountAll}
          allCount={totalForPills}
          ariaLabel={m.accountLabel}
          testId="themes-account-pills"
        />
      </div>

      <section className="mt-space-relaxed">
        {themes.length === 0 ? (
          <p className="text-body text-muted">{selectedAccount ? m.emptyForAccount : m.empty}</p>
        ) : (
          <ul className="flex flex-col gap-space-snug">
            {themes.map((t) => (
              <ThemeCard
                key={t.id}
                theme={{
                  id: t.id,
                  title: t.title,
                  hook: t.hook,
                  target_reader: t.target_reader,
                  recommend_paid: t.recommend_paid,
                  suggested_price: t.suggested_price,
                  genre: t.genre,
                  status: t.status,
                  rejected_reason: t.rejected_reason,
                  created_at: t.created_at.toISOString(),
                  account: t.account,
                  article: t.articles[0] ?? null,
                }}
                showAccount={!accountFilter}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
