'use client';

/**
 * 月間出品上限 (R-1) の編集。入力して「保存」で `app_settings.tdp_monthly_publish_limit` を更新する。
 *
 * 残枠 (`remaining`) はサーバ側で `canListMore()`
 * (packages/contracts/src/tdp/derivative-guard.ts) を通した値を受け取る —
 * 判定ロジックを UI 側に複製しない。保存直後だけは体感のため同じ式で再計算する。
 */
import { useState, useTransition } from 'react';

import { updateMonthlyPublishLimit } from '@/app/actions/settings';
import { messages } from '@/lib/messages';
import { MONTHLY_LIMIT_MAX, MONTHLY_LIMIT_MIN } from '@/lib/settings-core';

const m = messages.settings;

export function LimitForm({
  initialLimit,
  listedThisMonth,
  remaining,
}: {
  initialLimit: number;
  listedThisMonth: number;
  remaining: number;
}) {
  const [limit, setLimit] = useState(String(initialLimit));
  const [savedLimit, setSavedLimit] = useState(initialLimit);
  const [savedRemaining, setSavedRemaining] = useState(remaining);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty = limit.trim() !== String(savedLimit);

  const save = () => {
    setError(null);
    setSaved(false);
    const next = Number(limit);
    startTransition(async () => {
      const result = await updateMonthlyPublishLimit(next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSavedLimit(result.data);
      setSavedRemaining(Math.max(0, result.data - listedThisMonth));
      setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-space-snug" data-testid="tdp-limit-form">
      <div className="flex flex-wrap items-end gap-space-snug">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{m.limitLabel}</span>
          <input
            type="number"
            min={MONTHLY_LIMIT_MIN}
            max={MONTHLY_LIMIT_MAX}
            value={limit}
            disabled={isPending}
            onChange={(e) => setLimit(e.target.value)}
            className="w-24 rounded-default border border-border-warm bg-cream-light px-2.5 py-1.5 text-right text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            data-testid="tdp-limit-input"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="tdp-limit-save"
        >
          {isPending ? '保存中…' : messages.common.save}
        </button>
      </div>

      <p className="text-caption text-muted" data-testid="tdp-limit-remaining">
        {m.limitListedPrefix} {listedThisMonth} / {savedLimit}
        {' — '}
        {savedRemaining > 0 ? (
          <>
            {m.limitRemainingPrefix} <span className="font-medium text-charcoal">{savedRemaining}</span>{' '}
            {m.limitRemainingSuffix}
          </>
        ) : (
          <span className="font-medium text-accent">{m.limitExhausted}</span>
        )}
      </p>

      {saved && !error && <p className="text-caption text-muted">{messages.common.saved}</p>}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
