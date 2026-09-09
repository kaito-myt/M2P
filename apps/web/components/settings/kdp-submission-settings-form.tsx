'use client';

/**
 * KdpSubmissionSettingsForm — S-027 設定画面 KDP 自動入稿設定セクション (T-07-09 / F-041 Phase3).
 *
 * `kdp_auto_submit_enabled`（マスター ON/OFF）/ `kdp_submit_dry_run`（ドライラン）/
 * `kdp_submit_timeout_minutes` / `kdp_submit_retry_count` を updateSettings SA 経由で保存する。
 * dispatcher の cron は起動時に enabled で条件付き登録されるため、ON/OFF 変更は
 * ワーカー再起動後に反映される（timeout/retry/dry_run は各 tick で DB を読むため即時反映）。
 * 日次作成上限で停止中のときは解除予定時刻を表示する。
 */
import { useCallback, useState } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';

import { updateSettings } from '@/app/actions/settings';
import { messages } from '@/lib/messages';

const m = messages.settings;
const ms = m.sections.kdpSubmission;

interface KdpSubmissionSettingsFormProps {
  initialData: {
    kdp_auto_submit_enabled: boolean;
    kdp_submit_dry_run: boolean;
    kdp_submit_timeout_minutes: number;
    kdp_submit_retry_count: number;
    kdp_creation_paused_until: string | null;
  };
}

export function KdpSubmissionSettingsForm({ initialData }: KdpSubmissionSettingsFormProps) {
  const [enabled, setEnabled] = useState(initialData.kdp_auto_submit_enabled);
  const [dryRun, setDryRun] = useState(initialData.kdp_submit_dry_run);
  const [timeout, setTimeoutMin] = useState(String(initialData.kdp_submit_timeout_minutes));
  const [retry, setRetry] = useState(String(initialData.kdp_submit_retry_count));
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const pausedUntil = initialData.kdp_creation_paused_until;
  const isPaused = pausedUntil != null && new Date(pausedUntil).getTime() > Date.now();

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setFeedback(null);

      const timeoutMin = Number(timeout);
      const retryCount = Number(retry);
      if (!Number.isInteger(timeoutMin) || timeoutMin < 1 || timeoutMin > 60) {
        setError('タイムアウトは 1〜60 分の整数で指定してください');
        return;
      }
      if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) {
        setError('リトライ回数は 0〜5 の整数で指定してください');
        return;
      }

      setIsPending(true);
      const result = await updateSettings({
        kdp_auto_submit_enabled: enabled,
        kdp_submit_dry_run: dryRun,
        kdp_submit_timeout_minutes: timeoutMin,
        kdp_submit_retry_count: retryCount,
      });
      setIsPending(false);

      if (result.ok) {
        setFeedback({ ok: true, msg: m.saveSuccess });
      } else {
        setFeedback({ ok: false, msg: result.error.message });
      }
    },
    [enabled, dryRun, timeout, retry],
  );

  const numberCls =
    'w-40 rounded-default border border-border-warm bg-cream-light px-3 py-2 text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
      aria-labelledby="kdp-submission-heading"
      className="rounded-card border border-border-warm bg-cream-light p-space-loose"
      data-testid="kdp-submission-settings-form"
    >
      <div className="mb-space-snug">
        <h2 id="kdp-submission-heading" className="text-section-title text-foreground">
          {ms.title}
        </h2>
        <p className="text-body text-muted">{ms.subtitle}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-space-loose">
        {/* Master enable */}
        <div className="flex flex-col gap-2">
          <Toggle
            checked={enabled}
            onToggle={() => setEnabled((v) => !v)}
            label={ms.enabledLabel}
            testId="kdp-auto-submit-toggle"
          />
          <p className="text-button-sm text-muted">{ms.enabledHint}</p>
        </div>

        {/* Dry run */}
        <div className="flex flex-col gap-2">
          <Toggle
            checked={dryRun}
            onToggle={() => setDryRun((v) => !v)}
            label={ms.dryRunLabel}
            testId="kdp-dry-run-toggle"
          />
          <p className="text-button-sm text-muted">{ms.dryRunHint}</p>
        </div>

        {/* Numeric params */}
        <div className="flex flex-wrap gap-space-loose">
          <div className="flex flex-col gap-1">
            <label htmlFor="kdp-timeout" className="text-body font-medium text-charcoal">
              {ms.timeoutLabel}
            </label>
            <input
              id="kdp-timeout"
              type="number"
              min={1}
              max={60}
              step={1}
              value={timeout}
              onChange={(e) => {
                setTimeoutMin(e.target.value);
                setFeedback(null);
              }}
              data-testid="kdp-timeout"
              className={numberCls}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="kdp-retry" className="text-body font-medium text-charcoal">
              {ms.retryCountLabel}
            </label>
            <input
              id="kdp-retry"
              type="number"
              min={0}
              max={5}
              step={1}
              value={retry}
              onChange={(e) => {
                setRetry(e.target.value);
                setFeedback(null);
              }}
              data-testid="kdp-retry"
              className={numberCls}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-button-sm text-destructive" data-testid="kdp-submission-error">
            {error}
          </p>
        )}

        {/* Paused notice */}
        {isPaused && (
          <div
            className="flex items-start gap-2 rounded-default border border-warning/40 bg-warning/10 px-3 py-2"
            data-testid="kdp-paused-notice"
          >
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-button-sm text-charcoal">
              {ms.pausedNotice.replace(
                '{time}',
                new Date(pausedUntil!).toLocaleString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              )}
            </p>
          </div>
        )}

        {/* Worker restart note */}
        <div className="flex items-start gap-2 rounded-default border border-border-warm bg-cream-light px-3 py-2">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <p className="text-button-sm text-muted" data-testid="kdp-worker-restart-note">
            {ms.workerRestartNote}
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
