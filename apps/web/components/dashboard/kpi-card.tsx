/**
 * KPI カード (S-002 Section 1) — docs/04 §6.3.5 L1 Bordered。
 *
 * `tone` で数値色を切替（黒字=positive/赤字=negative）。`hero` で大きめ表示。
 */
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface KpiCardProps {
  label: string;
  /** 現在値 (未集計時は "—") */
  value?: string;
  /** "/ 100 冊" のようなサフィックス */
  suffix?: string;
  /** 前月比テキスト e.g. "前月比 +2.1" */
  change?: string;
  /** change テキストの正負方向 */
  changeDir?: 'positive' | 'negative' | 'neutral';
  /** 主要値の色（純利益など）。既定は foreground。 */
  tone?: 'positive' | 'negative' | 'neutral';
  /** ヒーロー表示（純利益カードを一段大きく） */
  hero?: boolean;
}

const toneColor: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'text-success',
  negative: 'text-accent',
  neutral: 'text-foreground',
};

export function KpiCard({
  label,
  value = '—',
  suffix,
  change,
  changeDir = 'neutral',
  tone = 'neutral',
  hero = false,
}: KpiCardProps) {
  const changeColor =
    changeDir === 'positive'
      ? 'text-success'
      : changeDir === 'negative'
        ? 'text-accent'
        : 'text-muted';

  return (
    <Card variant="compact" className={cn(hero && 'border-l-2 border-l-accent')}>
      <CardContent className="flex flex-col gap-1 px-space-relaxed py-space-relaxed">
        <div className="text-button-sm text-muted">{label}</div>
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'tabular-nums',
              hero ? 'text-sub-heading' : 'text-card-title',
              toneColor[tone],
            )}
          >
            {value}
          </span>
          {suffix && <span className="text-button-sm text-muted">{suffix}</span>}
        </div>
        {change && <div className={`text-caption ${changeColor}`}>{change}</div>}
      </CardContent>
    </Card>
  );
}
