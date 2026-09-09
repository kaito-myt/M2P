/**
 * 販促施策 (F-051) — 出版した本を「売れる」状態にする AI 販促プランの一覧。
 */
import type { Metadata } from 'next';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';
import { PageHeading } from '@/components/common/page-heading';
import { PromotionList } from '@/components/promotion/promotion-list';
import type { PromotionBookRow } from '@/lib/promotion-view';

export const metadata: Metadata = {
  title: `${messages.promotion.pageTitle} | ${messages.brand.appName}`,
};

export const dynamic = 'force-dynamic';

const m = messages.promotion;

export default async function PromotionPage() {
  // 完成した本 (done / published) を対象にする。
  const booksRaw = await prisma.book.findMany({
    where: { status: { in: ['done'] } },
    orderBy: { updated_at: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      publish_status: true,
      updated_at: true,
      account: { select: { pen_name: true } },
      promotionPlan: { select: { id: true, updated_at: true } },
    },
  });

  const books: PromotionBookRow[] = booksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.account.pen_name,
    status: b.publish_status,
    hasPlan: b.promotionPlan !== null,
    updatedAt: b.updated_at instanceof Date ? b.updated_at.toISOString() : null,
  }));

  return (
    <div className="flex flex-col gap-space-loose" data-testid="promotion-page">
      <PageHeading eyebrow={messages.nav.sectionPromotion} title={m.pageTitle} description={m.pageSubtitle} />

      {books.length === 0 ? (
        <div className="rounded-card border border-border-warm bg-cream-light p-space-loose text-center">
          <p className="text-body font-medium text-charcoal">{m.empty.title}</p>
          <p className="mt-2 text-body text-muted">{m.empty.body}</p>
        </div>
      ) : (
        <PromotionList books={books} />
      )}
    </div>
  );
}
