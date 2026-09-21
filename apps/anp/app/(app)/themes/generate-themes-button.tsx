'use client';

/**
 * GenerateThemesButton — 選択中アカウントのテーマ候補を 5 件生成 (note.theme.generate)。
 * 生成は非同期なので、起動後は数十秒後にページを再読込 (router.refresh) して結果を出す。
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { generateThemes } from '@/app/actions/themes';
import { messages } from '@/lib/messages';

const REFRESH_AFTER_MS = 45_000;
const m = messages.themes;

export function GenerateThemesButton({ noteAccountId, accountName, disabled }: { noteAccountId: string; accountName: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (startedAt === null) return;
    const t = setTimeout(() => {
      router.refresh();
      setStartedAt(null);
    }, REFRESH_AFTER_MS);
    return () => clearTimeout(t);
  }, [startedAt, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isPending || disabled || startedAt !== null}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateThemes({ note_account_id: noteAccountId, count: 5 });
            if (!result.ok) setError(result.error);
            else setStartedAt(Date.now());
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-card border border-border-warm bg-charcoal px-4 py-2 text-button-sm text-white disabled:opacity-50"
        data-testid="themes-generate"
      >
        {isPending || startedAt !== null ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
        {startedAt !== null ? m.generating : m.generateFor(accountName)}
      </button>
      {disabled && <p className="text-caption text-muted">{m.generateDisabled}</p>}
      {startedAt !== null && <p className="text-caption text-muted">{m.generatingHint}</p>}
      {error && (
        <p role="alert" className="text-caption text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
