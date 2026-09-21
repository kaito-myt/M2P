'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { regenerateDesignWithFeedback } from '@/app/actions/account-design';
import { messages } from '@/lib/messages';

const dm = messages.accountDesign.detail;

export function FeedbackForm({ designId, hrefFor }: { designId: string; hrefFor?: (designId: string) => string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await regenerateDesignWithFeedback({ design_id: designId, feedback });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(hrefFor ? hrefFor(result.data.id) : `/accounts/design/${result.data.id}`);
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-space-snug flex flex-col gap-space-snug">
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={dm.feedbackPlaceholder}
        rows={3}
        maxLength={2000}
        disabled={isPending}
        className="rounded-card border border-border-warm px-3 py-2"
      />
      <div>
        <button
          type="submit"
          disabled={isPending || feedback.trim().length === 0}
          className="rounded-card border border-border-warm bg-cream-light px-4 py-2 text-button-sm text-charcoal disabled:opacity-50"
        >
          {dm.feedbackSubmit}
        </button>
      </div>
      {error && <p className="text-caption text-red-600">{error}</p>}
    </form>
  );
}
