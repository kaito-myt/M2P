/**
 * S-ANP-05 — note アカウント設計: ブリーフ入力 + 設計案一覧 (docs/11-anp-design.md §3.1/§7, F-ANP-01/03)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

import { BriefForm } from './brief-form';

export default async function AccountDesignPage() {
  const designs = await prisma.noteAccountDesign.findMany({
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, brief_json: true, created_at: true },
    take: 50,
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <Link href="/accounts" className="text-caption text-muted no-underline hover:underline">
        {messages.accountDesign.back}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{messages.accountDesign.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{messages.accountDesign.pageDescription}</p>
      </header>

      <section className="mt-space-loose rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <h2 className="text-card-title font-medium text-charcoal">{messages.accountDesign.briefForm.title}</h2>
        <BriefForm />
      </section>

      <section className="mt-space-loose">
        {designs.length === 0 ? (
          <p className="text-body text-muted">{messages.accountDesign.empty}</p>
        ) : (
          <ul className="flex flex-col gap-space-snug">
            {designs.map((d) => {
              const idea =
                d.brief_json && typeof d.brief_json === 'object' && 'idea' in d.brief_json
                  ? String((d.brief_json as Record<string, unknown>).idea ?? '')
                  : '';
              const statusLabel =
                messages.accountDesign.statusLabel[
                  d.status as keyof typeof messages.accountDesign.statusLabel
                ] ?? d.status;
              return (
                <li key={d.id}>
                  <Link
                    href={`/accounts/design/${d.id}`}
                    className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed no-underline hover:bg-charcoal-04"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-card-title font-medium text-charcoal">
                        {idea || messages.accountDesign.ideaLabel}
                      </span>
                      <span className="rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                        {statusLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-caption text-muted">
                      {messages.accountDesign.createdAt}: {d.created_at.toLocaleString('ja-JP')}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// Railway ビルド時のプリレンダリングで DB 接続に失敗する既知の罠 (docs/11 §7 申し送り17)。
export const dynamic = 'force-dynamic';
