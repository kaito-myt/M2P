'use client';

import { useState, useTransition } from 'react';

import { publishArticle } from '@/app/actions/publish';
import { messages } from '@/lib/messages';

interface PublishArticleButtonProps {
  articleId: string;
  /** AppSettings.anp_publish_dry_run — true の間は「公開する」を無効化する(code review #1)。 */
  globalDryRunEnabled: boolean;
}

export function PublishArticleButton({ articleId, globalDryRunEnabled }: PublishArticleButtonProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (dryRun: boolean) => {
    setError(null);
    startTransition(async () => {
      const result = await publishArticle({ note_article_id: articleId, dry_run: dryRun });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="mt-1 flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(true)}
          className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
        >
          {messages.accountDetail.publishDryRun}
        </button>
        <button
          type="button"
          disabled={isPending || globalDryRunEnabled}
          onClick={() => run(false)}
          title={globalDryRunEnabled ? messages.accountDetail.publishDryRunModeNotice : undefined}
          className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
        >
          {messages.accountDetail.publish}
        </button>
      </div>
      {globalDryRunEnabled && (
        <p className="text-caption text-muted">{messages.accountDetail.publishDryRunModeNotice}</p>
      )}
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  );
}
