/**
 * ActionRequiredCard (S-002 Section 2) — 運営者の「私がやること」を実カウント＋実リンクで提示。
 *
 * - `count === 0`: ミュート表示・クリック不可（対応不要）。
 * - `count >= 1`: 強調（アクセント枠）・カード全体が href へのリンク。
 * - `must` を渡すと must 件数を赤で併記（修正コメント用）。
 */
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface ActionCardProps {
  label: string;
  /** 未対応件数（0 で対応不要表示） */
  count?: number;
  /** 遷移先。未指定なら非リンク。 */
  href?: string;
  /** must 件数 (修正コメントカード用) */
  must?: number;
}

export function ActionCard({ label, count = 0, href, must }: ActionCardProps) {
  const pending = count > 0 || (typeof must === 'number' && must > 0);
  const urgent = typeof must === 'number' && must > 0;

  const body = (
    <CardContent className="flex flex-col gap-space-snug px-space-relaxed py-space-relaxed">
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-button-sm', pending ? 'text-charcoal-82' : 'text-muted')}>
          {label}
        </span>
        <span
          className={cn(
            'text-card-title tabular-nums',
            urgent ? 'text-destructive' : pending ? 'text-accent' : 'text-charcoal-40',
          )}
        >
          {count}
        </span>
      </div>
      {typeof must === 'number' && must > 0 && (
        <span className="text-button-sm text-destructive">must: {must}</span>
      )}
      {pending && href && (
        <span className="mt-auto inline-flex items-center gap-1 text-caption font-medium text-accent">
          対応する
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </CardContent>
  );

  if (pending && href) {
    return (
      <Link
        href={href}
        className={cn(
          'block rounded-default no-underline transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
        data-testid="dashboard-action-card"
      >
        <Card
          variant="compact"
          className={cn(
            'h-full border-l-2 transition-colors hover:bg-charcoal-04',
            urgent ? 'border-l-destructive' : 'border-l-accent',
          )}
        >
          {body}
        </Card>
      </Link>
    );
  }

  return (
    <Card variant="compact" className="h-full opacity-70" data-testid="dashboard-action-card">
      {body}
    </Card>
  );
}
