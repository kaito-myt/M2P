'use client';

import { useRef, useState, useTransition } from 'react';

import { createAccountDesign } from '@/app/actions/account-design';
import { messages } from '@/lib/messages';

const m = messages.accountDesign.briefForm;

export function BriefForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className="mt-space-snug flex flex-col gap-space-snug"
      action={(formData: FormData) => {
        setError(null);
        startTransition(async () => {
          const result = await createAccountDesign({
            idea: formData.get('idea'),
            goal: formData.get('goal') || undefined,
            target_reader_hint: formData.get('target_reader_hint') || undefined,
            monetization_hint: formData.get('monetization_hint') || undefined,
            constraints: formData.get('constraints') || undefined,
            persona_type: formData.get('persona_type') || 'auto',
            reference_accounts: formData.get('reference_accounts') || undefined,
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
        {m.idea}
        <textarea
          name="idea"
          required
          maxLength={2000}
          rows={2}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-1 gap-space-snug sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {m.goal}
          <input name="goal" maxLength={1000} className="rounded-card border border-border-warm px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {m.targetReaderHint}
          <input
            name="target_reader_hint"
            maxLength={500}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {m.monetizationHint}
          <input
            name="monetization_hint"
            maxLength={500}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-body text-charcoal">
          {m.constraints}
          <input
            name="constraints"
            maxLength={1000}
            className="rounded-card border border-border-warm px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {m.personaType}
        <select name="persona_type" defaultValue="auto" className="rounded-card border border-border-warm px-3 py-2">
          <option value="auto">{m.personaTypeOptions.auto}</option>
          <option value="person">{m.personaTypeOptions.person}</option>
          <option value="brand">{m.personaTypeOptions.brand}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-body text-charcoal">
        {m.referenceAccounts}
        <textarea
          name="reference_accounts"
          maxLength={3000}
          rows={3}
          className="rounded-card border border-border-warm px-3 py-2"
        />
      </label>

      <div>
        {error && <p className="mb-2 text-body text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
        >
          {isPending ? m.submitting : m.submit}
        </button>
      </div>
    </form>
  );
}
