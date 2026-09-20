'use client';

/**
 * S-030 AdsPeriodSelector — 当月 / 先月 / 直近30日 の期間切替。
 *
 * sales-filter-bar.tsx (S-017) と同じ「searchParams 更新 → RSC 再実行」方式。
 */
import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { messages } from '@/lib/messages';
import type { AdsPeriod } from '@/lib/ads-core';

const m = messages.ads.period;

const OPTIONS: Array<{ value: AdsPeriod; label: string }> = [
  { value: 'current', label: m.current },
  { value: 'prev', label: m.prev },
  { value: 'last30', label: m.last30 },
];

export function AdsPeriodSelector({ currentPeriod }: { currentPeriod: AdsPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const onSelect = useCallback(
    (value: AdsPeriod) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'current') {
        params.delete('period');
      } else {
        params.set('period', value);
      }
      startTransition(() => {
        router.push(`${pathname}?${params.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <div
      className="inline-flex items-center gap-1 rounded-card border border-border-warm bg-cream-light p-1"
      role="tablist"
      data-testid="ads-period-selector"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={currentPeriod === opt.value}
          disabled={isPending}
          onClick={() => onSelect(opt.value)}
          data-testid={`ads-period-${opt.value}`}
          className={
            currentPeriod === opt.value
              ? 'cursor-pointer rounded-default bg-charcoal px-3 py-1 text-button-sm text-cream-light'
              : 'cursor-pointer rounded-default px-3 py-1 text-button-sm text-charcoal hover:bg-charcoal-04'
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
