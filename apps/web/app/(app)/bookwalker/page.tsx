/**
 * BOOK☆WALKER 入稿 RSC ページ (F-094)。
 *
 * KDP 入稿チェックリスト (S-015) と同型の出版チャネルタブ。生成完了済みの書籍を一覧し、
 * 自動入稿キューへの登録/取消と、サーバー自動申請 (bw.submit.dispatch) の設定を行う。
 *
 * 仕様根拠: docs/02 F-094 / docs/05 §5.3.15c
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { EmptyState } from '@/components/common/empty-state';
import { BwChecklistClient, type BwChecklistBook } from '@/components/bookwalker/bw-checklist-client';
import { BwSettingsForm } from '@/components/bookwalker/bw-settings-form';

export const metadata: Metadata = {
  title: `${messages.bwChecklist.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.bwChecklist;

export default async function BookwalkerChecklistPage() {
  const [booksRaw, settings] = await Promise.all([
    prisma.book.findMany({
      where: {
        status: { in: ['done', 'needs_human_review'] },
      },
      orderBy: { done_at: 'desc' },
      select: {
        id: true,
        title: true,
        subtitle: true,
        bw_publish_status: true,
        bw_publish_queued: true,
        bw_submitted_at: true,
        account: { select: { pen_name: true } },
        kdpMetadata: { select: { id: true } },
        revisionComments: {
          select: { id: true },
          where: { priority: 'must', status: 'pending' },
        },
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        bw_auto_submit_enabled: true,
        bw_submit_dry_run: true,
        bw_session_state_enc: true,
      },
    }),
  ]);

  const books: BwChecklistBook[] = booksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    penName: b.account?.pen_name ?? null,
    bwPublishStatus: b.bw_publish_status,
    bwPublishQueued: b.bw_publish_queued,
    bwSubmittedAt: b.bw_submitted_at ? b.bw_submitted_at.toISOString() : null,
    metadataMissing: b.kdpMetadata == null,
    hasBlockingComments: b.revisionComments.length > 0,
  }));

  return (
    <div className="flex flex-col gap-space-loose" data-testid="bw-checklist-page">
      <header className="flex items-start justify-between gap-space-snug">
        <div className="flex flex-col gap-space-snug">
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
        </div>
        <a
          href="https://author.bookwalker.jp/books"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-card border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04"
          data-testid="bw-open-link"
          aria-label={m.openBwAriaLabel}
        >
          {m.openBw}
        </a>
      </header>

      <BwSettingsForm
        initialData={{
          bw_auto_submit_enabled: settings?.bw_auto_submit_enabled ?? false,
          bw_submit_dry_run: settings?.bw_submit_dry_run ?? false,
          session_saved: Boolean(settings?.bw_session_state_enc),
        }}
      />

      {books.length === 0 ? (
        <EmptyState
          title={m.empty.title}
          message={m.empty.body}
          action={
            <Link
              href="/books"
              className="inline-flex items-center rounded-card border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04"
            >
              {m.empty.cta}
            </Link>
          }
          data-testid="bw-checklist-empty"
        />
      ) : (
        <BwChecklistClient books={books} />
      )}
    </div>
  );
}
