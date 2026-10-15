'use client';

/**
 * KenpRateSettings — 設定画面「KENP 推計レート」(docs/09 §10.7)。
 *
 * 月別ロイヤリティ PMR には KENP 金額が無く確定月から導出できないため、運営者がレートを入れる。
 * 入れた値による売上はあくまで推計 (kenp_royalty_estimated_jpy) として計上される。
 */
import { useState, useCallback } from 'react';
import { CheckCircle, XCircle, Info } from 'lucide-react';

import { updateSettings } from '@/app/actions/settings';
import { isPlausibleKenpRate } from '@/lib/kdp-sales/normalize';
import { messages } from '@/lib/messages';

const m = messages.settings;
const mk = m.sections.kenpRate;

export function KenpRateSettings({ initialRate }: { initialRate: number | null }) {
  const [value, setValue] = useState(initialRate == null ? '' : String(initialRate));
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      const rate = trimmed === '' ? null : Number(trimmed);
      if (rate !== null && (!Number.isFinite(rate) || !isPlausibleKenpRate(rate))) {
        setError(mk.errorRange);
        return;
      }
      setError(null);
      setIsPending(true);
      setFeedback(null);
      const result = await updateSettings({ kenp_rate_jpy_per_page: rate });
      setIsPending(false);
      setFeedback(result.ok ? { ok: true, msg: m.saveSuccess } : { ok: false, msg: result.error.message });
    },
    [value],
  );

  return (
    <section
      aria-labelledby="kenp-rate-heading"
      className="rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="kenp-rate-settings"
    >
      <div className="mb-space-snug">
        <h2 id="kenp-rate-heading" className="text-section-title text-foreground">
          {mk.title}
        </h2>
        <p className="text-body text-muted">{mk.subtitle}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-space-snug">
        <label className="flex flex-col gap-2">
          <span className="text-body font-medium text-charcoal">{mk.label}</span>
          <input
            type="text"
            inputMode="decimal"
            value={value}
            placeholder={mk.placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setFeedback(null);
              setError(null);
            }}
            data-testid="kenp-rate-input"
            className="w-40 rounded-default border border-border-warm bg-white px-3 py-2 text-body tabular-nums"
          />
        </label>
        {error && (
          <p role="alert" className="text-button-sm text-destructive" data-testid="kenp-rate-error">
            {error}
          </p>
        )}
        <div className="flex items-start gap-2 rounded-default border border-border-warm bg-cream-light px-3 py-2">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="text-button-sm text-muted">{mk.hint}</p>
        </div>
        <div className="flex items-center gap-space-snug pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-default bg-foreground px-4 py-2 text-button-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? m.saving : m.saveButton}
          </button>
          {feedback && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-1 text-button-sm ${feedback.ok ? 'text-green-700' : 'text-destructive'}`}
            >
              {feedback.ok ? (
                <CheckCircle aria-hidden="true" className="h-4 w-4" />
              ) : (
                <XCircle aria-hidden="true" className="h-4 w-4" />
              )}
              {feedback.msg}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
