/**
 * S-017 SalesInsights — 売上から派生する分析サマリ。
 *
 * 既存 KPI に加え、売れ筋 Top / ジャンル別売上構成 / 前月比 / 黒字・売上ゼロ冊数 を提示する。
 * 純表示コンポーネント (RSC)。データは buildSalesInsights で算出済み。
 */
import { salesGenreLabel, genreColorMap, formatJpy, type SalesInsights as Insights } from '@/lib/sales-kpi-view';

interface SalesInsightsProps {
  insights: Insights;
}

function formatPct(v: number): string {
  const pct = Math.round(v * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

export function SalesInsights({ insights }: SalesInsightsProps) {
  const { topBooks, genreShare, momGrowthPct, latestMonthTotal, zeroSalesCount, profitableCount, totalBooks } =
    insights;
  const colors = genreColorMap(genreShare.map((g) => g.genre));

  return (
    <section aria-labelledby="sales-insights-heading" className="flex flex-col gap-space-snug" data-testid="sales-insights">
      <h2 id="sales-insights-heading" className="text-card-title text-foreground">
        分析サマリ
      </h2>

      {/* サマリ指標カード */}
      <div className="grid grid-cols-2 gap-space-snug sm:grid-cols-4">
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="text-caption text-muted">直近月の売上</p>
          <p className="text-sub-heading text-foreground">{formatJpy(latestMonthTotal)}</p>
        </div>
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="text-caption text-muted">前月比</p>
          <p
            className={`text-sub-heading ${
              momGrowthPct == null ? 'text-muted' : momGrowthPct >= 0 ? 'text-success' : 'text-destructive'
            }`}
          >
            {momGrowthPct == null ? '—' : formatPct(momGrowthPct)}
          </p>
        </div>
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="text-caption text-muted">黒字の本 (ROI&gt;0)</p>
          <p className="text-sub-heading text-foreground">
            {profitableCount}
            <span className="text-body text-muted"> / {totalBooks}冊</span>
          </p>
        </div>
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <p className="text-caption text-muted">売上ゼロの本</p>
          <p className="text-sub-heading text-foreground">
            {zeroSalesCount}
            <span className="text-body text-muted"> 冊</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-space-loose lg:grid-cols-2">
        {/* 売れ筋 Top */}
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <h3 className="mb-space-snug text-button-sm font-medium text-charcoal-82">売れ筋 Top（累計売上）</h3>
          {topBooks.length === 0 ? (
            <p className="text-caption text-muted">売上のある書籍がまだありません。</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {topBooks.map((b, i) => (
                <li key={b.book_id} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-button-sm font-medium text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-button-sm text-foreground" title={b.title}>
                    {b.title}
                  </span>
                  <span className="shrink-0 text-button-sm font-medium text-foreground">
                    {formatJpy(b.cumulative_royalty_jpy)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* ジャンル別売上構成 */}
        <div className="rounded-card border border-border-warm bg-cream-light p-space-snug">
          <h3 className="mb-space-snug text-button-sm font-medium text-charcoal-82">ジャンル別 売上構成</h3>
          {genreShare.length === 0 ? (
            <p className="text-caption text-muted">売上データがまだありません。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {genreShare.slice(0, 6).map((g) => (
                <li key={g.genre} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-button-sm">
                    <span className="flex items-center gap-1.5 text-foreground">
                      <span
                        className="inline-block h-3 w-3 shrink-0 rounded-sm"
                        style={{ backgroundColor: colors[g.genre] }}
                        aria-hidden="true"
                      />
                      {salesGenreLabel(g.genre)}
                    </span>
                    <span className="text-muted">
                      {formatJpy(g.value)}（{Math.round(g.pct * 100)}%）
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-charcoal-04">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(2, Math.round(g.pct * 100))}%`, backgroundColor: colors[g.genre] }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
