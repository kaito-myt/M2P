/**
 * S-ANP-07 — 記事一覧 (docs/11-anp-design.md §3.2/§7)。
 * すべての note アカウントを横断し、運営者要望 (2026-09-21)「作成中、公開前、公開中の記事が全部
 * 一覧化」に合わせて **段階タブ (すべて / 作成中 / 公開前 / 公開中 / 失敗・非公開)** で切り替える。
 * 段階の定義は `lib/article-stage.ts`。アカウント・有料提案の絞り込みも併用できる。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import {
  ARTICLE_STAGES,
  articleStageWhere,
  countArticleStages,
  isArticleStage,
  resolveArticleStage,
  type ArticleStage,
} from '@/lib/article-stage';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const accountFilter = typeof sp.account === 'string' && sp.account.length > 0 ? sp.account : '';
  const stageFilter: ArticleStage | '' = isArticleStage(sp.stage) ? sp.stage : '';
  // 旧リンク互換: ?status=<note_articles.status> を直接指定した場合も尊重する。
  const statusFilter = typeof sp.status === 'string' && sp.status.length > 0 ? sp.status : '';
  const priceSuggestionOnly = sp.price_suggestion === '1';

  const baseWhere: Record<string, unknown> = {};
  if (accountFilter) baseWhere.note_account_id = accountFilter;
  if (priceSuggestionOnly) {
    baseWhere.paid = false;
    baseWhere.price_jpy = { not: null };
  }

  const where: Record<string, unknown> = { ...baseWhere };
  if (stageFilter) Object.assign(where, articleStageWhere(stageFilter));
  if (statusFilter) where.status = statusFilter;

  const [accounts, stageRows, articles] = await Promise.all([
    prisma.noteAccount.findMany({
      orderBy: { display_name: 'asc' },
      select: { id: true, display_name: true },
    }),
    // タブのバッジ用に (段階以外の条件で) 全件の status/publish_status だけ取る。
    prisma.noteArticle.findMany({ where: baseWhere, select: { status: true, publish_status: true } }),
    prisma.noteArticle.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: 300,
      select: {
        id: true,
        title: true,
        status: true,
        publish_status: true,
        quality_score: true,
        paid: true,
        price_jpy: true,
        note_url: true,
        published_at: true,
        created_at: true,
        updated_at: true,
        account: { select: { id: true, display_name: true } },
      },
    }),
  ]);
  const counts = countArticleStages(stageRows);
  const total = stageRows.length;

  const m = messages.articles;
  const fm = m.filters;

  const tabHref = (stage: ArticleStage | '') => {
    const q = new URLSearchParams();
    if (stage) q.set('stage', stage);
    if (accountFilter) q.set('account', accountFilter);
    if (priceSuggestionOnly) q.set('price_suggestion', '1');
    const qs = q.toString();
    return qs ? `/articles?${qs}` : '/articles';
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      {/* 段階タブ */}
      <nav aria-label={m.stageTabsLabel} className="mt-space-relaxed flex flex-wrap gap-2" data-testid="articles-stage-tabs">
        {([['', total], ...ARTICLE_STAGES.map((s) => [s, counts[s]] as const)] as ReadonlyArray<readonly [ArticleStage | '', number]>).map(
          ([stage, n]) => {
            const active = stage === stageFilter && !statusFilter;
            return (
              <Link
                key={stage || 'all'}
                href={tabHref(stage)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
                  active
                    ? 'border-charcoal bg-charcoal text-white'
                    : 'border-border-warm bg-white text-charcoal-82 hover:bg-charcoal-04',
                )}
              >
                {stage ? m.stageLabel[stage] : m.stageAll}
                <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/80' : 'text-muted')}>{n}</span>
              </Link>
            );
          },
        )}
      </nav>

      <form method="get" className="mt-space-snug flex flex-wrap items-end gap-space-snug">
        {stageFilter && <input type="hidden" name="stage" value={stageFilter} />}
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
          className="rounded-card border border-border-warm bg-cream-light px-4 py-2 text-button-sm text-charcoal"
        >
          {fm.apply}
        </button>
        {statusFilter && (
          <span className="text-caption text-muted">
            {fm.status}: {messages.accountDetail.articleStatus[statusFilter as keyof typeof messages.accountDetail.articleStatus] ?? statusFilter}
            {' '}
            <Link href={tabHref(stageFilter)} className="text-charcoal underline">
              {fm.clearStatus}
            </Link>
          </span>
        )}
      </form>

      <section className="mt-space-relaxed">
        {articles.length === 0 ? (
          <p className="text-body text-muted">{m.empty}</p>
        ) : (
          <div className="overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[860px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{m.columnTitle}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.columnAccount}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.columnStage}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.columnStatus}</th>
                  <th className="px-3 py-2 text-right font-medium">{m.columnScore}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.columnNote}</th>
                  <th className="px-3 py-2 text-left font-medium">{m.columnUpdatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => {
                  const stage = resolveArticleStage(a);
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
                      <td className="max-w-[360px] px-3 py-2">
                        <Link href={`/articles/${a.id}`} className="block truncate text-charcoal no-underline hover:underline">
                          {a.title}
                        </Link>
                        {!a.paid && a.price_jpy != null && (
                          <span className="text-caption text-muted">
                            {messages.accountDetail.priceSuggestionLabel(a.price_jpy)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/accounts/${a.account.id}`} className="text-caption text-muted no-underline hover:underline">
                          {a.account.display_name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span
                          className={cn(
                            'rounded-pill border px-2 py-0.5 text-caption',
                            stage === 'published' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
                            stage === 'pre_publish' && 'border-amber-300 bg-amber-50 text-amber-700',
                            stage === 'in_progress' && 'border-border-warm bg-cream-light text-charcoal-82',
                            stage === 'other' && 'border-border-warm bg-white text-muted',
                          )}
                        >
                          {m.stageLabel[stage]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-caption text-muted">
                        {statusLabel}
                        {stage !== 'in_progress' && a.publish_status !== 'draft' ? ` ／ ${publishStatusLabel}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.quality_score ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-caption">
                        {a.note_url ? (
                          <a href={a.note_url} target="_blank" rel="noopener noreferrer" className="text-charcoal underline">
                            {m.openNote}
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-caption text-muted tabular-nums">
                        {(a.published_at ?? a.updated_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
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
