/**
 * S-ANP-02 — note アカウント詳細: テーマ候補一覧 (承認/却下) + 記事一覧 (docs/11-anp-design.md §7)。
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';

import { messages } from '@/lib/messages';

import { GenerateThemesButton } from './generate-themes-button';
import { ThemeCard } from './theme-card';

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const account = await prisma.noteAccount.findUnique({
    where: { id },
    select: { id: true, niche: true, display_name: true, target_reader: true, tone: true, status: true },
  });
  if (!account) notFound();

  const [themes, articles] = await Promise.all([
    prisma.noteTheme.findMany({
      where: { note_account_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        hook: true,
        target_reader: true,
        recommend_paid: true,
        suggested_price: true,
        status: true,
      },
    }),
    prisma.noteArticle.findMany({
      where: { note_account_id: id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        paid: true,
        price_jpy: true,
        quality_score: true,
        created_at: true,
      },
    }),
  ]);

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-space-relaxed py-space-loose">
      <Link href="/accounts" className="text-caption text-muted no-underline hover:underline">
        {messages.accountDetail.back}
      </Link>

      <header className="mt-space-snug">
        <h1 className="text-sub-heading font-medium text-charcoal">{account.display_name}</h1>
        <p className="mt-1 text-body text-muted">
          ニッチ: {account.niche}
          {account.target_reader ? ` ／ 想定読者: ${account.target_reader}` : ''}
          {account.tone ? ` ／ トーン: ${account.tone}` : ''}
        </p>
      </header>

      <section className="mt-space-loose">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-card-title font-medium text-charcoal">{messages.accountDetail.themesTitle}</h2>
          <GenerateThemesButton noteAccountId={account.id} />
        </div>
        {themes.length === 0 ? (
          <p className="mt-2 text-body text-muted">{messages.accountDetail.themesEmpty}</p>
        ) : (
          <ul className="mt-space-snug flex flex-col gap-space-snug">
            {themes.map((t) => (
              <ThemeCard key={t.id} theme={t} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-space-loose">
        <h2 className="text-card-title font-medium text-charcoal">{messages.accountDetail.articlesTitle}</h2>
        {articles.length === 0 ? (
          <p className="mt-2 text-body text-muted">{messages.accountDetail.articlesEmpty}</p>
        ) : (
          <ul className="mt-space-snug flex flex-col gap-space-snug">
            {articles.map((a) => {
              const statusLabel =
                messages.accountDetail.articleStatus[
                  a.status as keyof typeof messages.accountDetail.articleStatus
                ] ?? a.status;
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-container border border-border-warm bg-cream-light p-space-relaxed"
                >
                  <div>
                    <p className="text-body font-medium text-charcoal">{a.title}</p>
                    <p className="text-caption text-muted">
                      {a.paid ? `有料 ${a.price_jpy ? `¥${a.price_jpy.toLocaleString('ja-JP')}` : ''}` : '無料'}
                      {a.quality_score != null ? ` ・ スコア ${a.quality_score}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
                    {statusLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
