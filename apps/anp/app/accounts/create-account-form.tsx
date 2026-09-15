'use client';

import { useRef, useState, useTransition } from 'react';

import { createAccount } from '@/app/actions/accounts';
import { messages } from '@/lib/messages';

export function CreateAccountForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className="mt-space-snug grid grid-cols-1 gap-space-snug sm:grid-cols-2"
      action={(formData: FormData) => {
        setError(null);
        startTransition(async () => {
          const result = await createAccount({
            niche: formData.get('niche'),
            display_name: formData.get('display_name'),
            target_reader: formData.get('target_reader') || undefined,
            tone: formData.get('tone') || undefined,
            free_ratio: formData.get('free_ratio') || undefined,
            price_min: formData.get('price_min') || undefined,
            price_max: formData.get('price_max') || undefined,
            membership: formData.get('membership') === 'on',
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          formRef.current?.reset();
        });
      }}
    >
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {messages.accounts.form.niche}
        <input name="niche" required maxLength={200} className="rounded-card border border-border-warm px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {messages.accounts.form.displayName}
        <input
          name="display_name"
          required
          maxLength={100}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {messages.accounts.form.targetReader}
        <input name="target_reader" maxLength={300} className="rounded-card border border-border-warm px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {messages.accounts.form.tone}
        <input name="tone" maxLength={200} className="rounded-card border border-border-warm px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {messages.accounts.form.freeRatio}
        <input
          name="free_ratio"
          type="number"
          step="0.05"
          min="0.05"
          max="0.95"
          defaultValue="0.3"
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-space-snug">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {messages.accounts.form.priceMin}
          <input
            name="price_min"
            type="number"
            min="0"
            defaultValue="100"
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {messages.accounts.form.priceMax}
          <input
            name="price_max"
            type="number"
            min="0"
            defaultValue="1000"
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-body text-charcoal">
        <input name="membership" type="checkbox" />
        {messages.accounts.form.membership}
      </label>

      <div className="sm:col-span-2">
        {error && <p className="mb-2 text-body text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
        >
          {isPending ? '作成中…' : messages.accounts.form.submit}
        </button>
      </div>
    </form>
  );
}
