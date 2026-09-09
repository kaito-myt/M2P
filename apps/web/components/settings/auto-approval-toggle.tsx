'use client';

/**
 * AutoApprovalToggle — S-027 設定画面 プロンプト自動承認セクション (T-07-09 / SP-11 F-030).
 *
 * `app_settings.prompt_auto_approval_enabled` と `prompt_auto_approval_rollback_h` を
 * 既存 updateSettings SA 経由で保存する実機能トグル。
 * バックエンド (`apps/worker/src/lib/auto-approval.ts` checkAutoApproval) はこのフラグを
 * 参照済みで、ON にすると「直近 5 冊で評価スコアが連続改善」した改訂案を自動採用する。
 */
import { useCallback, useState } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';

import { updateSettings } from '@/app/actions/settings';
import { messages } from '@/lib/messages';

const m = messages.settings;
const ms = m.sections.autoApproval;

interface AutoApprovalToggleProps {
  initialEnabled: boolean;
  initialRollbackHours: number;
}

export function AutoApprovalToggle({
  initialEnabled,
  initialRollbackHours,
}: AutoApprovalToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [rollbackHours, setRollbackHours] = useState(String(initialRollbackHours));
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setFeedback(null);

      const hours = Number(rollbackHours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
        setError('ロールバック猶予時間は 1〜168 の整数で指定してください');
        return;
      }

      setIsPending(true);
      const result = await updateSettings({
        prompt_auto_approval_enabled: enabled,
        prompt_auto_approval_rollback_h: hours,
      });
      setIsPending(false);

      if (result.ok) {
        setFeedback({ ok: true, msg: m.saveSuccess });
      } else {
        setFeedback({ ok: false, msg: result.error.message });
      }
    },
    [enabled, rollbackHours],
  );

  return (
    <section
      aria-labelledby="auto-approval-heading"
      className="rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="auto-approval-toggle"
    >
      <div className="mb-space-snug">
        <h2 id="auto-approval-heading" className="text-section-title text-foreground">
          {ms.title}
        </h2>
        <p className="text-body text-muted">{ms.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-space-loose">
        {/* Toggle */}
        <div className="flex flex-col gap-2">
          <label className="flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={ms.enabledLabel}
              data-testid="auto-approval-switch"
              onClick={() => {
                setEnabled((v) => !v);
                setFeedback(null);
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                enabled ? 'bg-foreground' : 'bg-border-warm'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-body text-charcoal">{ms.enabledLabel}</span>
          </label>
          <p className="text-button-sm text-muted">{ms.enabledHint}</p>
        </div>

        {/* Rollback hours */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="auto-approval-rollback-hours"
            className={`text-body font-medium ${enabled ? 'text-charcoal' : 'text-muted'}`}
          >
            {ms.rollbackHoursLabel}
          </label>
          <input
            id="auto-approval-rollback-hours"
            type="number"
            min={1}
            max={168}
            step={1}
            value={rollbackHours}
            disabled={!enabled}
            onChange={(e) => {
              setRollbackHours(e.target.value);
              setFeedback(null);
            }}
            data-testid="auto-approval-rollback-hours"
            className="w-40 rounded-default border border-border-warm bg-cream-light px-3 py-2 text-button-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <p className="text-button-sm text-muted">{ms.rollbackHoursHint}</p>
          {error && (
            <p role="alert" className="text-button-sm text-destructive" data-testid="auto-approval-error">
              {error}
            </p>
          )}
        </div>

        {/* How it works note */}
        <div className="flex items-start gap-2 rounded-default border border-border-warm bg-cream-light px-3 py-2">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="text-button-sm text-muted">
            自動採用された改訂は「プロンプト改訂承認」画面から猶予時間内にロールバックできます。
          </p>
        </div>

        {/* Submit */}
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
