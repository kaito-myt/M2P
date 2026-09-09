/**
 * StatRow / Stat — 画面共通の指標フィギュア（S-002 ホームの Figure と同じ語彙）。
 *
 * 均等なカードの反復を避け、「余白＋極細の縦罫＋タイポのジャンプ率」で並べる。
 * ラベルは小さなトラッキング付き、数値は display セリフ＋tabular-nums。
 * 枠で囲まない — 区切りは hairline (divide-border-warm) のみ。
 */
import { cn } from '@/lib/cn';

export interface StatItem {
  label: string;
  value: string;
  /** 数値右に添える単位・補足（小さく淡く）。 */
  suffix?: string;
  /** 下段の注記（増減など）。 */
  note?: string;
  noteDir?: 'positive' | 'negative' | 'neutral';
  testId?: string;
}

function noteColor(dir: StatItem['noteDir']): string {
  if (dir === 'negative') return 'text-accent';
  if (dir === 'positive') return 'text-foreground';
  return 'text-charcoal-40';
}

export function Stat({ label, value, suffix, note, noteDir = 'neutral', testId }: StatItem) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5" data-testid={testId}>
        <span className="font-display text-[26px] leading-none tabular-nums text-foreground">
          {value}
        </span>
        {suffix && <span className="text-caption text-charcoal-40">{suffix}</span>}
      </span>
      {note && <span className={cn('text-caption', noteColor(noteDir))}>{note}</span>}
    </div>
  );
}

/**
 * StatRow — Stat を横一列に。SP は 2 列、その上は列数ぶんの等幅＋縦罫。
 * `bordered` で上端に hairline を敷く（ページ内の区切りとして）。
 */
export function StatRow({
  items,
  columns,
  bordered = true,
  className,
  testId,
}: {
  items: StatItem[];
  /** sm 以上の列数。既定は items.length。 */
  columns?: number;
  bordered?: boolean;
  className?: string;
  testId?: string;
}) {
  const cols = columns ?? items.length;

  // 5〜6 指標は sm では窮屈になるため、一列化＋縦罫は lg で効かせる。
  // 4 以下は sm から一列化する。ラベル衝突を避けつつ、区切りは単一行のときだけ。
  const wide = cols >= 5;
  const gridClass = wide
    ? cn(
        'grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3',
        'lg:gap-x-0 lg:gap-y-0 lg:divide-x lg:divide-border-warm',
        { 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols],
      )
    : cn(
        'grid grid-cols-2 gap-x-6 gap-y-6 sm:gap-x-0 sm:gap-y-0 sm:divide-x sm:divide-border-warm',
        { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[cols] ?? 'sm:grid-cols-3',
      );
  const cellClass = wide ? 'lg:px-6 lg:first:pl-0 lg:last:pr-0' : 'sm:px-6 sm:first:pl-0 sm:last:pr-0';

  return (
    <div
      data-testid={testId}
      className={cn('py-6', gridClass, bordered && 'border-t border-border-warm', className)}
    >
      {items.map((it) => (
        <div key={it.label} className={cellClass}>
          <Stat {...it} />
        </div>
      ))}
    </div>
  );
}
