'use client';

import { useState, useTransition } from 'react';

import { forceReady, retryEditor, retryJudge } from '@/app/actions/review';
import { messages } from '@/lib/messages';

/** `status='needs_human_review'` の記事に表示する再審査導線 (docs/11 §7 申し送り6)。 */
export function ArticleReviewActions({ articleId }: { articleId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (action: (input: unknown) => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action({ note_article_id: articleId });
      if (!result.ok) setError(result.error ?? messages.common.unknownError);
    });
  };

  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(retryJudge)}
          className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
        >
          {messages.accountDetail.reviewActions.retryJudge}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(retryEditor)}
          className="rounded-card border border-border-warm bg-cream-light px-3 py-1.5 text-button-sm text-charcoal disabled:opacity-50"
        >
          {messages.accountDetail.reviewActions.retryEditor}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(forceReady)}
          className="rounded-card border border-border-warm bg-charcoal px-3 py-1.5 text-button-sm text-white disabled:opacity-50"
        >
          {messages.accountDetail.reviewActions.forceReady}
        </button>
      </div>
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  );
}
