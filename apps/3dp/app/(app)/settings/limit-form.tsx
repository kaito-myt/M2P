'use client';

/**
 * 月間出品上限 (R-1) の編集。BOOTH と Jinxxy の枠を別々に入れ、合計も出す。
 * 各枠にも合計にも天井 (TDP_MONTHLY_LIMIT_HARD_MAX) があり、判定はサーバーが持つ。
 *
 * 拒否されたときの文面はサーバーが返す: 「保存されていない入力値」ではなく
 * DB に入っている (実際に効いている) 現在値を添える。ここで組み立て直さない。
 * 残枠と表示上限は `buildQuotaView` (= computeSlots で天井を掛けた値) だけを使う。
 * DB に天井超えの値が残っていても、ホームと同じ実効上限を言う。
 */
import { useEffect, useState, useTransition } from 'react';

import { updateMonthlyPublishLimit } from '@/app/actions/settings';
import { ProposedValueBadge } from '@/components/proposed-value-badge';
import { buildQuotaView } from '@/lib/home-core';
import { messages } from '@/lib/messages';
import { MONTHLY_LIMIT_MIN, TDP_MONTHLY_LIMIT_HARD_MAX } from '@/lib/settings-core';
import type { ProposalState } from '@/lib/settings-groups-core';
import { parseFieldInput, refusalMessage } from '@/lib/settings-tabs-core';

const m = messages.settings;
const inputClass =
  'w-24 rounded-default border border-border-warm bg-cream-light px-2.5 py-1.5 text-right text-body text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function LimitForm({
  initialLimit,
  initialJinxxy,
  listedThisMonth,
  boothState,
  jinxxyState,
  readOnly,
}: {
  initialLimit: number;
  initialJinxxy: number;
  /** null = 当月の出品数を取得できなかった */
  listedThisMonth: number | null;
  boothState: ProposalState;
  jinxxyState: ProposalState;
  readOnly: boolean;
}) {
  const [booth, setBooth] = useState(String(initialLimit));
  const [jinxxy, setJinxxy] = useState(String(initialJinxxy));
  const [saved, setSaved] = useState({ booth: initialLimit, jinxxy: initialJinxxy });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [isPending, startTransition] = useTransition();

  // サーバー側の値が変わったら (別タブでの保存など) 入力欄も合わせる。
  useEffect(() => {
    setBooth(String(initialLimit));
    setJinxxy(String(initialJinxxy));
    setSaved({ booth: initialLimit, jinxxy: initialJinxxy });
  }, [initialLimit, initialJinxxy]);

  const boothDirty = booth.trim() !== String(saved.booth);
  const jinxxyDirty = jinxxy.trim() !== String(saved.jinxxy);
  const quota = listedThisMonth === null ? null : buildQuotaView({ listedThisMonth, monthlyLimit: saved.booth });

  const save = () => {
    setError(null);
    setOk(false);
    const input: { booth?: unknown; jinxxy?: unknown } = {};
    if (boothDirty) input.booth = parseFieldInput(booth, false);
    if (jinxxyDirty) input.jinxxy = parseFieldInput(jinxxy, false);
    startTransition(async () => {
      const result = await updateMonthlyPublishLimit(input as { booth?: number; jinxxy?: number });
      if (!result.ok) {
        setError(refusalMessage(result.refusals, result.error));
        return;
      }
      setSaved(result.data);
      setOk(true);
    });
  };

  const total = saved.booth + saved.jinxxy;

  return (
    <div className="flex flex-col gap-space-snug" data-testid="tdp-limit-form">
      <div className="flex flex-wrap items-end gap-space-relaxed">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{m.limit.boothLabel}</span>
          <span className="flex items-center gap-space-snug">
            <input
              type="number"
              min={MONTHLY_LIMIT_MIN}
              max={TDP_MONTHLY_LIMIT_HARD_MAX}
              value={booth}
              disabled={readOnly || isPending}
              onChange={(e) => setBooth(e.target.value)}
              className={inputClass}
              data-testid="tdp-limit-input"
            />
            <ProposedValueBadge state={boothState} testId="tdp-badge-tdp_monthly_publish_limit" />
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-muted">{m.limit.jinxxyLabel}</span>
          <span className="flex items-center gap-space-snug">
            <input
              type="number"
              min={MONTHLY_LIMIT_MIN}
              max={TDP_MONTHLY_LIMIT_HARD_MAX}
              value={jinxxy}
              disabled={readOnly || isPending}
              onChange={(e) => setJinxxy(e.target.value)}
              className={inputClass}
              data-testid="tdp-limit-jinxxy-input"
            />
            <ProposedValueBadge state={jinxxyState} testId="tdp-badge-tdp_jinxxy_monthly_limit" />
          </span>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={readOnly || isPending || (!boothDirty && !jinxxyDirty)}
          className="h-[38px] rounded-default border border-border-warm bg-cream-light px-4 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="tdp-limit-save"
        >
          {isPending ? m.group.saving : messages.common.save}
        </button>
      </div>

      <p className="text-caption text-muted" data-testid="tdp-limit-total">
        {m.limit.total(total)} / {TDP_MONTHLY_LIMIT_HARD_MAX}
      </p>
      <p className="text-caption text-muted" data-testid="tdp-limit-ceiling">
        {m.limitCeilingNote(TDP_MONTHLY_LIMIT_HARD_MAX)}
      </p>
      <p className="text-caption text-muted">{m.limit.shareNote}</p>

      <p className="text-caption text-muted" data-testid="tdp-limit-remaining">
        {quota === null || listedThisMonth === null ? (
          m.limit.unavailable
        ) : (
          <>
            {m.limitListedPrefix} {listedThisMonth} / {quota.limit}
            {' — '}
            {quota.remaining > 0 ? (
              <>
                {m.limitRemainingPrefix} <span className="font-medium text-charcoal">{quota.remaining}</span>{' '}
                {m.limitRemainingSuffix}
              </>
            ) : (
              <span className="font-medium text-accent">{m.limitExhausted}</span>
            )}
          </>
        )}
      </p>

      {saved.booth > TDP_MONTHLY_LIMIT_HARD_MAX && (
        <p className="text-caption text-destructive" data-testid="tdp-limit-clamped">
          {m.limit.clamped(saved.booth, TDP_MONTHLY_LIMIT_HARD_MAX)}
        </p>
      )}

      {ok && !error && (
        <p className="text-caption text-muted" data-testid="tdp-limit-success">
          {messages.common.saved}
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-line text-caption text-destructive" data-testid="tdp-limit-error">
          {error}
        </p>
      )}
    </div>
  );
}
