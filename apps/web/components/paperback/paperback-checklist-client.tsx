'use client';

/**
 * PaperbackChecklistClient — ペーパーバック化の一覧 + キュー操作 (F-097)。
 *
 * 実際の入稿・出版はローカルアシスト (`scripts/paperback/pb-auto.sh`) が行う。
 * ここではキューへの登録/取消と、各本の状態 (未対応/下書き/出版済み/失敗) を見せる。
 */
import { useCallback, useMemo, useState, useTransition } from 'react';

import { queuePaperback, unqueuePaperback } from '@/app/actions/paperback';
import { messages } from '@/lib/messages';

const m = messages.paperback;

export interface PaperbackBook {
  id: string;
  title: string;
  asin: string | null;
  penName: string | null;
  status: string;
  queued: boolean;
  titleId: string | null;
  draftedAt: string | null;
  submittedAt: string | null;
  lastError: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  unlisted: m.status.unlisted,
  drafted: m.status.drafted,
  submitted: m.status.submitted,
  published: m.status.published,
  failed: m.status.failed,
};

const STATUS_CLASS: Record<string, string> = {
  unlisted: 'border-border-warm bg-cream text-muted',
  drafted: 'border-border-warm bg-cream text-charcoal',
  submitted: 'border-border-warm bg-cream text-charcoal',
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function PaperbackChecklistClient({ books }: { books: PaperbackBook[] }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const pendingIds = useMemo(
    () => books.filter((b) => b.status !== 'published' && !b.queued).map((b) => b.id),
    [books],
  );

  const run = useCallback((bookIds: string[], mode: 'queue' | 'unqueue') => {
    if (bookIds.length === 0) return;
    setFeedback(null);
    startTransition(async () => {
      const result =
        mode === 'queue'
          ? await queuePaperback({ book_ids: bookIds })
          : await unqueuePaperback({ book_ids: bookIds });
      if (!result.ok) {
        setFeedback({ ok: false, msg: result.error.message });
        return;
      }
      setFeedback({
        ok: true,
        msg: mode === 'queue' ? m.queueSuccess(result.data.count) : m.unqueueSuccess(result.data.count),
      });
    });
  }, []);

  return (
    <div className="flex flex-col gap-space-snug" data-testid="paperback-checklist">
      <div className="flex flex-wrap items-center gap-space-snug">
        <button
          type="button"
          onClick={() => run(pendingIds, 'queue')}
          disabled={isPending || pendingIds.length === 0}
          className="inline-flex items-center rounded-card border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
          data-testid="paperback-queue-all"
        >
          {m.queueAll(pendingIds.length)}
        </button>
        {feedback ? (
          <span
            className={feedback.ok ? 'text-body-sm text-emerald-700' : 'text-body-sm text-rose-700'}
            role="status"
          >
            {feedback.msg}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col divide-y divide-border-warm border-y border-border-warm">
        {books.map((b) => (
          <li key={b.id} className="flex items-center gap-space-snug py-2" data-testid={`paperback-row-${b.id}`}>
            <span
              className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-button-sm ${STATUS_CLASS[b.status] ?? STATUS_CLASS.unlisted}`}
            >
              {STATUS_LABEL[b.status] ?? b.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-body-sm text-foreground" title={b.title}>
              {b.title}
            </span>
            {b.lastError ? (
              <span className="hidden max-w-80 truncate text-button-sm text-muted md:inline" title={b.lastError}>
                {b.lastError}
              </span>
            ) : null}
            {b.queued ? (
              <span className="shrink-0 text-button-sm text-charcoal">{m.queuedBadge}</span>
            ) : null}
            {b.status === 'published' ? null : (
              <button
                type="button"
                onClick={() => run([b.id], b.queued ? 'unqueue' : 'queue')}
                disabled={isPending}
                className="shrink-0 rounded-card border border-border-warm bg-cream px-2 py-1 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
              >
                {b.queued ? m.unqueue : m.queue}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
