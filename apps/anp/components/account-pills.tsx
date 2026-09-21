/**
 * AccountPills — アカウント切替 (運営者要望 2026-09-21「アカウントの切替も作成中とか公開前とかのステータスと同じように
 * ボタンにして」)。段階タブと同じピル型リンクで、記事一覧 / 販促施策など横断ページのアカウント絞り込みに使う。
 */
import Link from 'next/link';

import { cn } from '@/lib/cn';

export interface AccountPillItem {
  id: string;
  label: string;
  /** バッジ (件数など)。省略可。 */
  count?: number;
}

export function AccountPills({
  accounts,
  activeId,
  hrefFor,
  allLabel,
  allCount,
  ariaLabel,
  className,
  testId,
}: {
  accounts: ReadonlyArray<AccountPillItem>;
  /** '' = すべて。 */
  activeId: string;
  hrefFor: (accountId: string) => string;
  /** 「すべて」ピルを出すときのラベル。省略すると「すべて」ピルは出さない。 */
  allLabel?: string;
  allCount?: number;
  ariaLabel: string;
  className?: string;
  testId?: string;
}) {
  const items: ReadonlyArray<AccountPillItem> = allLabel
    ? [{ id: '', label: allLabel, ...(allCount !== undefined ? { count: allCount } : {}) }, ...accounts]
    : accounts;
  return (
    <nav aria-label={ariaLabel} className={cn('flex flex-wrap gap-2', className)} data-testid={testId}>
      {items.map((a) => {
        const active = a.id === activeId;
        return (
          <Link
            key={a.id || 'all'}
            href={hrefFor(a.id)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
              active ? 'border-charcoal bg-charcoal text-white' : 'border-border-warm bg-white text-charcoal-82 hover:bg-charcoal-04',
            )}
          >
            {a.label}
            {a.count !== undefined && (
              <span className={cn('ml-1.5 tabular-nums', active ? 'text-white/80' : 'text-muted')}>{a.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
