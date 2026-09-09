/**
 * S-024 CostKpiStripe (T-07-05).
 *
 * 5 KPI cards: actual / forecast / remaining / ratio / per-book.
 */
import { messages } from '@/lib/messages';
import { formatCostJpy, type CostKpi } from '@/lib/cost-dashboard-view';
import { StatRow } from '@/components/common/stat-row';

interface CostKpiStripeProps {
  kpi: CostKpi;
}

const m = messages.costDashboard.kpi;

export function CostKpiStripe({ kpi }: CostKpiStripeProps) {
  return (
    <StatRow
      testId="cost-kpi-stripe"
      columns={5}
      items={[
        { label: m.actualLabel, value: formatCostJpy(kpi.actual), suffix: m.limitSuffix, testId: 'cost-kpi-actual' },
        { label: m.forecastLabel, value: formatCostJpy(kpi.forecast), testId: 'cost-kpi-forecast' },
        { label: m.remainingLabel, value: formatCostJpy(kpi.remaining), testId: 'cost-kpi-remaining' },
        {
          label: m.ratioLabel,
          value: `${kpi.ratioPct}${m.pctSuffix}`,
          noteDir: kpi.ratioPct >= 100 ? 'negative' : 'neutral',
          testId: 'cost-kpi-ratio',
        },
        { label: m.perBookLabel, value: formatCostJpy(kpi.perBook), testId: 'cost-kpi-per-book' },
      ]}
    />
  );
}
