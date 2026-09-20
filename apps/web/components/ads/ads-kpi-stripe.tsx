/**
 * S-030 AdsKpiStripe — 当月 KPI (広告費/広告経由売上/ROAS/ACOS/注文数 + 前月比、
 * インプレッション/クリック/CTR/CPC)。
 */
import { StatRow } from '@/components/common/stat-row';
import { messages } from '@/lib/messages';
import {
  formatCount,
  formatJpy,
  formatMomPct,
  formatPct,
  formatRoas,
  type AdsKpi,
} from '@/lib/ads-core';

const m = messages.ads.kpi;

interface AdsKpiStripeProps {
  kpi: AdsKpi;
  momSpendPct: number | null;
  momSalesPct: number | null;
}

export function AdsKpiStripe({ kpi, momSpendPct, momSalesPct }: AdsKpiStripeProps) {
  return (
    <div className="flex flex-col" data-testid="ads-kpi-stripe">
      <StatRow
        testId="ads-kpi-primary"
        columns={5}
        items={[
          {
            label: m.spendLabel,
            value: formatJpy(kpi.spendJpy),
            note: momSpendPct != null ? `${m.momSuffix} ${formatMomPct(momSpendPct)}` : m.momNa,
            noteDir: momSpendPct == null ? 'neutral' : momSpendPct > 0 ? 'negative' : 'positive',
            testId: 'ads-kpi-spend',
          },
          {
            label: m.salesLabel,
            value: formatJpy(kpi.salesJpy),
            note: momSalesPct != null ? `${m.momSuffix} ${formatMomPct(momSalesPct)}` : m.momNa,
            noteDir: momSalesPct == null ? 'neutral' : momSalesPct >= 0 ? 'positive' : 'negative',
            testId: 'ads-kpi-sales',
          },
          { label: m.roasLabel, value: formatRoas(kpi.roas), testId: 'ads-kpi-roas' },
          { label: m.acosLabel, value: formatPct(kpi.acosPct), testId: 'ads-kpi-acos' },
          { label: m.ordersLabel, value: formatCount(kpi.orders), testId: 'ads-kpi-orders' },
        ]}
      />
      <StatRow
        testId="ads-kpi-secondary"
        columns={4}
        bordered={false}
        items={[
          { label: m.impressionsLabel, value: formatCount(kpi.impressions), testId: 'ads-kpi-impressions' },
          { label: m.clicksLabel, value: formatCount(kpi.clicks), testId: 'ads-kpi-clicks' },
          { label: m.ctrLabel, value: formatPct(kpi.ctrPct), testId: 'ads-kpi-ctr' },
          { label: m.cpcLabel, value: kpi.cpc != null ? formatJpy(kpi.cpc) : '—', testId: 'ads-kpi-cpc' },
        ]}
      />
    </div>
  );
}
