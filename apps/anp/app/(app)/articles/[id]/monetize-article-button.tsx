'use client';

/**
 * 公開済みの無料記事を有料に切り替えるボタン (F-ANP-47)。
 *
 * 「有料化を試す」= dry-run (note の有料設定と価格入力まで進めて更新は押さない。本人確認が
 * 済んでいるかの確認に使う) / 「有料化する」= 実更新。実更新はグローバルのドライラン設定が
 * ON の間は無効 (publish ボタンと同じガード)。
 */
import { useState, useTransition } from 'react';

import { monetizeArticle } from '@/app/actions/monetize';
import { messages } from '@/lib/messages';

interface MonetizeArticleButtonProps {
  articleId: string;
  /** judge が提案した価格 (プレースホルダのヒントに出す)。 */
  suggestedPriceJpy: number | null;
  /** AppSettings.anp_publish_dry_run — true の間は実更新を無効化する。 */
  globalDryRunEnabled: boolean;
}

export function MonetizeArticleButton({
  articleId,
  suggestedPriceJpy,
  globalDryRunEnabled,
}: MonetizeArticleButtonProps) {
  const m = messages.articles.detail.monetize;
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [isPending, startTransition] = useTransition();

  const run = (dryRun: boolean) => {
    setError(null);
    setStarted(false);
    startTransition(async () => {
      const trimmed = price.trim();
      const result = await monetizeArticle({
        note_article_id: articleId,
        dry_run: dryRun,
        ...(trimmed.length > 0 ? { price_jpy: trimmed } : {}),
      });
      if (result.ok) setStarted(true);
      else setError(result.error);
    });
  };

  return (
    <section className="mt-space-loose rounded-container border border-border-warm p-space-relaxed">
      <h2 className="text-section-title text-charcoal">{m.title}</h2>
      <p className="mt-1 text-caption text-muted">{m.description}</p>
      <div className="mt-space-snug flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{m.priceLabel}</span>
          <input
            type="number"
            min={100}
            max={50000}
            step={10}
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={m.pricePlaceholder}
            className="w-28 rounded-card border border-border-warm bg-white px-2 py-1.5 text-body text-charcoal"
          />
        </label>
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
      <p className="mt-2 text-caption text-muted">{m.priceHint(suggestedPriceJpy)}</p>
      <p className="mt-1 text-caption text-muted">{m.dryRunHint}</p>
      {globalDryRunEnabled && (
        <p className="mt-1 text-caption text-muted">{messages.accountDetail.publishDryRunModeNotice}</p>
      )}
      {started && <p className="mt-1 text-caption text-charcoal">{m.started}</p>}
      {error && <p className="mt-1 text-caption text-red-600">{error}</p>}
    </section>
  );
}
