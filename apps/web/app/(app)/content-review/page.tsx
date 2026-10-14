/**
 * 本文承認 (content_review) — 出版パイプラインの人手ゲート。
 *
 * 本文の執筆・校閲が完了し status='content_review' で停止している書籍を横断表示し、
 * 承認するとサムネ生成 (thumbnail.text) へ進める。アウトライン承認 / サムネ承認と
 * 同列のゲートページ。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { ContentReviewList } from '@/components/content-review/content-review-list';

export const metadata: Metadata = {
  title: `${messages.contentReview.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.contentReview;

export default async function ContentReviewPage() {
  const booksRaw = await prisma.book.findMany({
    where: { status: 'content_review' },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      title: true,
      updated_at: true,
      account: { select: { pen_name: true } },
      _count: { select: { chapters: true } },
    },
  });

  const books = booksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.account.pen_name,
    chapterCount: b._count.chapters,
    updatedAt: b.updated_at instanceof Date ? b.updated_at.toISOString() : null,
  }));

  // [F-099] judge が基準点に届かず止まった本 (needs_human_review)。
  // ここに出すまで**承認する場所が無く**、最長 1 か月放置されていた。
  const judgeFailedRaw = await prisma.book.findMany({
    where: { status: 'needs_human_review' },
    orderBy: { updated_at: 'asc' },
    select: {
      id: true,
      title: true,
      updated_at: true,
      account: { select: { pen_name: true } },
      evalResults: {
        orderBy: { judged_at: 'desc' },
        take: 1,
        select: { score_total: true },
      },
    },
  });
  const judgeFailed = judgeFailedRaw.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.account.pen_name,
    scoreTotal: b.evalResults[0]?.score_total ?? null,
    updatedAt: b.updated_at instanceof Date ? b.updated_at.toISOString() : null,
  }));

  return (
    <div className="flex flex-col gap-space-loose" data-testid="content-review-page">
      <header className="flex flex-col gap-space-snug">
        <nav aria-label="breadcrumb" className="text-button-sm text-muted">
          <Link href="/dashboard" className="no-underline hover:underline">
            {m.breadcrumbHome}
          </Link>
          <span aria-hidden="true"> &gt; </span>
          <span>{m.breadcrumbPipeline}</span>
          <span aria-hidden="true"> &gt; </span>
          <span>{m.breadcrumbContentReview}</span>
        </nav>
        <div className="flex flex-col">
          <h1 className="text-sub-heading text-foreground">{m.pageTitle}</h1>
          <p className="text-body text-muted">{m.pageSubtitle}</p>
        </div>
        {books.length > 0 && (
          <span className="text-button-sm text-charcoal-82" data-testid="content-review-summary">
            {m.summary(books.length)}
          </span>
        )}
      </header>

      {books.length === 0 ? (
        <div
          data-testid="content-review-empty"
          className="rounded-card border border-border-warm bg-cream-light p-space-loose text-center"
        >
          <p className="text-body font-medium text-charcoal">{m.empty.title}</p>
          <p className="mt-2 text-body text-muted">{m.empty.body}</p>
        </div>
      ) : (
        <ContentReviewList books={books} />
      )}

      {judgeFailed.length > 0 && (
        <section className="flex flex-col gap-space-snug" data-testid="judge-failed-section">
          <div className="flex flex-col">
            <h2 className="text-sub-heading text-foreground">{m.judgeFailed.title}</h2>
            <p className="text-body text-muted">{m.judgeFailed.subtitle}</p>
          </div>
          <ul className="flex flex-col gap-space-snug" data-testid="judge-failed-list">
            {judgeFailed.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-space-snug rounded-card border border-border-warm bg-cream-light p-space-relaxed"
              >
                <div className="flex min-w-0 flex-col">
                  <Link
                    href={`/books/${b.id}`}
                    className="truncate text-body font-medium text-charcoal no-underline hover:underline"
                  >
                    {b.title}
                  </Link>
                  <span className="text-button-sm text-muted">{b.author}</span>
                </div>
                <div className="flex shrink-0 items-center gap-space-snug">
                  {typeof b.scoreTotal === 'number' && (
                    <span className="text-button-sm text-charcoal-82">{b.scoreTotal} / 100</span>
                  )}
                  <Link
                    href={`/books/${b.id}`}
                    className="text-button-sm text-charcoal no-underline hover:underline"
                  >
                    {m.judgeFailed.openLabel}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
