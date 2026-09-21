'use client';

/**
 * ThemeCard — テーマ一覧 (S-ANP-13) の 1 件。承認 (= 記事作成してパイプライン起動) / 却下。
 * 承認済みで記事があれば記事詳細へのリンクを出す。
 */
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { approveTheme, rejectTheme } from '@/app/actions/themes';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';

export interface ThemeCardTheme {
  id: string;
  title: string;
  hook: string;
  target_reader: string | null;
  recommend_paid: boolean;
  suggested_price: number | null;
  genre: string;
  status: string;
  rejected_reason: string | null;
  created_at: string;
  account: { id: string; display_name: string };
  article: { id: string; title: string; status: string; publish_status: string } | null;
}

const am = messages.accountDetail;
const m = messages.themes;

export function ThemeCard({ theme, showAccount }: { theme: ThemeCardTheme; showAccount: boolean }) {
  const [status, setStatus] = useState(theme.status);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const statusLabel = am.themeStatus[status as keyof typeof am.themeStatus] ?? status;

  return (
    <li className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid={`theme-card-${theme.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-card-title font-medium text-charcoal">{theme.title}</span>
          <p className="mt-0.5 text-caption text-muted">
            {showAccount && (
              <>
                <Link href={`/accounts/${theme.account.id}`} className="text-muted no-underline hover:underline">
                  {theme.account.display_name}
                </Link>
                {' ・ '}
              </>
            )}
            {theme.genre}
            {' ・ '}
            {new Date(theme.created_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-pill border px-2 py-0.5 text-caption',
            status === 'accepted' && 'border-emerald-300 bg-emerald-50 text-emerald-700',
            status === 'rejected' && 'border-border-warm bg-white text-muted',
            status === 'pending' && 'border-amber-300 bg-amber-50 text-amber-700',
          )}
        >
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-body text-muted">{theme.hook}</p>
      <p className="mt-1 text-caption text-muted">
        {theme.recommend_paid ? am.recommendPaid : am.recommendFree}
        {theme.suggested_price != null ? ` ・ ${am.suggestedPrice(theme.suggested_price)}` : ''}
        {theme.target_reader ? ` ・ 想定読者: ${theme.target_reader}` : ''}
      </p>
      {theme.rejected_reason && status === 'rejected' && <p className="mt-1 text-caption text-muted">{m.rejectedReason(theme.rejected_reason)}</p>}
      {theme.article && (
        <p className="mt-1 text-caption">
          <Link href={`/articles/${theme.article.id}`} className="text-charcoal underline">
            {m.openArticle}
          </Link>
          <span className="ml-1 text-muted">
            ({am.articleStatus[theme.article.status as keyof typeof am.articleStatus] ?? theme.article.status})
          </span>
        </p>
      )}

      {status === 'pending' && (
        <div className="mt-space-snug flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await approveTheme({ theme_id: theme.id });
                if (!result.ok) setError(result.error);
                else setStatus('accepted');
              });
            }}
            className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
            data-testid={`theme-approve-${theme.id}`}
          >
            {messages.common.approve}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await rejectTheme({ theme_id: theme.id });
                if (!result.ok) setError(result.error);
                else setStatus('rejected');
              });
            }}
            className="rounded-card border border-border-warm bg-white px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
            data-testid={`theme-reject-${theme.id}`}
          >
            {messages.common.reject}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-caption text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}
