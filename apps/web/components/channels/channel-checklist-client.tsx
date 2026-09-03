'use client';

/**
 * ChannelChecklistClient — 楽天Kobo / BOOTH 入稿一覧 + キュー登録操作 (F-095/F-096)。
 *
 * BwChecklistClient と同型のチャネル汎用版。自動入稿エンジンは後続実装のため、
 * キュー登録のみ先行して受け付ける。
 */
import { useCallback, useState, useTransition } from 'react';
import { CheckCircle, Info, XCircle } from 'lucide-react';

import { queueToChannel, unqueueFromChannel } from '@/app/actions/channel-submit';
import { messages } from '@/lib/messages';

const mc = messages.channelChecklist.common;

export interface ChannelBook {
  id: string;
  title: string;
  subtitle: string | null;
  penName: string | null;
  channelStatus: string;
  channelQueued: boolean;
  metadataMissing: boolean;
  hasBlockingComments: boolean;
}

interface ChannelChecklistClientProps {
  channel: 'kobo' | 'booth';
  engineNote: string;
  books: ChannelBook[];
}

export function ChannelChecklistClient({ channel, engineNote, books }: ChannelChecklistClientProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const run = useCallback(
    (bookIds: string[], mode: 'queue' | 'unqueue') => {
      setFeedback(null);
      startTransition(async () => {
        const result =
          mode === 'queue'
            ? await queueToChannel({ channel, book_ids: bookIds })
            : await unqueueFromChannel({ channel, book_ids: bookIds });
        if (!result.ok) {
          setFeedback({ ok: false, msg: result.error.message });
          return;
        }
        if (mode === 'queue') {
          const data = result.data as { queued: unknown[]; blocked: Array<{ reason: string }> };
          const blockedNote =
            data.blocked.length > 0
              ? ` (${data.blocked.length} 冊は登録不可: ${data.blocked[0]!.reason})`
              : '';
          setFeedback({ ok: true, msg: `${data.queued.length} 冊を${mc.queueSuccess}${blockedNote}` });
        } else {
          setFeedback({ ok: true, msg: mc.unqueueSuccess });
        }
      });
    },
    [channel],
  );

  const readyIds = books
    .filter(
      (b) =>
        !b.channelQueued &&
        !b.metadataMissing &&
        !b.hasBlockingComments &&
        b.channelStatus !== 'submitted' &&
        b.channelStatus !== 'published',
    )
    .map((b) => b.id);

  return (
    <div className="flex flex-col gap-space-relaxed" data-testid={`${channel}-checklist-list`}>
      <div className="flex items-start gap-2 rounded-default border border-border-warm bg-cream-light px-3 py-2">
        <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <p className="text-button-sm text-muted">{engineNote}</p>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={isPending || readyIds.length === 0}
          onClick={() => run(readyIds, 'queue')}
          className="shrink-0 rounded-default bg-foreground px-4 py-2 text-button-sm font-medium text-white disabled:opacity-50"
          data-testid={`${channel}-bulk-queue`}
        >
          {mc.bulkQueueButton(readyIds.length)}
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
          const isTerminal = b.channelStatus === 'submitted' || b.channelStatus === 'published';
          const blocked = b.metadataMissing || b.hasBlockingComments;
          const label = mc.statusLabels[b.channelStatus] ?? b.channelStatus;
          return (
            <li key={b.id} className="flex items-center gap-space-snug px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-foreground">{b.title}</p>
                <p className="truncate text-button-sm text-muted">
                  {b.penName ?? '—'}
                  {b.subtitle ? ` ｜ ${b.subtitle}` : ''}
                </p>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-button-sm ${
                  b.channelStatus === 'submitted'
                    ? 'bg-foreground/10 text-foreground'
                    : b.channelStatus === 'published'
                      ? 'bg-green-100 text-green-800'
                      : b.channelStatus === 'failed'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-charcoal-04 text-muted'
                }`}
              >
                {label}
              </span>
              {b.channelQueued && !isTerminal && (
                <span className="inline-flex items-center rounded-full bg-foreground/10 px-2 py-0.5 text-button-sm text-foreground">
                  {mc.queuedBadge}
                </span>
              )}
              {!isTerminal &&
                (b.channelQueued ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run([b.id], 'unqueue')}
                    className="shrink-0 rounded-default border border-border-warm bg-cream px-3 py-1.5 text-button-sm text-charcoal hover:bg-charcoal-04 disabled:opacity-50"
                  >
                    {mc.unqueueButton}
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
                    {mc.queueButton}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
