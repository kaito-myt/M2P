'use client';

/**
 * [F-099] JudgeOverrideBanner — 品質判定ゲート (needs_human_review) を運営者が裁く。
 *
 * `pipeline.book.judge` が score_total < 80 かつ retry 上限に達した本は
 * `status='needs_human_review'` で止まる。2026-10-14 まで**この状態を承認する導線が
 * どこにも無く**、14 冊が最長 1 か月放置されていた (`/content-review` も
 * ContentApprovalBanner も `content_review` 専用だった)。
 *
 * 承認すると judge 合格時と同じ `status='thumbnail'` に進み、`/covers` での
 * カバー採用 → `pipeline.book.export` という既存の導線に合流する。
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { approveJudgeOverride, discardJudgeFailed } from '@/app/actions/books';
import { Button } from '@/components/ui/button';
import { messages } from '@/lib/messages';

const m = messages.books.judgeOverride;

export function JudgeOverrideBanner({
  bookId,
  scoreTotal,
}: {
  bookId: string;
  /** 直近の judge スコア。取れなければ null (表示を省く)。 */
  scoreTotal?: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (input: { book_id: string }) => Promise<{ ok: boolean; error?: { message?: string } }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn({ book_id: bookId });
      if (!res.ok) {
        setError(res.error?.message ?? m.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="flex flex-col gap-space-snug rounded-card border border-border-warm bg-cream-light p-space-relaxed"
      data-testid="judge-override-banner"
    >
      <p className="text-body text-charcoal">{m.banner}</p>
      {typeof scoreTotal === 'number' && (
        <p className="text-button-sm text-muted">
          {m.scoreLabel}: {scoreTotal} / 100
        </p>
      )}
      <p className="text-button-sm text-muted">{m.nextStep}</p>
      <div className="flex items-center gap-space-snug">
        <Button
          type="button"
          variant="default"
          onClick={() => run(approveJudgeOverride)}
          disabled={pending}
          data-testid="judge-override-approve-button"
        >
          {pending ? m.submitting : m.button}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!window.confirm(m.discardConfirm)) return;
            run(discardJudgeFailed);
          }}
          disabled={pending}
          data-testid="judge-override-discard-button"
        >
          {m.discardButton}
        </Button>
        {error && (
          <span className="text-button-sm text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
