'use client';

/**
 * S-017 SalesTrendChart (F-039).
 *
 * 月次積み上げ棒グラフ (HTML/SVG ベース, recharts なし)。
 * **全ジャンル**を売上合計の多い順に積み上げる (旧: practical/business/self_help の 3 種固定=誤集計)。
 * ジャンルは色 + 凡例ラベルで区別 (色のみに依存しない)。
 */

import type { ReactElement } from 'react';
import { messages } from '@/lib/messages';
import { salesGenreLabel, genreColorMap, type TrendChartMonth } from '@/lib/sales-kpi-view';

interface SalesTrendChartProps {
  data: TrendChartMonth[];
}

const m = messages.salesKpi.trendChart;

// viewBox 基準の座標系 (幅一定 + preserveAspectRatio でレンダリング高さを安定化)。
const VB_W = 1000;
const PLOT_H = 240;
const AXIS_H = 48;
const VB_H = PLOT_H + AXIS_H;

function formatYen(v: number): string {
  if (v >= 100_000) return `¥${Math.round(v / 10_000)}万`;
  if (v >= 1_000) return `¥${(v / 1_000).toFixed(1)}k`;
  return `¥${v}`;
}

export function SalesTrendChart({ data }: SalesTrendChartProps) {
  const isEmpty = data.every((d) => d.total === 0);
  const maxValue = Math.max(...data.map((d) => d.total), 1);
  // ジャンル順は全月共通 (segments が同順)。先頭月から取得。
  const genres = data[0]?.segments.map((s) => s.genre) ?? [];
  const colors = genreColorMap(genres);

  return (
    <section
      aria-labelledby="trend-chart-heading"
      className="flex flex-col gap-space-snug"
      data-testid="sales-trend-chart"
    >
      <h2 id="trend-chart-heading" className="text-card-title text-foreground">
        {m.sectionTitle}
      </h2>

      {/* 凡例 — ジャンル(色 + 日本語ラベル) */}
      {!isEmpty && genres.length > 0 && (
        <div className="flex flex-wrap gap-x-space-snug gap-y-1">
          {genres.map((g) => (
            <div key={g} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-4 shrink-0 rounded-sm border border-border-warm"
                style={{ backgroundColor: colors[g] }}
                aria-hidden="true"
              />
              <span className="text-button-sm text-muted">{salesGenreLabel(g)}</span>
            </div>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="flex h-64 items-center justify-center rounded-card border border-border-warm bg-cream-light">
          <p className="text-body text-muted">{m.empty}</p>
        </div>
      ) : (
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="sr-only">{m.ariaDescription(data.length, formatYen(maxValue))}</p>
          <svg
            width="100%"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-labelledby="trend-chart-heading"
            className="block h-auto w-full"
            style={{ maxHeight: 340 }}
          >
            {/* グリッド: 0 / 50% / 100% */}
            {[0, 0.5, 1].map((f) => {
              const y = PLOT_H - f * (PLOT_H - 28);
              return (
                <g key={f}>
                  <line
                    x1={64}
                    y1={y}
                    x2={VB_W}
                    y2={y}
                    stroke={f === 0 ? '#D8D2C4' : '#ECE7DA'}
                    strokeWidth="1"
                    strokeDasharray={f === 0 ? undefined : '4 4'}
                  />
                  <text x={58} y={y + 5} fontSize="16" fill="#9CA3AF" textAnchor="end">
                    {formatYen(Math.round(f * maxValue))}
                  </text>
                </g>
              );
            })}

            {data.map((month, i) => {
              const plotW = VB_W - 64;
              const slotW = plotW / data.length;
              const barWidth = Math.min(slotW * 0.56, 120);
              const x = 64 + i * slotW + (slotW - barWidth) / 2;
              let yOffset = PLOT_H;
              const bars: ReactElement[] = [];

              for (const seg of month.segments) {
                if (seg.value <= 0) continue;
                const barH = (seg.value / maxValue) * (PLOT_H - 28);
                yOffset -= barH;
                const label = `${month.ym} ${salesGenreLabel(seg.genre)}: ${formatYen(seg.value)}`;
                bars.push(
                  <rect
                    key={seg.genre}
                    x={x}
                    y={yOffset}
                    width={barWidth}
                    height={barH}
                    fill={colors[seg.genre]}
                    stroke="white"
                    strokeWidth="1"
                    rx="2"
                  >
                    <title>{label}</title>
                  </rect>,
                );
              }

              return (
                <g key={month.ym}>
                  {bars}
                  {/* 合計値ラベル (棒の上) */}
                  {month.total > 0 && (
                    <text
                      x={x + barWidth / 2}
                      y={yOffset - 8}
                      textAnchor="middle"
                      fontSize="16"
                      fill="#6B7280"
                    >
                      {formatYen(month.total)}
                    </text>
                  )}
                  <text
                    x={x + barWidth / 2}
                    y={PLOT_H + 32}
                    textAnchor="middle"
                    fontSize="18"
                    fill="#6B7280"
                  >
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
