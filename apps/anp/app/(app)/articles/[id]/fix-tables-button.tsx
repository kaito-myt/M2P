'use client';

/**
 * 公開済み記事に残った Markdown の表を表画像に差し替えるボタン (F-ANP-48)。
 *
 * note のエディタには表機能が無く、初期の記事は `| 頭数帯 | レース数 |` がそのまま公開されて
 * いる。「表示を確認」= dry-run (差し替えるだけで更新は押さない。note は公開中の本文を
 * 「更新する」まで変えない) / 「表を画像に直す」= 実更新。
 */
import { useState, useTransition } from 'react';

import { fixArticleTables } from '@/app/actions/fix-tables';
import { messages } from '@/lib/messages';

interface FixTablesButtonProps {
  articleId: string;
  /** 本文に含まれる Markdown の表の数。 */
  tableCount: number;
  /** AppSettings.anp_publish_dry_run — true の間は実更新を無効化する。 */
  globalDryRunEnabled: boolean;
}

export function FixTablesButton({ articleId, tableCount, globalDryRunEnabled }: FixTablesButtonProps) {
  const m = messages.articles.detail.fixTables;
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = (dryRun: boolean) => {
    setError(null);
    setStarted(false);
    startTransition(async () => {
      const result = await fixArticleTables({ note_article_id: articleId, dry_run: dryRun });
      if (result.ok) setStarted(true);
      else setError(result.error);
    });
  };

  return (
    <section className="mt-space-loose rounded-container border border-border-warm p-space-relaxed">
      <h2 className="text-section-title text-charcoal">{m.title}</h2>
      <p className="mt-1 text-caption text-muted">{m.description(tableCount)}</p>
      <div className="mt-space-snug flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(true)}
          className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
        >
          {m.dryRun}
        </button>
        <button
          type="button"
          disabled={isPending || globalDryRunEnabled}
          onClick={() => run(false)}
          title={globalDryRunEnabled ? messages.accountDetail.publishDryRunModeNotice : undefined}
          className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
        >
          {m.run}
        </button>
      </div>
      <p className="mt-2 text-caption text-muted">{m.hint}</p>
      {globalDryRunEnabled && (
        <p className="mt-1 text-caption text-muted">{messages.accountDetail.publishDryRunModeNotice}</p>
      )}
      {started && <p className="mt-1 text-caption text-charcoal">{m.started}</p>}
      {error && <p className="mt-1 text-caption text-red-600">{error}</p>}
    </section>
  );
}
