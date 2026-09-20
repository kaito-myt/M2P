'use client';

/**
 * S-030 AdsConnectionBanner — 接続状態(接続済み/未接続)＋最終取得日時＋「今すぐ取得」。
 *
 * `ads.spend.fetch` には run 追跡テーブルが無いため sales-fetch-status-banner.tsx ほど
 * リッチな状態遷移はできない。接続有無は「ad_spend に行があるか」で判定する
 * (RSC page から渡される)。手動更新は manual-refresh-button.tsx と同じパターン。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { triggerAdsFetch } from '@/app/actions/ads';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';

const m = messages.ads.connection;

interface AdsConnectionBannerProps {
  connected: boolean;
  lastFetchedAt: string | null;
}

export function AdsConnectionBanner({ connected, lastFetchedAt }: AdsConnectionBannerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'ok'; text: string } | { kind: 'err'; text: string }>(
    { kind: 'idle' },
  );

  function onClick() {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await triggerAdsFetch();
      if (result.ok) {
        setStatus({ kind: 'ok', text: m.triggerSuccess });
        router.refresh();
      } else {
        setStatus({ kind: 'err', text: result.error.message });
      }
    });
  }

  return (
    <div
      className="flex flex-col gap-space-snug rounded-card border border-border-warm bg-cream-light px-space-relaxed py-space-snug"
      data-testid="ads-connection-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-space-snug">
        <div className="flex items-center gap-space-snug">
          <span
            className={
              connected
                ? 'inline-flex items-center gap-1.5 text-button-sm text-success'
                : 'inline-flex items-center gap-1.5 text-button-sm text-muted'
            }
            data-testid="ads-connection-status"
          >
            <span
              className={connected ? 'h-2 w-2 rounded-full bg-success' : 'h-2 w-2 rounded-full bg-charcoal-40'}
              aria-hidden="true"
            />
            {connected ? m.connected : m.notConnected}
          </span>
          <span className="text-caption text-muted">
            {m.lastFetchedLabel}: {lastFetchedAt ?? m.neverFetched}
          </span>
        </div>
        <Button type="button" data-testid="ads-fetch-trigger" onClick={onClick} disabled={pending} size="sm">
          {pending ? m.triggering : m.triggerButton}
        </Button>
      </div>
      {status.kind === 'ok' && (
        <p role="status" className="text-caption text-charcoal-82">
          {status.text}
        </p>
      )}
      {status.kind === 'err' && (
        <p role="alert" className="text-caption text-destructive">
          {status.text}
        </p>
      )}
      {!connected && (
        <p className="text-caption text-muted" data-testid="ads-setup-guide">
          {m.setupGuide}
        </p>
      )}
    </div>
  );
}
