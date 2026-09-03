'use client';

/**
 * BwChecklistClient — BOOK☆WALKER 入稿一覧 + キュー登録操作 (F-094)。
 *
 * 一冊ずつ/一括で `Book.bw_publish_queued` を登録・取消する。実際の申請は
 * サーバーの bw.submit.dispatch → bw.submit が行う。
 */
import { useCallback, useState, useTransition } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';

import { queueToBw, unqueueFromBw } from '@/app/actions/bw-submit';
import { messages } from '@/lib/messages';

const m = messages.bwChecklist;

export interface BwChecklistBook {
  id: string;
  title: string;
  subtitle: string | null;
  penName: string | null;
  bwPublishStatus: string;
  bwPublishQueued: boolean;
  bwSubmittedAt: string | null;
  metadataMissing: boolean;
  hasBlockingComments: boolean;
}

interface BwChecklistClientProps {
  books: BwChecklistBook[];
}

export function BwChecklistClient({ books }: BwChecklistClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const run = useCallback((bookIds: string[], mode: 'queue' | 'unqueue') => {
    setFeedback(null);
    startTransition(async () => {
      const result =
        mode === 'queue'
          ? await queueToBw({ book_ids: bookIds })
          : await unqueueFromBw({ book_ids: bookIds });
      if (!result.ok) {
        setFeedback({ ok: false, msg: result.error.message });
        return;
      }
      if (mode === 'queue') {
        const data = result.data as { queued: unknown[]; blocked: Array<{ reason: string }> };
        const blockedNote =
          data.blocked.length > 0 ? ` (${data.blocked.length} 冊は登録不可: ${data.blocked[0]!.reason})` : '';
        setFeedback({ ok: true, msg: `${data.queued.length} 冊を${m.queueSuccess}${blockedNote}` });
      } else {
        setFeedback({ ok: true, msg: m.unqueueSuccess });
      }
    });
  }, []);

  const readyIds = books
    .filter(
      (b) =>
        !b.bwPublishQueued &&
        !b.metadataMissing &&
        !b.hasBlockingComments &&
        b.bwPublishStatus !== 'submitted' &&
        b.bwPublishStatus !== 'published',
    )
    .map((b) => b.id);

  const statusBadge = (b: BwChecklistBook) => {
    const label = m.statusLabels[b.bwPublishStatus] ?? b.bwPublishStatus;
    const cls =
      b.bwPublishStatus === 'submitted'
        ? 'bg-foreground/10 text-foreground'
        : b.bwPublishStatus === 'published'
          ? 'bg-green-100 text-green-800'
          : b.bwPublishStatus === 'failed'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-charcoal-04 text-muted';
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-button-sm ${cls}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-space-relaxed" data-testid="bw-checklist-list">
      <div className="flex items-center justify-between gap-space-snug">
        <p className="text-button-sm text-muted">{m.listCaption}</p>
        <button
          type="button"
          disabled={isPending || readyIds.length === 0}
          onClick={() => run(readyIds, 'queue')}
          className="shrink-0 rounded-default bg-foreground px-4 py-2 text-button-sm font-medium text-white disabled:opacity-50"
          data-testid="bw-bulk-queue"
        >
          {m.bulkQueueButton(readyIds.length)}
        </button>
      </div>

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

      <ul className="divide-y divide-border-warm rounded-card border border-border-warm bg-cream-light">
        {books.map((b) => {
          const isTerminal = b.bwPublishStatus === 'submitted' || b.bwPublishStatus === 'published';
          const blocked = b.metadataMissing || b.hasBlockingComments;
          return (
            <li key={b.id} className="flex items-center gap-space-snug px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">{b.title}</p>
                <p className="truncate text-button-sm text-muted">
                  {b.penName ?? '—'}
                  {b.subtitle ? ` ｜ ${b.subtitle}` : ''}
                  {b.bwSubmittedAt
                    ? ` ｜ 申請 ${new Date(b.bwSubmittedAt).toLocaleDateString('ja-JP')}`
                    : ''}
                </p>
              </div>
              {statusBadge(b)}
              {b.bwPublishQueued && !isTerminal && (
                <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-button-sm text-foreground">
                  {m.queuedBadge}
                </span>
              )}
              {!isTerminal &&
                (b.bwPublishQueued ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run([b.id], 'unqueue')}
                    className="shrink-0 rounded-default border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
                  >
                    {m.unqueueButton}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isPending || blocked}
                    title={
                      b.hasBlockingComments
                        ? messages.bwSubmit.blockedReasons.hasBlockingComments
                        : b.metadataMissing
                          ? messages.bwSubmit.blockedReasons.metadataMissing
                          : undefined
                    }
                    onClick={() => run([b.id], 'queue')}
                    className="shrink-0 rounded-default border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
                  >
                    {m.queueButton}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
