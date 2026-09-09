'use client';

/**
 * S-024 DailyCostChart — 日別コストの積み上げ棒グラフ (プロバイダ別)。
 *
 * SalesTrendChart と同じく HTML/SVG ベース (recharts なし)。
 * DailyCostRow[] (date × provider の明細) を日ごとにまとめ、プロバイダで積み上げる。
 * 色 + 凡例ラベルで区別 (色のみに依存しない)。
 */
import type { ReactElement } from 'react';

import { messages } from '@/lib/messages';
import { formatCostJpy, type DailyCostRow } from '@/lib/cost-dashboard-view';

const m = messages.costDashboard.dailyCost;

interface DailyCostChartProps {
  rows: DailyCostRow[];
}

// viewBox 座標系 (幅一定 + preserveAspectRatio でレンダリング高さを安定化)。
const VB_W = 1000;
const PLOT_H = 240;
const AXIS_H = 48;
const VB_H = PLOT_H + AXIS_H;

// プロバイダ色 (脱AI-UI のクール系パレット + 単一アクセント方針に合わせた抑えめの配色)。
const PROVIDER_COLORS: Record<string, string> = {
  anthropic: '#b23a1e', // アクセント (バーミリオン)
  openai: '#3f6a8a', // ミュートブルー
  google: '#8a6d3f', // ミュートアンバー
  tavily: '#5c7a6a', // ミュートグリーン
};
const FALLBACK_COLORS = ['#667085', '#9aa5b1', '#7d8794', '#b0b8c1'];

function providerColor(provider: string, fallbackIdx: number): string {
  return PROVIDER_COLORS[provider] ?? FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length]!;
}

function formatYen(v: number): string {
  if (v >= 10_000) return `¥${(v / 10_000).toFixed(1)}万`;
  if (v >= 1_000) return `¥${(v / 1_000).toFixed(1)}k`;
  return `¥${Math.round(v)}`;
}

/** 'YYYY-MM-DD' → 'MM/DD'。他形式はそのまま返す。 */
function shortDate(date: string): string {
  const m2 = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m2 ? `${m2[1]}/${m2[2]}` : date;
}

interface DaySegment {
  provider: string;
  value: number;
}
interface DayBar {
  date: string;
  segments: DaySegment[];
  total: number;
}

export function DailyCostChart({ rows }: DailyCostChartProps) {
  // プロバイダ順 = 総額の多い順 (積み上げ順・凡例順を統一)。
  const providerTotals = new Map<string, number>();
  for (const r of rows) {
    providerTotals.set(r.provider, (providerTotals.get(r.provider) ?? 0) + r.cost_jpy);
  }
  const providers = Array.from(providerTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p);
  const colorOf = new Map(providers.map((p, i) => [p, providerColor(p, i)]));

  // 日ごとに集約 (日付昇順)。
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    const dm = byDate.get(r.date)!;
    dm.set(r.provider, (dm.get(r.provider) ?? 0) + r.cost_jpy);
  }
  const days: DayBar[] = Array.from(byDate.keys())
    .sort()
    .map((date) => {
      const dm = byDate.get(date)!;
      const segments = providers
        .map((p) => ({ provider: p, value: dm.get(p) ?? 0 }))
        .filter((s) => s.value > 0);
      const total = segments.reduce((acc, s) => acc + s.value, 0);
      return { date, segments, total };
    });

  const isEmpty = days.length === 0 || days.every((d) => d.total === 0);
  const maxValue = Math.max(...days.map((d) => d.total), 1);

  return (
    <section
      aria-labelledby="daily-cost-chart-heading"
      className="flex flex-col gap-space-snug"
      data-testid="daily-cost-chart"
    >
      <h3 id="daily-cost-chart-heading" className="text-section-title text-foreground">
        {m.chartTitle}
      </h3>

      {/* 凡例 — プロバイダ (色 + ラベル) */}
      {!isEmpty && providers.length > 0 && (
        <div className="flex flex-wrap gap-x-space-snug gap-y-1">
          {providers.map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-4 shrink-0 rounded-sm border border-border-warm"
                style={{ backgroundColor: colorOf.get(p) }}
                aria-hidden="true"
              />
              <span className="text-button-sm text-muted">
                {p}（{formatCostJpy(providerTotals.get(p) ?? 0)}）
              </span>
            </div>
          ))}
        </div>
      )}

      {isEmpty ? (
        <div className="flex h-56 items-center justify-center rounded-card border border-border-warm bg-cream-light">
          <p className="text-body text-muted">{m.empty}</p>
        </div>
      ) : (
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="sr-only">{m.chartAria(days.length, formatYen(maxValue))}</p>
          <svg
            width="100%"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-labelledby="daily-cost-chart-heading"
            className="block h-auto w-full"
            style={{ maxHeight: 320 }}
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

            {days.map((day, i) => {
              const plotW = VB_W - 64;
              const slotW = plotW / days.length;
              const barWidth = Math.min(slotW * 0.62, 48);
              const x = 64 + i * slotW + (slotW - barWidth) / 2;
              let yOffset = PLOT_H;
              const bars: ReactElement[] = [];

              for (const seg of day.segments) {
                if (seg.value <= 0) continue;
                const barH = (seg.value / maxValue) * (PLOT_H - 28);
                yOffset -= barH;
                bars.push(
                  <rect
                    key={seg.provider}
                    x={x}
                    y={yOffset}
                    width={barWidth}
                    height={barH}
                    fill={colorOf.get(seg.provider)}
                    stroke="white"
                    strokeWidth="1"
                    rx="2"
                  >
                    <title>{`${shortDate(day.date)} ${seg.provider}: ${formatCostJpy(seg.value)}`}</title>
                  </rect>,
                );
              }

              // 日ラベルは本数が多いと重なるため間引く。
              const step = Math.ceil(days.length / 16);
              const showLabel = i % step === 0 || i === days.length - 1;

              return (
                <g key={day.date}>
                  {bars}
                  {showLabel && (
                    <text
                      x={x + barWidth / 2}
                      y={PLOT_H + 30}
                      textAnchor="middle"
                      fontSize="15"
                      fill="#6B7280"
                    >
                      {shortDate(day.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
