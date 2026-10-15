/**
 * S-3DP-02 商品一覧 (docs/12-3dp-design.md §9)。
 *
 * status 別に絞り込める一覧。Inc-1 では企画 (Inc-3) も生成 (Inc-2) も未接続なので
 * 通常は空だが、**空の枠だけを置くのではなく実データを読む** ようにしておく
 * (後続で `tdp_products` に行が入った瞬間に見える)。
 * needs_fix の検査 NG 理由 (`tdp_assets.inspect_json`) の表示は Inc-2 で足す。
 */
import Link from 'next/link';

import { prisma } from '@a2p/db';

import { cn } from '@/lib/cn';
import { messages } from '@/lib/messages';
import { PRODUCT_STATUSES } from '@/lib/home-core';

const m = messages.products;

function formatJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 3600_000);
  const mm = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(jst.getUTCDate()).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${mm}-${dd}`;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.status === 'string' ? sp.status : '';
  const status = (PRODUCT_STATUSES as readonly string[]).includes(raw) ? raw : null;

  const products = await prisma.tdpProduct.findMany({
    ...(status ? { where: { status } } : {}),
    orderBy: { updated_at: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      price_jpy: true,
      updated_at: true,
      booth_item_url: true,
    },
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col">
      <header>
        <h1 className="text-sub-heading text-charcoal">{m.pageTitle}</h1>
        <p className="mt-1 text-body text-muted">{m.pageDescription}</p>
      </header>

      {/* 絞り込みはピル型ボタン (ANP と同じ作法)。 */}
      <nav aria-label={m.colStatus} className="mt-space-relaxed flex flex-wrap gap-2" data-testid="tdp-status-filter">
        <Link
          href="/products"
          aria-current={status === null ? 'page' : undefined}
          className={cn(
            'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
            status === null
              ? 'border-charcoal bg-charcoal text-cream-light'
              : 'border-border-warm bg-cream-light text-charcoal-82 hover:bg-charcoal-04',
          )}
        >
          {m.filterAll}
        </Link>
        {PRODUCT_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/products?status=${s}`}
            aria-current={status === s ? 'page' : undefined}
            className={cn(
              'rounded-pill border px-3 py-1 text-button-sm no-underline transition-colors',
              status === s
                ? 'border-charcoal bg-charcoal text-cream-light'
                : 'border-border-warm bg-cream-light text-charcoal-82 hover:bg-charcoal-04',
            )}
          >
            {messages.productStatus[s] ?? s}
          </Link>
        ))}
      </nav>

      {products.length === 0 ? (
        <div className="mt-space-loose">
          <p className="text-body text-muted">{m.empty}</p>
          <p className="mt-1 text-caption text-muted">{m.emptyHint}</p>
        </div>
      ) : (
        <table className="mt-space-loose w-full border-collapse text-left" data-testid="tdp-products-table">
          <thead>
            <tr className="border-y border-border-warm text-caption text-charcoal-40">
              <th scope="col" className="px-space-tight py-space-snug font-medium">
                {m.colTitle}
              </th>
              <th scope="col" className="px-space-tight py-space-snug font-medium">
                {m.colKind}
              </th>
              <th scope="col" className="px-space-tight py-space-snug font-medium">
                {m.colStatus}
              </th>
              <th scope="col" className="px-space-tight py-space-snug text-right font-medium">
                {m.colPrice}
              </th>
              <th scope="col" className="px-space-tight py-space-snug text-right font-medium">
                {m.colUpdated}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-warm border-b border-border-warm">
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-charcoal-03">
                <td className="px-space-tight py-space-relaxed text-button-sm text-charcoal">
                  {p.booth_item_url ? (
                    <a
                      href={p.booth_item_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                </td>
                <td className="px-space-tight py-space-relaxed text-button-sm text-charcoal-82">
                  {messages.productKind[p.kind] ?? p.kind}
                </td>
                <td className="px-space-tight py-space-relaxed text-button-sm text-charcoal-82">
                  {messages.productStatus[p.status] ?? p.status}
                </td>
                <td className="px-space-tight py-space-relaxed text-right tabular-nums text-button-sm text-charcoal-82">
                  {p.price_jpy === null ? m.noPrice : `¥${p.price_jpy.toLocaleString('ja-JP')}`}
                </td>
                <td className="px-space-tight py-space-relaxed text-right tabular-nums text-caption text-muted">
                  {formatJst(p.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// DB を読むページは常に動的レンダリング。
export const dynamic = 'force-dynamic';
