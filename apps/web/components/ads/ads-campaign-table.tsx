/**
 * S-030 AdsCampaignTable — キャンペーン別 (名前/状態/日予算/広告費/売上/ROAS/ACOS/クリック/CPC)。
 * ROAS 降順 (aggregateCampaignRows 側でソート済み)。
 */
import { Badge } from '@/components/ui/badge';
import { messages } from '@/lib/messages';
import { formatJpy, formatPct, formatRoas, formatCount, type AdsCampaignRow } from '@/lib/ads-core';

const m = messages.ads.campaigns;

function stateLabel(state: string | null): string {
  if (!state) return '—';
  return m.stateLabels[state] ?? state;
}

function stateBadgeVariant(state: string | null): 'success' | 'neutral' | 'should' {
  if (state === 'enabled') return 'success';
  if (state === 'paused') return 'should';
  return 'neutral';
}

interface AdsCampaignTableProps {
  rows: AdsCampaignRow[];
}

export function AdsCampaignTable({ rows }: AdsCampaignTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border-warm bg-cream-light p-space-loose text-center" data-testid="ads-campaign-table-empty">
        <p className="text-body text-muted">{m.empty}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border-warm" data-testid="ads-campaign-table">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border-warm bg-cream-light text-left">
            <th className="whitespace-nowrap px-space-relaxed py-space-snug font-medium text-charcoal">{m.colName}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug font-medium text-charcoal">{m.colState}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colBudget}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colSpend}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colSales}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colRoas}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colAcos}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colClicks}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colCpc}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.campaignId} className="border-b border-border-warm last:border-0">
              <td className="max-w-xs truncate px-space-relaxed py-space-snug text-charcoal" title={row.campaignName}>
                {row.campaignName}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug">
                <Badge variant={stateBadgeVariant(row.state)}>{stateLabel(row.state)}</Badge>
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                {row.budgetJpy != null ? formatJpy(row.budgetJpy) : '—'}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                {formatJpy(row.spendJpy)}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                {formatJpy(row.salesJpy)}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                {formatRoas(row.roas)}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                {formatPct(row.acosPct)}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                {formatCount(row.clicks)}
              </td>
              <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                {row.cpc != null ? formatJpy(row.cpc) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
