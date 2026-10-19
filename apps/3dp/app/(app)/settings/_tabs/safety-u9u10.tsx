'use client';

/**
 * U-9 / U-10 回答欄 (F-3DP-42)。検証はサーバーの `validateU9U10`。ここは入力を集めて `recordU9U10` に渡すだけ。
 * 読めない状態 (readOnly) では保存させない: 空の値で既存の回答を消さないため。
 */
import { useState, useTransition } from 'react';

import { recordU9U10 } from '@/app/actions/settings';
import { messages } from '@/lib/messages';
import { refusalMessage } from '@/lib/settings-tabs-core';
import type { U10Answer, U9Answer } from '@/lib/tdp-settings';
import { buildU9U10Input, draftFromAnswers, formatAnsweredAt, type U9U10Draft } from '@/lib/u9u10-core';

const m = messages.settings.u9u10;
const inputClass =
  'w-28 rounded-default border border-border-warm bg-cream-light px-2.5 py-1.5 text-right text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function Status({ answered, at, testId }: { answered: boolean; at: string | null; testId: string }) {
  return (
    <p className="text-caption text-muted" data-testid={testId} data-state={answered ? 'answered' : 'unanswered'}>
      <span className={answered ? 'font-medium text-charcoal-82' : 'font-medium text-destructive'}>
        {answered ? m.statusAnswered : m.statusUnanswered}
      </span>
      {answered && at && <span> / {m.answeredAt(at)}</span>}
    </p>
  );
}

export function SafetyU9U10({
  u9: initialU9,
  u10: initialU10,
  readOnly,
}: {
  u9: U9Answer | null;
  u10: U10Answer | null;
  readOnly: boolean;
}) {
  const [u9, setU9] = useState(initialU9);
  const [u10, setU10] = useState(initialU10);
  const [saved, setSaved] = useState<U9U10Draft>(draftFromAnswers(initialU9, initialU10));
  const [draft, setDraft] = useState<U9U10Draft>(saved);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const input = buildU9U10Input(draft, saved);
  const complete = u9 !== null && u10 !== null;
  const set = (patch: Partial<U9U10Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    if (!input) return;
    setError(null);
    setDone(false);
    startTransition(async () => {
      const r = await recordU9U10(input);
      if (!r.ok) {
        setError(refusalMessage(r.refusals, r.error));
        return;
      }
      setU9(r.data.u9);
      setU10(r.data.u10);
      const next = draftFromAnswers(r.data.u9, r.data.u10);
      setSaved(next);
      setDraft(next);
      setDone(true);
    });
  };

  const disabled = readOnly || isPending;

  return (
    <div className="flex flex-col gap-space-relaxed" data-testid="tdp-u9u10" data-state={complete ? 'answered' : 'unanswered'}>
      <div>
        <p className="text-button-sm font-medium text-charcoal" data-testid="tdp-u9u10-required">
          {m.required}
        </p>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.requiredDetail}</p>
        <p className={complete ? 'mt-1 text-caption text-muted' : 'mt-1 text-caption text-destructive'} data-testid="tdp-u9u10-summary">
          {complete ? m.statusDone : m.statusPending}
        </p>
      </div>

      <fieldset className="flex flex-col gap-space-snug border-t border-border-warm pt-space-relaxed" disabled={disabled}>
        <legend className="text-button-sm text-charcoal">{m.u9Label}</legend>
        <p className="max-w-2xl text-caption text-muted">{m.u9Hint}</p>
        <Status answered={u9 !== null} at={u9 ? formatAnsweredAt(u9.answered_at) : null} testId="tdp-u9-status" />
        <div className="flex gap-space-relaxed">
          {(['yes', 'no'] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-body text-charcoal">
              <input
                type="radio"
                name="u9-shares"
                value={v}
                checked={draft.shares === v}
                onChange={() => set({ shares: v })}
                data-testid={`tdp-u9-${v}`}
              />
              {v === 'yes' ? m.yes : m.no}
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{m.noteLabel}</span>
          <textarea
            value={draft.note}
            rows={3}
            onChange={(e) => set({ note: e.target.value })}
            className="w-full max-w-xl rounded-default border border-border-warm bg-cream-light px-3 py-2 text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            data-testid="tdp-u9-note"
          />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-space-snug border-t border-border-warm pt-space-relaxed" disabled={disabled}>
        <legend className="text-button-sm text-charcoal">{m.u10Label}</legend>
        <p className="max-w-2xl text-caption text-muted">{m.u10Hint}</p>
        <Status answered={u10 !== null} at={u10 ? formatAnsweredAt(u10.answered_at) : null} testId="tdp-u10-status" />
        <label className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={draft.pct}
            onChange={(e) => set({ pct: e.target.value })}
            className={inputClass}
            aria-label={m.u10Label}
            data-testid="tdp-u10-pct"
          />
          <span className="text-caption text-muted">{m.pctUnit}</span>
        </label>
        {u10 !== null && (
          <div data-testid="tdp-u10-result">
            <p className="text-body text-charcoal">
              {m.pctValue(u10.booth_share_pct)}
              {u10.booth_share_pct === 0 && <span className="text-caption text-muted"> ({m.pctZeroNote})</span>}
            </p>
            <p className="mt-1 max-w-2xl text-caption text-muted" data-testid="tdp-u10-advice">
              {m.advice}
            </p>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-space-snug">
        <button
          type="button"
          onClick={save}
          disabled={disabled || input === null}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="tdp-u9u10-save"
        >
          {isPending ? m.saving : m.save}
        </button>
        <span className="text-caption text-muted">{m.overwriteNote}</span>
        {done && !error && <span className="text-caption text-muted">{m.saved}</span>}
      </div>
      {error && (
        <p role="alert" className="whitespace-pre-line text-caption text-destructive" data-testid="tdp-u9u10-error">
          {error}
        </p>
      )}
    </div>
  );
}
