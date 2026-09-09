'use client';

/**
 * JobTicker — サイドバー下部の実行中ジョブ表示。
 * `/api/jobs/running` を数秒間隔でポーリングし、実行中(running)ジョブ件数を表示する。
 * 取得前・失敗時は "—"（jobTickerFallback）。
 */
import { useEffect, useState } from 'react';
import { messages } from '@/lib/messages';

export function JobTicker() {
  const [running, setRunning] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/jobs/running', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { running?: number };
        if (alive && typeof data.running === 'number') setRunning(data.running);
      } catch {
        /* ネットワーク断は次回ポーリングで回復 */
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const active = running != null && running > 0;

  return (
    <div className="inline-flex w-full items-center justify-between rounded-pill bg-charcoal-04 px-3 py-1.5 text-button-sm text-charcoal-82">
      <span className="inline-flex items-center gap-1.5">
        {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />}
        {messages.nav.jobTickerLabel}
      </span>
      <span className="tabular-nums">
        {running == null ? messages.nav.jobTickerFallback : messages.nav.jobTickerCount(running)}
      </span>
    </div>
  );
}
