'use client';

/**
 * S-017 SalesTrendChart (T-08-07, F-039).
 *
 * 月次積み上げ棒グラフ — HTML/SVG ベース (recharts なし, Phase 1 決定)。
 * ジャンルはパターン + 色で区別 (色のみに依存しないアクセシビリティ対応)。
 *
 * 仕様根拠: docs/04 S-017 / SP-08 T-08-07 / wireframe 注記 "グラフは枠 + 簡易折線/棒の輪郭で表現"
 */

import type { ReactElement } from 'react';
import { messages } from '@/lib/messages';
import type { TrendChartMonth } from '@/lib/sales-kpi-view';

interface SalesTrendChartProps {
  data: TrendChartMonth[];
}

const m = messages.salesKpi.trendChart;

const GENRES = [
  { key: 'practical', color: '#6B7280', pattern: 'url(#diag-practical)' },
  { key: 'business', color: '#374151', pattern: 'url(#diag-business)' },
  { key: 'self_help', color: '#9CA3AF', pattern: 'url(#diag-selfhelp)' },
] as const;

type GenreKey = 'practical' | 'business' | 'self_help';

// viewBox 基準の座標系。svg は width=100% + preserveAspectRatio=meet で描画するため、
// レンダリング高さは「コンテナ幅 × VB_H/VB_W」に一定化される (巨大な空白ボックスを防ぐ)。
const VB_W = 1000;
const PLOT_H = 230;
const AXIS_H = 46;
const VB_H = PLOT_H + AXIS_H;

function formatYen(v: number): string {
  if (v >= 100_000) return `¥${Math.round(v / 10_000)}万`;
  if (v >= 1_000) return `¥${(v / 1_000).toFixed(0)}k`;
  return `¥${v}`;
}

export function SalesTrendChart({ data }: SalesTrendChartProps) {
  const isEmpty = data.every((d) => d.total === 0);
  const maxValue = Math.max(...data.map((d) => d.total), 1);

  return (
    <section
      aria-labelledby="trend-chart-heading"
      className="flex flex-col gap-space-snug"
      data-testid="sales-trend-chart"
    >
      <h2 id="trend-chart-heading" className="text-card-title text-foreground">
        {m.sectionTitle}
      </h2>

      {/* Legend — genre by color + pattern */}
      <div className="flex flex-wrap gap-space-snug">
        {GENRES.map((g) => (
          <div key={g.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-4 shrink-0 border border-charcoal-20"
              style={{ backgroundColor: g.color }}
              aria-hidden="true"
            />
            <span className="text-button-sm text-muted">
              {m.genreLabels[g.key as keyof typeof m.genreLabels]}
            </span>
          </div>
        ))}
      </div>

      {isEmpty ? (
        <div className="flex h-64 items-center justify-center rounded-card border border-border-warm bg-cream-light">
          <p className="text-body text-muted">{m.empty}</p>
        </div>
      ) : (
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          {/* Screen-reader summary */}
          <p className="sr-only">
            {m.ariaDescription(data.length, formatYen(maxValue))}
          </p>
          <svg
            width="100%"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-labelledby="trend-chart-heading"
            className="block h-auto w-full"
            style={{ maxHeight: 320 }}
          >
            <defs>
              <pattern id="diag-practical" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#fff" strokeWidth="2.5" />
              </pattern>
              <pattern id="diag-business" patternUnits="userSpaceOnUse" width="8" height="8">
                <line x1="0" y1="4" x2="8" y2="4" stroke="#fff" strokeWidth="1.5" />
                <line x1="4" y1="0" x2="4" y2="8" stroke="#fff" strokeWidth="1.5" />
              </pattern>
              <pattern id="diag-selfhelp" patternUnits="userSpaceOnUse" width="8" height="8">
                <line x1="0" y1="4" x2="8" y2="4" stroke="#fff" strokeWidth="1.5" />
              </pattern>
            </defs>

            {/* baseline + max gridline */}
            <line x1={0} y1={PLOT_H} x2={VB_W} y2={PLOT_H} stroke="#D8D2C4" strokeWidth="1" />
            <line x1={0} y1={PLOT_H * 0.15 + 6} x2={VB_W} y2={PLOT_H * 0.15 + 6} stroke="#ECE7DA" strokeWidth="1" strokeDasharray="4 4" />
            <text x={4} y={PLOT_H * 0.15} fontSize="16" fill="#9CA3AF">
              {formatYen(maxValue)}
            </text>

            {data.map((month, i) => {
              const slotW = VB_W / data.length;
              const barWidth = Math.min(slotW * 0.5, 110);
              const x = i * slotW + (slotW - barWidth) / 2;
              let yOffset = PLOT_H;
              const bars: ReactElement[] = [];

              for (const genre of [...GENRES].reverse()) {
                const val = month[genre.key as GenreKey];
                if (val <= 0) continue;
                const barH = (val / maxValue) * (PLOT_H - 24);
                yOffset -= barH;
                const label = `${month.ym} ${m.genreLabels[genre.key as keyof typeof m.genreLabels]}: ${formatYen(val)}`;
                bars.push(
                  <g key={genre.key}>
                    <rect x={x} y={yOffset} width={barWidth} height={barH} fill={genre.color} stroke="white" strokeWidth="1" rx="2">
                      <title>{label}</title>
                    </rect>
                    <rect x={x} y={yOffset} width={barWidth} height={barH} fill={genre.pattern} stroke="none" rx="2" aria-label={label} />
                  </g>,
                );
              }

              return (
                <g key={month.ym}>
                  {bars}
                  <text x={i * slotW + slotW / 2} y={PLOT_H + 30} textAnchor="middle" fontSize="18" fill="#6B7280">
                    {month.ym.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
