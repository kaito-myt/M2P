/**
 * PageHeading — 内側画面共通の見出し（S-002 ホームのマストヘッドと同じ語彙）。
 *
 * 「Home > 運用 > ジョブ」式の反復するパンくずを、小さな eyebrow ラベル＋
 * 抑えた h1＋補足文＋右端アクションに置き換え、下端を極細の罫で締める。
 * 巨大な見出しにしない（26px / 600）。中央揃えにしない。
 */
import type { ReactNode } from 'react';

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  /** 所属セクション（サイドバーの見出しに相当）。省略可。 */
  eyebrow?: string;
  title: string;
  description?: string;
  /** 右端に置く CTA / インポートボタンなど。 */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border-warm pb-4">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && (
          <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {eyebrow}
          </span>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
          {title}
        </h1>
        {description && <p className="text-button-sm text-muted">{description}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-space-snug">{actions}</div>
      )}
    </header>
  );
}
