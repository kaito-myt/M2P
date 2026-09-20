'use client';

import { useState, useTransition } from 'react';

import { updateAccountHandle } from '@/app/actions/accounts';
import { messages } from '@/lib/messages';

/** `note_accounts.handle` の編集フォーム (docs/11 §7 申し送り13)。 */
export function HandleForm({ noteAccountId, initialHandle }: { noteAccountId: string; initialHandle: string | null }) {
  const [value, setValue] = useState(initialHandle ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAccountHandle({ note_account_id: noteAccountId, handle: value });
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  };

  return (
    <form onSubmit={submit} className="mt-1 flex flex-wrap items-center gap-2">
      <label className="text-caption text-muted" htmlFor="note-handle">
        {messages.accounts.handleLabel}
      </label>
      <span className="text-caption text-muted">note.com/</span>
      <input
        id="note-handle"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={messages.accounts.handlePlaceholder}
        disabled={isPending}
        className="w-40 rounded-card border border-border-warm bg-white px-2 py-1 text-body text-charcoal disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-card border border-border-warm bg-cream-light px-3 py-1 text-button-sm text-charcoal disabled:opacity-50"
      >
        {messages.common.save}
      </button>
      {saved && !error && <span className="text-caption text-muted">{messages.settings.saved}</span>}
      {error && <span className="text-caption text-red-600">{error}</span>}
    </form>
  );
}
