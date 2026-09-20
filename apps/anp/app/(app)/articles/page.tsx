/**
 * S-ANP-07 — 全記事一覧 (docs/11-anp-design.md §3.2/§7)。
 * すべての note アカウントを横断して記事を新しい順に一覧し、アカウント/ステータス/
 * 有料提案の有無でフィルタする。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const accountFilter = typeof sp.account === 'string' && sp.account.length > 0 ? sp.account : '';
  const statusFilter = typeof sp.status === 'string' && sp.status.length > 0 ? sp.status : '';
  const priceSuggestionOnly = sp.price_suggestion === '1';

  const accounts = await prisma.noteAccount.findMany({
    orderBy: { display_name: 'asc' },
    select: { id: true, display_name: true },
  });

  const where: Record<string, unknown> = {};
  if (accountFilter) where.note_account_id = accountFilter;
  if (statusFilter) where.status = statusFilter;
  if (priceSuggestionOnly) {
    where.paid = false;
    where.price_jpy = { not: null };
  }

  const articles = await prisma.noteArticle.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      publish_status: true,
      quality_score: true,
      paid: true,
      price_jpy: true,
      created_at: true,
      account: { select: { id: true, display_name: true } },
    },
  });

  const fm = messages.articles.filters;

  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{messages.articles.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{messages.articles.pageDescription}</p>
      </header>

      <form method="get" className="mt-space-relaxed flex flex-wrap items-end gap-space-snug">
        <label className="flex flex-col gap-1 text-caption text-muted">
          {fm.account}
          <select
            name="account"
            defaultValue={accountFilter}
            className="rounded-card border border-border-warm bg-white px-2 py-1.5 text-body text-charcoal"
          >
            <option value="">{fm.accountAll}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {fm.status}
          <select
            name="status"
            defaultValue={statusFilter}
            className="rounded-card border border-border-warm bg-white px-2 py-1.5 text-body text-charcoal"
          >
            <option value="">{fm.statusAll}</option>
            {Object.keys(messages.accountDetail.articleStatus).map((s) => (
              <option key={s} value={s}>
                {messages.accountDetail.articleStatus[s as keyof typeof messages.accountDetail.articleStatus]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption text-muted">
          {fm.priceSuggestion}
          <select
            name="price_suggestion"
            defaultValue={priceSuggestionOnly ? '1' : ''}
            className="rounded-card border border-border-warm bg-white px-2 py-1.5 text-body text-charcoal"
          >
            <option value="">{fm.priceSuggestionAll}</option>
            <option value="1">{fm.priceSuggestionOnly}</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white"
        >
          {fm.apply}
        </button>
      </form>

      <section className="mt-space-loose">
        {articles.length === 0 ? (
          <p className="text-body text-muted">{messages.articles.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[720px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{messages.articles.columnTitle}</th>
                  <th className="px-3 py-2 text-left font-medium">{messages.articles.columnAccount}</th>
                  <th className="px-3 py-2 text-left font-medium">{messages.articles.columnStatus}</th>
                  <th className="px-3 py-2 text-left font-medium">{messages.articles.columnPublishStatus}</th>
                  <th className="px-3 py-2 text-right font-medium">{messages.articles.columnScore}</th>
                  <th className="px-3 py-2 text-left font-medium">{messages.articles.columnCreatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => {
                  const statusLabel =
                    messages.accountDetail.articleStatus[
                      a.status as keyof typeof messages.accountDetail.articleStatus
                    ] ?? a.status;
                  const publishStatusLabel =
                    messages.accountDetail.publishStatus[
                      a.publish_status as keyof typeof messages.accountDetail.publishStatus
                    ] ?? a.publish_status;
                  return (
                    <tr key={a.id} className="border-b border-border-warm last:border-b-0 hover:bg-charcoal-04">
                      <td className="px-3 py-2">
                        <Link href={`/articles/${a.id}`} className="text-charcoal no-underline hover:underline">
                          {a.title}
                        </Link>
                        {!a.paid && a.price_jpy != null && (
                          <span className="ml-2 text-caption text-muted">
                            {messages.accountDetail.priceSuggestionLabel(a.price_jpy)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/accounts/${a.account.id}`} className="text-caption text-muted no-underline hover:underline">
                          {a.account.display_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-caption text-muted">{statusLabel}</td>
                      <td className="px-3 py-2 text-caption text-muted">{publishStatusLabel}</td>
                      <td className="px-3 py-2 text-right">{a.quality_score ?? '—'}</td>
                      <td className="px-3 py-2 text-caption text-muted">{a.created_at.toLocaleString('ja-JP')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export const dynamic = 'force-dynamic';
