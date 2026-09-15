'use client';

import { useState, useTransition } from 'react';

import { approveTheme, rejectTheme } from '@/app/actions/themes';
import { messages } from '@/lib/messages';

interface ThemeCardProps {
  theme: {
    id: string;
    title: string;
    hook: string;
    target_reader: string | null;
    recommend_paid: boolean;
    suggested_price: number | null;
    status: string;
  };
}

export function ThemeCard({ theme }: ThemeCardProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const statusLabel =
    messages.accountDetail.themeStatus[theme.status as keyof typeof messages.accountDetail.themeStatus] ??
    theme.status;

  return (
    <li className="flex flex-col rounded-container border border-border-warm bg-cream-light p-space-relaxed">
      <div className="flex items-start justify-between gap-2">
        <span className="text-card-title font-medium text-charcoal">{theme.title}</span>
        <span className="shrink-0 rounded-pill border border-border-warm px-2 py-0.5 text-caption text-muted">
          {statusLabel}
        </span>
      </div>
      <p className="mt-1 text-body text-muted">{theme.hook}</p>
      <p className="mt-1 text-caption text-muted">
        {theme.recommend_paid
          ? messages.accountDetail.recommendPaid
          : messages.accountDetail.recommendFree}
        {theme.suggested_price != null
          ? ` ・ ${messages.accountDetail.suggestedPrice(theme.suggested_price)}`
          : ''}
        {theme.target_reader ? ` ・ 想定読者: ${theme.target_reader}` : ''}
      </p>

      {theme.status === 'pending' && (
        <div className="mt-space-snug flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await approveTheme({ theme_id: theme.id });
                if (!result.ok) setError(result.error);
              });
            }}
            className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
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
              });
            }}
            className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
          >
            {messages.common.reject}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-caption text-red-600">{error}</p>}
    </li>
  );
}
