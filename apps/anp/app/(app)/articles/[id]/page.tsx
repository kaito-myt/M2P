/**
 * S-ANP-08 — 記事詳細 (docs/11-anp-design.md §3.2/§7)。
 *
 * タイトル/リード/本文/アイキャッチ/ステータス/note_url/品質スコアと内訳/コスト/
 * ジョブ履歴/売上/告知投稿を1画面に集約する。`needs_human_review` 操作と「公開」操作もここから使える。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage/operations';

import { messages } from '@/lib/messages';
import { parseNoteMarkdown } from '@/lib/note-markdown';

import { ArticleReviewActions } from '../../accounts/[id]/article-review-actions';
import { PublishArticleButton } from '../../accounts/[id]/publish-article-button';

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

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

/** JST 基準の当月 "YYYY-MM"。 */
function jstYearMonth(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface JudgeResultJson {
  score_total?: number;
  score_breakdown?: Record<string, number>;
  judge_comments?: Record<string, string>;
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const article = await prisma.noteArticle.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      lead: true,
      body_md: true,
      paid: true,
      price_jpy: true,
      eyecatch_r2_key: true,
      status: true,
      publish_status: true,
      note_url: true,
      cost_jpy_total: true,
      quality_score: true,
      published_at: true,
      created_at: true,
      account: { select: { id: true, display_name: true } },
    },
  });
  if (!article) notFound();

  const [jobs, salesRecords, promotionPosts, appSettings] = await Promise.all([
    prisma.job.findMany({
      where: { payload_json: { path: ['note_article_id'], equals: id } },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: { id: true, kind: true, status: true, finished_at: true, error: true, result_json: true, created_at: true },
    }),
    prisma.noteSalesRecord.findMany({
      where: { note_article_id: id },
      orderBy: { year_month: 'desc' },
      select: { year_month: true, revenue_jpy: true, views: true, likes: true },
    }),
    prisma.promotionPost.findMany({
      where: { note_article_id: id },
      orderBy: { scheduled_for: 'asc' },
      select: { id: true, channel: true, status: true, scheduled_for: true },
    }),
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { anp_publish_dry_run: true } }),
  ]);
  const globalDryRunEnabled = appSettings?.anp_publish_dry_run ?? true;

  const eyecatchUrl = article.eyecatch_r2_key ? await getSignedDownloadUrl(article.eyecatch_r2_key, 900) : null;

  const judgeJob = jobs.find((j) => j.kind === 'pipeline.note.judge' && j.result_json);
  const judgeResult = (judgeJob?.result_json ?? null) as JudgeResultJson | null;

  const ym = jstYearMonth(new Date());
  const thisMonthSales = salesRecords.find((s) => s.year_month === ym);
  const totalSales = salesRecords.reduce(
    (acc, s) => ({ revenue: acc.revenue + s.revenue_jpy, views: acc.views + s.views, likes: acc.likes + s.likes }),
    { revenue: 0, views: 0, likes: 0 },
  );

  const dm = messages.articles.detail;
  const statusLabel =
    messages.accountDetail.articleStatus[article.status as keyof typeof messages.accountDetail.articleStatus] ??
    article.status;
  const publishStatusLabel =
    messages.accountDetail.publishStatus[article.publish_status as keyof typeof messages.accountDetail.publishStatus] ??
    article.publish_status;
  const blocks = parseNoteMarkdown(article.body_md ?? '');

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link href="/articles" className="text-caption text-muted no-underline hover:underline">
        {dm.back}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{article.title}</h1>
        <p className="mt-1 text-body text-muted">
          <Link href={`/accounts/${article.account.id}`} className="text-charcoal no-underline hover:underline">
            {article.account.display_name}
          </Link>
          {` ・ ${article.created_at.toLocaleString('ja-JP')}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted">
          <span className="rounded-pill border border-border-warm px-2 py-0.5">
            {dm.statusLabel}: {statusLabel}
          </span>
          <span className="rounded-pill border border-border-warm px-2 py-0.5">
            {dm.publishStatusLabel}: {publishStatusLabel}
          </span>
          {!article.paid && article.price_jpy != null && (
            <span className="rounded-pill border border-border-warm px-2 py-0.5">
              {messages.accountDetail.priceSuggestionLabel(article.price_jpy)}
            </span>
          )}
          {article.quality_score != null && (
            <span className="rounded-pill border border-border-warm px-2 py-0.5">
              {dm.qualityScoreLabel}: {article.quality_score}
            </span>
          )}
        </div>
        {article.note_url && (
          <p className="mt-2 text-caption">
            {dm.noteUrlLabel}:{' '}
            <a href={article.note_url} target="_blank" rel="noreferrer" className="text-charcoal underline">
              {article.note_url}
            </a>
          </p>
        )}
        <div className="mt-space-snug flex flex-col items-start gap-1">
          {(article.status === 'ready' || article.status === 'needs_human_review') && (
            <PublishArticleButton articleId={article.id} globalDryRunEnabled={globalDryRunEnabled} />
          )}
          {article.status === 'needs_human_review' && <ArticleReviewActions articleId={article.id} />}
        </div>
      </header>

      {eyecatchUrl && (
        <section className="mt-space-loose">
          <h2 className="text-section-title text-charcoal">{dm.eyecatchLabel}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={eyecatchUrl}
            alt={article.title}
            className="mt-2 max-w-full rounded-container border border-border-warm"
          />
        </section>
      )}

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{dm.bodyLabel}</h2>
        {article.lead && (
          <p className="mt-2 rounded-container border border-border-warm bg-cream-light p-space-relaxed text-body font-medium text-charcoal">
            {article.lead}
          </p>
        )}
        {blocks.length === 0 ? (
          <p className="mt-2 text-body text-muted">{dm.bodyEmpty}</p>
        ) : (
          <div className="prose prose-sm mt-space-snug max-w-none text-charcoal">
            {blocks.map((b, i) => {
              if (b.type === 'heading') {
                const Tag = b.level === 2 ? 'h3' : 'h4';
                return <Tag key={i}>{b.text}</Tag>;
              }
              if (b.type === 'list') {
                return (
                  <ul key={i}>
                    {b.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                );
              }
              return <p key={i}>{b.text}</p>;
            })}
          </div>
        )}
      </section>

      {judgeResult && (
        <section className="mt-space-loose">
          <h2 className="text-section-title text-charcoal">{dm.qualityBreakdownLabel}</h2>
          <div className="mt-2 grid grid-cols-2 gap-space-snug sm:grid-cols-4">
            {Object.entries(judgeResult.score_breakdown ?? {}).map(([axis, score]) => (
              <div key={axis} className="rounded-container border border-border-warm bg-cream-light p-space-snug">
                <p className="text-caption text-muted">
                  {dm.qualityAxis[axis as keyof typeof dm.qualityAxis] ?? axis}
                </p>
                <p className="mt-1 text-card-title font-medium text-charcoal">{score}</p>
              </div>
            ))}
          </div>
          {judgeResult.judge_comments && Object.keys(judgeResult.judge_comments).length > 0 && (
            <div className="mt-space-snug">
              <p className="text-caption font-medium text-muted">{dm.qualityCommentsLabel}</p>
              <ul className="mt-1 list-inside list-disc text-body text-muted">
                {Object.entries(judgeResult.judge_comments).map(([axis, comment]) => (
                  <li key={axis}>
                    {dm.qualityAxis[axis as keyof typeof dm.qualityAxis] ?? axis}: {comment}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="mt-space-loose grid grid-cols-1 gap-space-relaxed sm:grid-cols-2">
        <div>
          <h2 className="text-section-title text-charcoal">{dm.costLabel}</h2>
          <p className="mt-2 text-card-title font-medium text-charcoal">{yen(toNumber(article.cost_jpy_total))}</p>
        </div>
        <div>
          <h2 className="text-section-title text-charcoal">{dm.salesLabel}</h2>
          {salesRecords.length === 0 ? (
            <p className="mt-2 text-body text-muted">{dm.salesEmpty}</p>
          ) : (
            <dl className="mt-2 grid grid-cols-2 gap-2 text-body text-charcoal">
              <dt className="text-caption text-muted">{dm.salesThisMonth}</dt>
              <dd>{yen(thisMonthSales?.revenue_jpy ?? 0)}</dd>
              <dt className="text-caption text-muted">{dm.salesTotal}</dt>
              <dd>{yen(totalSales.revenue)}</dd>
            </dl>
          )}
        </div>
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{dm.jobHistoryLabel}</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-body text-muted">{dm.jobHistoryEmpty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-container border border-border-warm">
            <table className="w-full min-w-[560px] border-collapse text-body">
              <thead>
                <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
                  <th className="px-3 py-2 text-left font-medium">{dm.jobHistoryColumns.kind}</th>
                  <th className="px-3 py-2 text-left font-medium">{dm.jobHistoryColumns.status}</th>
                  <th className="px-3 py-2 text-left font-medium">{dm.jobHistoryColumns.finishedAt}</th>
                  <th className="px-3 py-2 text-left font-medium">{dm.jobHistoryColumns.error}</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-b border-border-warm last:border-b-0">
                    <td className="px-3 py-2 text-caption text-charcoal">{j.kind}</td>
                    <td className="px-3 py-2 text-caption text-muted">{j.status}</td>
                    <td className="px-3 py-2 text-caption text-muted">
                      {j.finished_at ? j.finished_at.toLocaleString('ja-JP') : '—'}
                    </td>
                    <td className="px-3 py-2 text-caption text-red-600">{j.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-space-loose">
        <h2 className="text-section-title text-charcoal">{dm.promotionLabel}</h2>
        {promotionPosts.length === 0 ? (
          <p className="mt-2 text-body text-muted">{dm.promotionEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {promotionPosts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-container border border-border-warm bg-cream-light px-3 py-2 text-body text-charcoal"
              >
                <span>{p.channel}</span>
                <span className="text-caption text-muted">{p.status}</span>
                <span className="text-caption text-muted">{p.scheduled_for.toLocaleString('ja-JP')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export const dynamic = 'force-dynamic';
