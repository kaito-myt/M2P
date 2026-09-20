/**
 * S-030 AdsBookTable — 書籍別 (書名/広告費/広告経由売上/注文/ROAS/当月印税/広告費-印税)。
 * ASIN が books に無い行は「(未登録 ASIN)」表示 (buildAdsBookRows 側で解決済み)。
 */
import Link from 'next/link';

import { messages } from '@/lib/messages';
import { formatJpy, formatRoas, formatCount, type AdsBookRow } from '@/lib/ads-core';

const m = messages.ads.books;

interface AdsBookTableProps {
  rows: AdsBookRow[];
  /** asin → book_id (詳細画面リンク用)。無ければリンクしない。 */
  bookIdByAsin: ReadonlyMap<string, string>;
}

export function AdsBookTable({ rows, bookIdByAsin }: AdsBookTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border-warm bg-cream-light p-space-loose text-center" data-testid="ads-book-table-empty">
        <p className="text-body text-muted">{m.empty}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-border-warm" data-testid="ads-book-table">
      <table className="w-full text-body">
        <thead>
          <tr className="border-b border-border-warm bg-cream-light text-left">
            <th className="whitespace-nowrap px-space-relaxed py-space-snug font-medium text-charcoal">{m.colTitle}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colSpend}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colSales}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colOrders}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colRoas}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colRoyalty}</th>
            <th className="whitespace-nowrap px-space-relaxed py-space-snug text-right font-medium text-charcoal">{m.colDiff}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const bookId = row.asin ? bookIdByAsin.get(row.asin) : undefined;
            const diff = row.royaltyJpy != null ? row.spendJpy - row.royaltyJpy : null;
            return (
              <tr key={row.asin ?? `unregistered-${row.title}`} className="border-b border-border-warm last:border-0">
                <td className="max-w-xs truncate px-space-relaxed py-space-snug text-charcoal" title={row.title}>
                  {bookId ? (
                    <Link href={`/books/${bookId}`} className="text-foreground underline hover:no-underline">
                      {row.title}
                    </Link>
                  ) : (
                    row.title
                  )}
                </td>
                <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                  {formatJpy(row.spendJpy)}
                </td>
                <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                  {formatJpy(row.salesJpy)}
                </td>
                <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                  {formatCount(row.orders)}
                </td>
                <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-charcoal">
                  {formatRoas(row.roas)}
                </td>
                <td className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums text-muted">
                  {row.royaltyJpy != null ? formatJpy(row.royaltyJpy) : '—'}
                </td>
                <td
                  className="whitespace-nowrap px-space-relaxed py-space-snug text-right tabular-nums"
                  data-testid="ads-book-diff"
                >
                  {diff != null ? (
                    <span className={diff > 0 ? 'text-accent' : 'text-charcoal'}>{formatJpy(diff)}</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
