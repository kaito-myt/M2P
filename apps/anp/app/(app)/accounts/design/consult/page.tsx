/**
 * S-ANP-07 — note アカウント戦略の AI 相談: 新規相談 + 相談一覧 (docs/11-anp-design.md §3.1/§7, F-ANP-04)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

import { StartConsultForm } from './start-consult-form';

export default async function AccountConsultListPage() {
  const rows = await prisma.noteAccountConsultation.findMany({
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      ready_to_design: true,
      updated_at: true,
      _count: { select: { messages: true, designs: true } },
    },
    take: 50,
  });

  const cm = messages.accountConsult;

  return (
    <div className="mx-auto flex max-w-4xl flex-col">
      <Link href="/accounts/design" className="text-caption text-muted no-underline hover:underline">
        {cm.back}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{cm.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{cm.pageDescription}</p>
      </header>

      <section className="mt-space-loose rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <h2 className="text-card-title font-medium text-charcoal">{cm.start.title}</h2>
        <StartConsultForm />
      </section>

      <section className="mt-space-loose">
        <h2 className="text-card-title font-medium text-charcoal">{cm.list.title}</h2>
        {rows.length === 0 ? (
          <p className="mt-space-snug text-body text-muted">{cm.list.empty}</p>
        ) : (
          <ul className="mt-space-snug flex flex-col gap-space-snug">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/accounts/design/consult/${r.id}`}
                  className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed no-underline hover:bg-charcoal-04"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-card-title font-medium text-charcoal">
                      {r.title || cm.pageTitle}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.ready_to_design && (
                        <span className="rounded-pill border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-caption text-emerald-700">
                          {cm.list.readyBadge}
                        </span>
                      )}
                      {r.status === 'archived' && (
                        <span className="rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                          {cm.list.archivedBadge}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-muted">
                    {cm.list.updatedAt}: {r.updated_at.toLocaleString('ja-JP')} ・ {r._count.messages} 通 ・{' '}
                    {cm.list.designs}: {r._count.designs}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Railway ビルド時のプリレンダリングで DB 接続に失敗する既知の罠 (docs/11 §7 申し送り17)。
export const dynamic = 'force-dynamic';
