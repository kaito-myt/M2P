'use client';

import { useState, useTransition } from 'react';

import { confirmSettingsGroup } from '@/app/actions/settings';
import { messages } from '@/lib/messages';
import type { SettingsGroup } from '@/lib/settings-groups-core';

const m = messages.settings.confirm;

/** 保存済みの値をグループ単位で確認済みにする。未保存の入力は含まれない。 */
export function ConfirmGroup({
  group,
  confirmedAt,
  disabled,
}: {
  group: SettingsGroup;
  confirmedAt: string | null;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const r = await confirmSettingsGroup({ group });
      if (!r.ok) setError(r.error);
      else setDone(true);
    });
  };

  return (
    <div className="flex flex-col gap-1" data-testid="tdp-confirm-group">
      <div className="flex flex-wrap items-center gap-space-snug">
        <button
          type="button"
          onClick={run}
          disabled={disabled || isPending}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="tdp-confirm-button"
        >
          {isPending ? m.pending : m.button}
        </button>
        <span className="text-caption text-muted" data-testid="tdp-confirmed-at">
          {confirmedAt ? m.doneAt(confirmedAt) : m.never}
        </span>
      </div>
      <p className="text-caption text-muted">{m.hint}</p>
      {done && !error && <p className="text-caption text-muted">{m.done}</p>}
      {error && (
        <p role="alert" className="whitespace-pre-line text-caption text-destructive" data-testid="tdp-confirm-error">
          {error}
        </p>
      )}
    </div>
  );
}
