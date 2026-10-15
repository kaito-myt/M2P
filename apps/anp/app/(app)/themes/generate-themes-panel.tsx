'use client';

/**
 * GenerateThemesPanel — 選択中アカウントのテーマ候補を作る (F-ANP-10 / F-ANP-10b)。
 *
 * 2026-10-15 運営者要望「テーマ一覧のところで、人がテーマの指示を与えて作成できるようにして」
 * → ボタン 1 個だった UI に **AI への指示** と **件数** を足した。指示は worker 経由で
 * `anp.theme` のプロンプト**最後**に入り、アカウント既定より優先される
 * (`operatorInstructionLines` — 前方に置くと負ける、を 4 プロンプトで実証済み)。
 *
 * 併せて「45 秒待って再読込」だけだった待ち方を**ジョブの実状態のポーリング**に変えた。
 * 失敗しても運営者には何も起きなかったように見えていたため (同日のリサーチ失敗と同じ構図)。
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, Sparkles } from 'lucide-react';

import { generateThemes, getThemeJobState } from '@/app/actions/themes';
import { GenerationProgress } from '@/components/generation-progress';
import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';

const POLL_MS = 3000;
/** 5 件で 40〜70 秒。件数に比例させて残り時間の目安を出す。 */
const ESTIMATE_SEC_PER_THEME = 11;
const ESTIMATE_SEC_BASE = 20;
const COUNT_CHOICES = [1, 3, 5, 10] as const;

const m = messages.themes;

interface RunningJob {
  id: string;
  createdAt: string;
  count: number;
}

export function GenerateThemesPanel({
  noteAccountId,
  accountName,
  disabled,
}: {
  noteAccountId: string;
  accountName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [count, setCount] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<RunningJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // アカウントを切り替えたら前の実行の表示を持ち越さない。
  useEffect(() => {
    setJob(null);
    setError(null);
    setNotice(null);
  }, [noteAccountId]);

  const poll = useCallback(
    async (jobId: string) => {
      const res = await getThemeJobState({ job_id: jobId });
      if (!res.ok) return;
      if (res.data.status === 'done') {
        setJob(null);
        setNotice(m.generateDone(res.data.candidate_count ?? 0));
        router.refresh();
        return;
      }
      if (res.data.status === 'failed') {
        setJob(null);
        setError(res.data.error ?? m.generateFailed);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => void poll(job.id), POLL_MS);
    return () => clearInterval(t);
  }, [job, poll]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await generateThemes({
      note_account_id: noteAccountId,
      count,
      ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setJob({ id: res.data.job_id, createdAt: new Date().toISOString(), count });
  };

  const running = job !== null;

  return (
    <div className="flex w-full flex-col gap-space-snug sm:w-auto sm:min-w-[22rem]">
      <div className="flex flex-col items-stretch gap-1 sm:items-end">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex items-center justify-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
          disabled={disabled}
          data-testid="themes-generate-toggle"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {m.generateFor(accountName)}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
        {disabled && <p className="text-caption text-muted">{m.generateDisabled}</p>}
      </div>

      {open && !disabled && (
        <div className="rounded-container border border-border-warm bg-cream-light p-space-snug" data-testid="themes-generate-panel">
          <label className="block text-caption text-charcoal-82" htmlFor="theme-instruction">
            {m.instructionLabel}
          </label>
          <textarea
            id="theme-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={m.instructionPlaceholder}
            disabled={busy || running}
            className="mt-1 w-full rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60"
            data-testid="themes-instruction"
          />
          <p className="mt-1 text-caption text-muted">{m.instructionHint}</p>

          <div className="mt-space-snug flex flex-wrap items-end justify-between gap-space-snug">
            <div>
              <label className="block text-caption text-charcoal-82" htmlFor="theme-count">
                {m.countLabel}
              </label>
              <select
                id="theme-count"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                disabled={busy || running}
                className="mt-1 rounded-card border border-border-warm bg-white px-3 py-2 text-body text-charcoal disabled:opacity-60"
                data-testid="themes-count"
              >
                {COUNT_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {m.countOption(n)}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || running}
              className="inline-flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
              data-testid="themes-generate"
            >
              {busy || running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? m.generating : m.generateSubmit}
            </button>
          </div>

          {job && (
            <GenerationProgress
              className="mt-space-snug"
              startedAt={job.createdAt}
              estimateSec={ESTIMATE_SEC_BASE + job.count * ESTIMATE_SEC_PER_THEME}
              pct={null}
              stageLabel={m.progressStage}
            />
          )}
          {notice && (
            <p className="mt-space-snug text-caption text-charcoal" data-testid="themes-generate-notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-space-snug whitespace-pre-wrap break-words text-caption text-red-600" data-testid="themes-generate-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
