'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { startConsultation } from '@/app/actions/account-consult';
import { messages } from '@/lib/messages';

const cm = messages.accountConsult.start;

export function StartConsultForm() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    if (text.trim().length === 0 || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await startConsultation({ message: text });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/accounts/design/consult/${result.data.id}`);
    });
  };

  return (
    <form
      className="mt-space-snug flex flex-col gap-space-snug"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={cm.placeholder}
        rows={3}
        maxLength={4000}
        disabled={isPending}
        className="rounded-card border border-border-warm px-3 py-2 text-body"
        data-testid="consult-start-input"
      />
      <div className="flex flex-wrap gap-2">
        {cm.examples.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setText(ex)}
            disabled={isPending}
            className="rounded-pill border border-border-warm bg-white px-3 py-1 text-caption text-charcoal-82 hover:bg-charcoal-04 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
      <div>
        {error && <p className="mb-2 text-body text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isPending || text.trim().length === 0}
          className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
          data-testid="consult-start-submit"
        >
          {isPending ? cm.submitting : cm.submit}
        </button>
      </div>
    </form>
  );
}
