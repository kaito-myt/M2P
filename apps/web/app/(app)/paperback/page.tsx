/**
 * ペーパーバック出版 RSC ページ (F-097)。
 *
 * 運営者指摘「ペーパーバックが結構売れてるから、確実に出版した本はペーパーバックも
 * 出版されるように」への可視化。KDP (Kindle) 出版済みの本のうち、ペーパーバックが
 * どこまで出ているかを一覧し、未対応の本を「化キュー」に積む。
 *
 * 実際の入稿・出版は KDP の再認証壁のためサーバーからは行えず、ローカルアシスト
 * (`bash scripts/paperback/pb-env.sh bash scripts/paperback/pb-auto.sh all`) が
 * 本キューを読んで実行し、結果を `books.pb_*` に書き戻す。
 *
 * 仕様根拠: docs/05 §5.3.15b / docs/02 F-097
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { EmptyState } from '@/components/common/empty-state';
import {
  PaperbackChecklistClient,
  type PaperbackBook,
} from '@/components/paperback/paperback-checklist-client';

export const metadata: Metadata = {
  title: `${messages.paperback.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.paperback;

export default async function PaperbackPage() {
  const booksRaw = await prisma.book.findMany({
    where: { publish_status: 'published' },
    orderBy: [{ pb_publish_status: 'asc' }, { created_at: 'desc' }],
    select: {
      id: true,
      title: true,
      asin: true,
      pb_publish_status: true,
      pb_publish_queued: true,
      pb_title_id: true,
      pb_drafted_at: true,
      pb_submitted_at: true,
      pb_last_error: true,
      account: { select: { pen_name: true } },
    },
  });

  const books: PaperbackBook[] = booksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    asin: b.asin,
    penName: b.account?.pen_name ?? null,
    status: b.pb_publish_status,
    queued: b.pb_publish_queued,
    titleId: b.pb_title_id,
    draftedAt: b.pb_drafted_at ? b.pb_drafted_at.toISOString() : null,
    submittedAt: b.pb_submitted_at ? b.pb_submitted_at.toISOString() : null,
    lastError: b.pb_last_error,
  }));

  const published = books.filter((b) => b.status === 'published').length;
  const coverage = books.length > 0 ? Math.round((published / books.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-space-loose" data-testid="paperback-page">
      <header className="flex flex-col gap-space-snug">
        <nav aria-label="breadcrumb" className="text-button-sm text-muted">
          <Link href="/dashboard" className="no-underline hover:underline">
            {m.breadcrumbHome}
          </Link>
          <span aria-hidden="true"> &gt; </span>
          <span>{m.breadcrumbPipeline}</span>
          <span aria-hidden="true"> &gt; </span>
          <span>{m.pageTitle}</span>
        </nav>
        <h1 className="text-sub-heading text-foreground">{m.pageTitle}</h1>
        <p className="text-body-sm text-muted">{m.description}</p>
      </header>

      <section
        className="flex flex-wrap items-baseline gap-space-loose rounded-card border border-border-warm bg-cream px-4 py-3"
        data-testid="paperback-coverage"
      >
        <span className="text-body-sm text-muted">{m.coverageLabel}</span>
        <strong className="text-sub-heading text-foreground">
          {published} / {books.length}
          <span className="ml-2 text-body-sm text-muted">({coverage}%)</span>
        </strong>
        <span className="text-body-sm text-muted">{m.runHint}</span>
      </section>

      {books.length === 0 ? (
        <EmptyState title={m.empty.title} message={m.empty.body} data-testid="paperback-empty" />
      ) : (
        <PaperbackChecklistClient books={books} />
      )}
    </div>
  );
}
