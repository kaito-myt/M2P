/**
 * ChannelChecklistPage — 楽天Kobo / BOOTH 入稿タブの共通 RSC (F-095/F-096)。
 * /kobo と /booth の両ページ本体。チャネル別のステータス列を選んで一覧に渡す。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { EmptyState } from '@/components/common/empty-state';
import {
  ChannelChecklistClient,
  type ChannelBook,
} from '@/components/channels/channel-checklist-client';

const mc = messages.channelChecklist.common;

export async function ChannelChecklistPage({ channel }: { channel: 'kobo' | 'booth' }) {
  const mch = messages.channelChecklist[channel];
  const booksRaw = await prisma.book.findMany({
    where: { status: { in: ['done', 'needs_human_review'] } },
    orderBy: { done_at: 'desc' },
    select: {
      id: true,
      title: true,
      subtitle: true,
      kobo_publish_status: true,
      kobo_publish_queued: true,
      booth_publish_status: true,
      booth_publish_queued: true,
      account: { select: { pen_name: true } },
      kdpMetadata: { select: { id: true } },
      revisionComments: { select: { id: true }, where: { priority: 'must', status: 'pending' } },
    },
  });

  const books: ChannelBook[] = booksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    penName: b.account?.pen_name ?? null,
    channelStatus: channel === 'kobo' ? b.kobo_publish_status : b.booth_publish_status,
    channelQueued: channel === 'kobo' ? b.kobo_publish_queued : b.booth_publish_queued,
    metadataMissing: b.kdpMetadata == null,
    hasBlockingComments: b.revisionComments.length > 0,
  }));

  return (
    <div className="flex flex-col gap-space-loose" data-testid={`${channel}-checklist-page`}>
      <header className="flex items-start justify-between gap-space-snug">
        <div className="flex flex-col gap-space-snug">
          <nav aria-label="breadcrumb" className="text-button-sm text-muted">
            <Link href="/dashboard" className="no-underline hover:underline">
              {mc.breadcrumbHome}
            </Link>
            <span aria-hidden="true"> &gt; </span>
            <span>{mc.breadcrumbPipeline}</span>
            <span aria-hidden="true"> &gt; </span>
            <span>{mch.pageTitle}</span>
          </nav>
          <h1 className="text-sub-heading text-foreground">{mch.pageTitle}</h1>
        </div>
        <a
          href={mch.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-card border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04"
          data-testid={`${channel}-open-link`}
        >
          {mch.openLabel}
        </a>
      </header>

      {books.length === 0 ? (
        <EmptyState
          title={mc.empty.title}
          message={mc.empty.body}
          action={
            <Link
              href="/books"
              className="inline-flex items-center rounded-card border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04"
            >
              {mc.empty.cta}
            </Link>
          }
          data-testid={`${channel}-checklist-empty`}
        />
      ) : (
        <ChannelChecklistClient channel={channel} engineNote={mch.engineNote} books={books} />
      )}
    </div>
  );
}
