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
  return (
    <StatRow
      testId="sales-kpi-stripe"
      columns={6}
      items={[
        { label: m.totalRoyaltyLabel, value: formatJpy(summary.total_royalty_jpy), testId: 'kpi-total-royalty' },
        {
          label: m.totalBooksLabel,
          value: summary.total_books.toLocaleString('ja-JP'),
          suffix: m.booksUnit,
          testId: 'kpi-total-books',
        },
        { label: m.avgRoyaltyLabel, value: formatJpy(summary.avg_royalty_per_book_jpy), testId: 'kpi-avg-royalty' },
        { label: 'KENP読了(累計)', value: formatKenp(summary.total_kenp_read), testId: 'kpi-total-kenp' },
        { label: m.avgStarsLabel, value: formatStars(summary.avg_stars), testId: 'kpi-avg-stars' },
        { label: m.costSalesRatioLabel, value: formatCostSalesRatio(summary.cost_sales_ratio), testId: 'kpi-cost-sales-ratio' },
      ]}
    />
  );
}
