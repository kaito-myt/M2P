/**
 * S-ANP-01 — note アカウント一覧 + 作成フォーム (docs/11-anp-design.md §7)。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

import { CreateAccountForm } from './create-account-form';

export default async function AccountsPage() {
  const accounts = await prisma.noteAccount.findMany({
    orderBy: { created_at: 'desc' },
    select: { id: true, niche: true, display_name: true, target_reader: true, status: true, created_at: true },
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <header>
        <h1 className="text-sub-heading font-medium text-charcoal">{messages.accounts.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{messages.accounts.pageDescription}</p>
      </header>

      <section className="mt-space-relaxed">
        {accounts.length === 0 ? (
          <p className="text-body text-muted">{messages.accounts.empty}</p>
        ) : (
          <ul className="flex flex-col gap-space-snug">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/accounts/${a.id}`}
                  className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed no-underline hover:bg-charcoal-04"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-card-title font-medium text-charcoal">{a.display_name}</span>
                    <span className="rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                      {a.status}
                    </span>
                  </div>
                  <p className="mt-1 text-body text-muted">
                    ニッチ: {a.niche}
                    {a.target_reader ? ` ／ 想定読者: ${a.target_reader}` : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-space-loose rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <h2 className="text-card-title font-medium text-charcoal">{messages.accounts.form.title}</h2>
        <CreateAccountForm />
      </section>
    </div>
  );
}
