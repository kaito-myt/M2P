/**
 * 分析ダッシュボード共通の表示部品 (RSC 互換・recharts 不使用。A2P Phase 1 と同じくテーブル＋CSS バー)。
 */
import Link from 'next/link';

import { cn } from '@/lib/cn';

export function KpiCard({ label, value, delta, sub }: { label: string; value: string; delta?: number | null; sub?: string }) {
  return (
    <div className="rounded-container border border-border-warm bg-cream-light p-space-relaxed">
      <p className="text-caption text-muted">{label}</p>
      <p className="mt-1 text-sub-heading font-medium tabular-nums text-charcoal">{value}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-caption text-muted">
        {delta !== undefined && delta !== null && (
          <span className={cn('rounded-pill border px-1.5 py-0.5 tabular-nums', delta >= 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-red-300 bg-red-50 text-red-700')}>
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        )}
        {sub && <span>{sub}</span>}
      </p>
    </div>
  );
}

export function TrendTable({ columns, rows, bars, className }: { columns: string[]; rows: string[][]; bars?: number[]; className?: string }) {
  const max = bars && bars.length > 0 ? Math.max(...bars, 1) : 1;
  return (
    <div className={cn('overflow-x-auto rounded-container border border-border-warm', className)}>
      <table className="w-full min-w-[640px] border-collapse text-body">
        <thead>
          <tr className="border-b border-border-warm bg-cream-light text-caption text-muted">
            {columns.map((c, i) => (
              <th key={c} className={cn('px-3 py-2 font-medium', i === 0 ? 'text-left' : 'text-right')}>
                {c}
              </th>
            ))}
            {bars && <th className="w-[160px] px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r[0] ?? ri} className="border-b border-border-warm last:border-b-0">
              {r.map((cell, i) => (
                <td key={i} className={cn('px-3 py-2 tabular-nums', i === 0 ? 'text-left text-charcoal' : 'text-right')}>
                  {cell}
                </td>
              ))}
              {bars && (
                <td className="px-3 py-2">
                  <div className="h-2 w-full rounded-pill bg-charcoal-04">
                    <div className="h-2 rounded-pill bg-charcoal" style={{ width: `${Math.max(0, Math.min(100, ((bars[ri] ?? 0) / max) * 100))}%` }} />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: string;
  href?: string;
  sub?: string;
  value: number;
  display: string;
}

export function BarList({ items, className }: { items: BarListItem[]; className?: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ol className={cn('flex flex-col gap-2', className)}>
      {items.map((it) => (
        <li key={it.key} className="rounded-card border border-border-warm bg-cream-light px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              {it.href ? (
                <Link href={it.href} className="block truncate text-body text-charcoal no-underline hover:underline">
                  {it.label}
                </Link>
              ) : (
                <p className="truncate text-body text-charcoal">{it.label}</p>
              )}
              {it.sub && <p className="truncate text-caption text-muted">{it.sub}</p>}
            </div>
            <span className="shrink-0 text-body tabular-nums text-charcoal">{it.display}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full rounded-pill bg-charcoal-04">
            <div className="h-1.5 rounded-pill bg-charcoal" style={{ width: `${Math.max(0, Math.min(100, (it.value / max) * 100))}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DailyBars({ points, className, format }: { points: Array<{ date: string; cost: number; calls: number }>; className?: string; format: (n: number) => string }) {
  const max = Math.max(...points.map((p) => p.cost), 1);
  return (
    <div className={cn('rounded-container border border-border-warm bg-cream-light p-space-relaxed', className)}>
      <div className="flex h-32 items-end gap-1">
        {points.map((p) => (
          <div key={p.date} className="group relative flex-1">
            <div className="w-full rounded-t bg-charcoal/80" style={{ height: `${Math.max(2, (p.cost / max) * 100)}%` }} title={`${p.date}: ${format(p.cost)} (${p.calls})`} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-caption text-muted">
        <span>{points[0]?.date.slice(5)}</span>
        <span>{points[points.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}
