'use client';

/**
 * S-030 AdsTrendChart — 日次の広告費 vs 広告経由売上 (グループ化棒グラフ)。
 *
 * DailyCostChart (S-024) / SalesTrendChart (S-017) と同じ HTML/SVG ベース方式
 * (recharts 不使用)。1 日 = 2 本の棒 (広告費 / 広告経由売上) を並べる。
 */
import { messages } from '@/lib/messages';
import { formatJpy, type AdsTrendPoint } from '@/lib/ads-core';

const m = messages.ads.trend;

const SPEND_COLOR = '#b23a1e'; // アクセント (バーミリオン) — cost 系チャートと同系統
const SALES_COLOR = '#5c7a6a'; // ミュートグリーン — 売上系

const VB_W = 1000;
const PLOT_H = 240;
const AXIS_H = 48;
const VB_H = PLOT_H + AXIS_H;

function formatYen(v: number): string {
  if (v >= 10_000) return `¥${(v / 10_000).toFixed(1)}万`;
  if (v >= 1_000) return `¥${(v / 1_000).toFixed(1)}k`;
  return `¥${Math.round(v)}`;
}

function shortDate(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[1]}/${match[2]}` : date;
}

interface AdsTrendChartProps {
  data: AdsTrendPoint[];
}

export function AdsTrendChart({ data }: AdsTrendChartProps) {
  const isEmpty = data.length === 0 || data.every((d) => d.spendJpy === 0 && d.salesJpy === 0);
  const maxValue = Math.max(...data.map((d) => Math.max(d.spendJpy, d.salesJpy)), 1);

  return (
    <section
      aria-labelledby="ads-trend-chart-heading"
      className="flex flex-col gap-space-snug"
      data-testid="ads-trend-chart"
    >
      <h2 id="ads-trend-chart-heading" className="text-card-title text-foreground">
        {m.sectionTitle}
      </h2>

      {!isEmpty && (
        <div className="flex flex-wrap gap-x-space-snug gap-y-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 shrink-0 rounded-sm border border-border-warm" style={{ backgroundColor: SPEND_COLOR }} aria-hidden="true" />
            <span className="text-button-sm text-muted">{m.spendSeriesLabel}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 shrink-0 rounded-sm border border-border-warm" style={{ backgroundColor: SALES_COLOR }} aria-hidden="true" />
            <span className="text-button-sm text-muted">{m.salesSeriesLabel}</span>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="flex h-56 items-center justify-center rounded-card border border-border-warm bg-cream-light">
          <p className="text-body text-muted">{m.empty}</p>
        </div>
      ) : (
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="sr-only">{m.ariaDescription(data.length)}</p>
          <svg
            width="100%"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-labelledby="ads-trend-chart-heading"
            className="block h-auto w-full"
            style={{ maxHeight: 320 }}
          >
            {[0, 0.5, 1].map((f) => {
              const y = PLOT_H - f * (PLOT_H - 28);
              return (
                <g key={f}>
                  <line x1={64} y1={y} x2={VB_W} y2={y} stroke={f === 0 ? '#D8D2C4' : '#ECE7DA'} strokeWidth="1" strokeDasharray={f === 0 ? undefined : '4 4'} />
                  <text x={58} y={y + 5} fontSize="16" fill="#9CA3AF" textAnchor="end">
                    {formatYen(Math.round(f * maxValue))}
                  </text>
                </g>
              );
            })}

            {data.map((day, i) => {
              const plotW = VB_W - 64;
              const slotW = plotW / data.length;
              const groupWidth = Math.min(slotW * 0.62, 44);
              const barWidth = groupWidth / 2 - 1;
              const groupX = 64 + i * slotW + (slotW - groupWidth) / 2;

              const spendH = (day.spendJpy / maxValue) * (PLOT_H - 28);
              const salesH = (day.salesJpy / maxValue) * (PLOT_H - 28);

              const step = Math.ceil(data.length / 16);
              const showLabel = i % step === 0 || i === data.length - 1;

              return (
                <g key={day.date}>
                  <rect x={groupX} y={PLOT_H - spendH} width={barWidth} height={spendH} fill={SPEND_COLOR} rx="2">
                    <title>{`${shortDate(day.date)} ${m.spendSeriesLabel}: ${formatJpy(day.spendJpy)}`}</title>
                  </rect>
                  <rect x={groupX + barWidth + 2} y={PLOT_H - salesH} width={barWidth} height={salesH} fill={SALES_COLOR} rx="2">
                    <title>{`${shortDate(day.date)} ${m.salesSeriesLabel}: ${formatJpy(day.salesJpy)}`}</title>
                  </rect>
                  {showLabel && (
                    <text x={groupX + groupWidth / 2} y={PLOT_H + 30} textAnchor="middle" fontSize="15" fill="#6B7280">
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
