'use client';

/**
 * 禁止語リスト (R-2) の編集。1 行 1 語の textarea。保存時にサーバ側で
 * `parseDenylist()` が正規化 (trim / 空行除去 / 重複除去) してから
 * `app_settings.tdp_derivative_denylist` に入る。
 *
 * 保存後はサーバが返した正規化済みリストで textarea を置き換える —
 * 「自分が書いたものと保存されたものが違う」状態を残さない。
 */
import { useState, useTransition } from 'react';

import { updateDerivativeDenylist } from '@/app/actions/settings';
import { messages } from '@/lib/messages';
import { formatDenylist } from '@/lib/settings-core';

const m = messages.settings;

export function DenylistForm({ initialTerms }: { initialTerms: string[] }) {
  const [text, setText] = useState(formatDenylist(initialTerms));
  const [savedText, setSavedText] = useState(formatDenylist(initialTerms));
  const [count, setCount] = useState(initialTerms.length);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dirty = text !== savedText;

  const save = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateDerivativeDenylist(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const normalized = formatDenylist(result.data);
      setText(normalized);
      setSavedText(normalized);
      setCount(result.data.length);
      setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-space-snug" data-testid="tdp-denylist-form">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-muted">{m.denylistLabel}</span>
        <textarea
          value={text}
          rows={8}
          disabled={isPending}
          placeholder={m.denylistPlaceholder}
          onChange={(e) => setText(e.target.value)}
          className="w-full max-w-xl rounded-default border border-border-warm bg-cream-light px-3 py-2 font-mono text-button-sm leading-relaxed text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid="tdp-denylist-input"
        />
      </label>

      <div className="flex flex-wrap items-center gap-space-snug">
        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="tdp-denylist-save"
        >
          {isPending ? '保存中…' : messages.common.save}
        </button>
        <span className="text-caption text-muted" data-testid="tdp-denylist-count">
          {count > 0 ? `${m.denylistCountPrefix} ${count} ${m.denylistCountSuffix}` : m.denylistEmpty}
        </span>
      </div>

      {saved && !error && <p className="text-caption text-muted">{messages.common.saved}</p>}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
