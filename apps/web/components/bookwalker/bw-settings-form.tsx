'use client';

/**
 * BwSettingsForm — BOOK☆WALKER 自動入稿設定セクション (F-094)。
 *
 * `bw_auto_submit_enabled` / `bw_submit_dry_run` を updateSettings SA 経由で保存する。
 * dispatcher の cron は起動時に enabled で条件付き登録されるため、ON/OFF 変更は
 * ワーカー再起動後に反映される。セッション未保存時はその旨を警告表示する。
 */
import { useCallback, useState } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';

import { updateSettings } from '@/app/actions/settings';
import { messages } from '@/lib/messages';

const m = messages.settings;
const ms = messages.bwChecklist.settings;

interface BwSettingsFormProps {
  initialData: {
    bw_auto_submit_enabled: boolean;
    bw_submit_dry_run: boolean;
    session_saved: boolean;
  };
}

export function BwSettingsForm({ initialData }: BwSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialData.bw_auto_submit_enabled);
  const [dryRun, setDryRun] = useState(initialData.bw_submit_dry_run);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFeedback(null);
      setIsPending(true);
      const result = await updateSettings({
        bw_auto_submit_enabled: enabled,
        bw_submit_dry_run: dryRun,
      });
      setIsPending(false);
      if (result.ok) {
        setFeedback({ ok: true, msg: m.saveSuccess });
      } else {
        setFeedback({ ok: false, msg: result.error.message });
      }
    },
    [enabled, dryRun],
  );

  function Toggle({
    checked,
    onToggle,
    label,
    testId,
  }: {
    checked: boolean;
    onToggle: () => void;
    label: string;
    testId: string;
  }) {
    return (
      <label className="flex cursor-pointer items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          data-testid={testId}
          onClick={() => {
            onToggle();
            setFeedback(null);
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
            checked ? 'bg-foreground' : 'bg-border-warm'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
        <span className="text-body text-charcoal">{label}</span>
      </label>
    );
  }

  return (
    <section
      aria-labelledby="bw-settings-heading"
      className="rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="bw-settings-form"
    >
      <div className="mb-space-snug">
        <h2 id="bw-settings-heading" className="text-section-title text-foreground">
          {ms.title}
        </h2>
        <p className="text-body text-muted">{ms.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-space-loose">
        <div className="flex flex-col gap-2">
          <Toggle
            checked={enabled}
            onToggle={() => setEnabled((v) => !v)}
            label={ms.enabledLabel}
            testId="bw-auto-submit-toggle"
          />
          <p className="text-button-sm text-muted">{ms.enabledHint}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Toggle
            checked={dryRun}
            onToggle={() => setDryRun((v) => !v)}
            label={ms.dryRunLabel}
            testId="bw-dry-run-toggle"
          />
          <p className="text-button-sm text-muted">{ms.dryRunHint}</p>
        </div>

        {/* セッション状態 */}
        <div
          className={`flex items-start gap-2 rounded-default border px-3 py-2 ${
            initialData.session_saved
              ? 'border-border-warm bg-cream-light'
              : 'border-warning/40 bg-warning/10'
          }`}
          data-testid="bw-session-status"
        >
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="text-button-sm text-charcoal">
            {initialData.session_saved ? ms.sessionSavedNoDate : ms.sessionMissing}
          </p>
        </div>

        <div className="flex items-center gap-space-snug pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-default bg-foreground px-4 py-2 text-button-sm font-medium text-white disabled:opacity-50"
          >
            {isPending ? m.saving : m.saveButton}
          </button>
          {feedback && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-1 text-button-sm ${feedback.ok ? 'text-green-700' : 'text-destructive'}`}
            >
              {feedback.ok ? (
                <CheckCircle aria-hidden="true" className="h-4 w-4" />
              ) : (
                <XCircle aria-hidden="true" className="h-4 w-4" />
              )}
              {feedback.msg}
            </div>
          )}
        </div>
      </form>
    </section>
  );
}
