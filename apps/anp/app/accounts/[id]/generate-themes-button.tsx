'use client';

import { useState, useTransition } from 'react';

import { generateThemes } from '@/app/actions/themes';
import { messages } from '@/lib/messages';

export function GenerateThemesButton({ noteAccountId }: { noteAccountId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateThemes({ note_account_id: noteAccountId, count: 5 });
            if (!result.ok) setError(result.error);
          });
        }}
        className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
      >
        {isPending ? messages.accountDetail.generateThemesRunning : messages.accountDetail.generateThemes}
      </button>
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  );
}
