/**
 * S-017 SalesKpiStripe (T-08-07, F-039).
 *
 * 5 KPI cards: 累計売上 / 累計冊数 / 平均1冊売上 / 平均レビュー星 / コスト/売上比率.
 */
import { messages } from '@/lib/messages';
import {
  formatJpy,
  formatStars,
  formatCostSalesRatio,
  formatKenp,
  type SalesKpiSummary,
} from '@/lib/sales-kpi-view';
import { StatRow } from '@/components/common/stat-row';

interface SalesKpiStripeProps {
  summary: SalesKpiSummary;
}

const m = messages.salesKpi.kpi;

export function SalesKpiStripe({ summary }: SalesKpiStripeProps) {
  // 期間 (= 月選択を含む) の内訳。推計とペーパーバックは「本当にそれだけ売れたのか」を
  // 確かめる手掛かりなので、金額が立っているときだけ注記として出す。
  const parts: string[] = [];
  if (summary.period_kenp_estimated_jpy > 0) {
    parts.push(m.kenpEstimatePart(formatJpy(summary.period_kenp_estimated_jpy)));
  }
  if (summary.period_paperback_royalty_jpy > 0) {
    parts.push(m.paperbackPart(formatJpy(summary.period_paperback_royalty_jpy)));
  }

  return (
    <StatRow
      testId="sales-kpi-stripe"
      columns={6}
      items={[
        {
          // 先頭は「いま選んでいる期間/月」の売上。累計は隣に置く (月を選んでも数字が
          // 動かないと、月選択が効いていないように見えるため)。
          label: m.periodRoyaltyLabel,
          value: formatJpy(summary.period_royalty_jpy),
          note: parts.length > 0 ? `${m.periodBreakdownPrefix} ${parts.join(' / ')}` : undefined,
          testId: 'kpi-period-royalty',
        },
        {
          label: m.totalRoyaltyLabel,
          value: formatJpy(summary.total_royalty_jpy),
          note:
            summary.total_kenp_estimated_jpy > 0
              ? m.kenpEstimateNote(formatJpy(summary.total_kenp_estimated_jpy))
              : undefined,
          testId: 'kpi-total-royalty',
        },
        {
          label: m.totalBooksLabel,
          value: summary.total_books.toLocaleString('ja-JP'),
          suffix: m.booksUnit,
          testId: 'kpi-total-books',
        },
        { label: m.periodKenpLabel, value: formatKenp(summary.period_kenp_read), testId: 'kpi-period-kenp' },
        { label: m.avgStarsLabel, value: formatStars(summary.avg_stars), testId: 'kpi-avg-stars' },
        { label: m.costSalesRatioLabel, value: formatCostSalesRatio(summary.cost_sales_ratio), testId: 'kpi-cost-sales-ratio' },
      ]}
    />
  );
}
