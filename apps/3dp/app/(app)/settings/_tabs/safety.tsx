import { TDP_MONTHLY_LIMIT_DEFAULT } from '@a2p/contracts/tdp/settings';

import { messages } from '@/lib/messages';
import { proposalState } from '@/lib/settings-groups-core';
import { buildFieldViews } from '@/lib/settings-tabs-core';
import type { TdpSettings } from '@/lib/tdp-settings';

import { DenylistForm } from '../denylist-form';
import { LimitForm } from '../limit-form';
import { GroupForm } from './group-form';
import { SafetyU9U10 } from './safety-u9u10';
import { TabIntro } from './tab-intro';

const m = messages.settings;

/** 画面に出す「常時有効な判定」。derivative-guard.ts の DerivativeRiskKind と対応。 */
const BUILTIN_KINDS = [
  'style_imitation',
  'fan_work_wording',
  'specific_avatar_fit',
  'creator_reference',
  'denylisted_term',
  'trademark_marker',
] as const;

/** 月間枠は LimitForm が持つ (媒体別 + 合計 + 天井の表示が要る) ので、汎用フォームからは外す。 */
const BOOTH_KEY = 'tdp_monthly_publish_limit';
const JINXXY_KEY = 'tdp_jinxxy_monthly_limit';

export function SafetyTab({
  settings,
  listedThisMonth,
  readOnly,
}: {
  settings: TdpSettings;
  /** null = 取得できなかった */
  listedThisMonth: number | null;
  readOnly: boolean;
}) {
  const limit = settings.tdp_monthly_publish_limit ?? TDP_MONTHLY_LIMIT_DEFAULT;

  return (
    <div className="flex flex-col">
      <TabIntro group="safety" settings={settings} readOnly={readOnly} />

      {/* R-1 月間出品上限 */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.limitTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.limitDescription}</p>
        <div className="mt-space-relaxed">
          <LimitForm
            initialLimit={limit}
            initialJinxxy={settings.tdp_jinxxy_monthly_limit}
            listedThisMonth={listedThisMonth}
            boothState={proposalState('safety', BOOTH_KEY, settings)}
            jinxxyState={proposalState('safety', JINXXY_KEY, settings)}
            readOnly={readOnly}
          />
        </div>
      </section>

      {/* 理由の文字数・枠の返却日数 */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.safetyValuesTitle}</h2>
        <div className="mt-space-relaxed">
          <GroupForm group="safety" fields={buildFieldViews('safety', settings, [BOOTH_KEY, JINXXY_KEY])} readOnly={readOnly} />
        </div>
      </section>

      {/* R-2 禁止語リスト */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.denylistTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.denylistDescription}</p>
        <div className="mt-space-relaxed">
          <DenylistForm initialTerms={[...settings.tdp_derivative_denylist]} readOnly={readOnly} />
        </div>
        <p className="mt-space-snug max-w-2xl text-caption text-muted">{m.denylistNote}</p>
      </section>

      {/* 常時有効な判定 (読み取り専用の説明) */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose">
        <h2 className="text-section-title text-charcoal">{m.builtinTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.builtinDescription}</p>

        <ul className="mt-space-relaxed divide-y divide-border-warm border-y border-border-warm">
          {BUILTIN_KINDS.map((kind) => (
            <li key={kind} className="flex flex-wrap items-baseline gap-x-space-snug px-space-tight py-space-relaxed">
              <code className="shrink-0 text-caption text-charcoal-40">{kind}</code>
              <span className="min-w-0 flex-1 text-button-sm text-charcoal-82">{messages.derivativeKinds[kind]}</span>
            </li>
          ))}
        </ul>

        <div className="mt-space-relaxed">
          <h3 className="text-button-sm font-medium text-charcoal">{messages.derivativeAllowed.title}</h3>
          <ul className="mt-1 list-disc pl-5 text-caption text-muted">
            <li>{messages.derivativeAllowed.styles}</li>
            <li>{messages.derivativeAllowed.platforms}</li>
          </ul>
        </div>
      </section>

      {/* BOOTH アカウント共用の注記 (常時) */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose" data-testid="tdp-shared-account-note">
        <h2 className="text-section-title text-charcoal">{m.sharedAccountTitle}</h2>
        <p className="mt-1 max-w-2xl text-caption text-muted">{m.sharedAccountNote}</p>
      </section>

      {/* U-9 / U-10 の回答 (F-3DP-42。初回の出品の前に必須) */}
      <section className="mt-space-loose border-t border-border-warm pt-space-loose" data-testid="tdp-u9u10-section">
        <h2 className="text-section-title text-charcoal">{m.u9u10.title}</h2>
        <div className="mt-space-relaxed">
          <SafetyU9U10 u9={settings.u9} u10={settings.u10} readOnly={readOnly} />
        </div>
      </section>
    </div>
  );
}
