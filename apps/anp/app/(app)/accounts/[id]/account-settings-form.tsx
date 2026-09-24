'use client';

/**
 * F-ANP-17 / F-ANP-08 (docs/11-anp-design.md §3.1/§7): アカウント設定パネル。
 *
 * 運営者要望 (2026-09-21)「アカウント詳細ページで無料公開の割合の設定とか、各種設定できるようにしといてね」
 * 「On/Off は基本トグルで」「1 日のテーマ作成数は各アカウントで設定するようにしましょう」への対応。
 *
 * - 自動運転: 各項目はトグル。未設定 (個別設定なし) の間は全体設定 (/settings 運用設定) の値を表示し
 *   「全体設定に従う」チップを出す。トグルを触るとこのアカウント専用の値になり、「全体設定に戻す」で解除できる。
 *   `note_accounts.settings_json` (`NoteAccountSettingsSchema`) に保存。
 * - 1 日のテーマ作成数: アカウントごとの値 (未設定なら全体既定)。
 * - 収益化: 有料記事の比率 / 有料記事の無料公開部分 / 価格帯 / メンバーシップ。
 *   `note_accounts.monetization_policy_json` (`NoteMonetizationPolicySchema`) に保存し、テーマ生成・執筆に注入。
 */
import { useState, useTransition } from 'react';

import { updateAccountMonetization, updateAccountSettings } from '@/app/actions/accounts';
import { Switch } from '@/components/switch';
import { messages } from '@/lib/messages';

type TriState = 'global' | 'on' | 'off';

function toTriState(v: boolean | undefined): TriState {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'global';
}

export interface AccountSettingsGlobals {
  auto_theme_enabled: boolean;
  themes_per_day: number;
  autopass_enabled: boolean;
  auto_publish_enabled: boolean;
}

export interface AccountMonetizationInitial {
  free_ratio: number;
  price_band?: [number, number] | undefined;
  membership: boolean;
  paid_ratio?: number | undefined;
}

interface AccountSettingsFormProps {
  noteAccountId: string;
  initial: {
    auto_theme_enabled?: boolean;
    themes_per_day?: number;
    autopass_enabled?: boolean;
    auto_publish_enabled?: boolean;
    tiktok_enabled?: boolean;
    paid_publish_enabled?: boolean;
  };
  globals: AccountSettingsGlobals;
  monetization: AccountMonetizationInitial;
}

const m = messages.accountDetail.accountSettings;
const mm = messages.accountDetail.monetization;

function OverrideToggle({
  label,
  description,
  value,
  globalValue,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  description?: string;
  value: TriState;
  /** 全体設定の値 (value='global' のときの実効値)。TikTok のように全体設定が無い項目は null。 */
  globalValue: boolean | null;
  disabled: boolean;
  onChange: (v: TriState) => void;
  testId: string;
}) {
  const effective = value === 'global' ? (globalValue ?? false) : value === 'on';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-body text-charcoal">{label}</p>
        {description && <p className="text-caption text-muted">{description}</p>}
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-caption">
          {value === 'global' && globalValue !== null ? (
            <span className="rounded-pill border border-border-warm bg-white px-2 py-0.5 text-muted">{m.followGlobal(globalValue)}</span>
          ) : value === 'global' ? (
            <span className="rounded-pill border border-border-warm bg-white px-2 py-0.5 text-muted">{m.notSet}</span>
          ) : (
            <>
              <span className="rounded-pill border border-charcoal/30 bg-white px-2 py-0.5 text-charcoal">{m.overridden}</span>
              {globalValue !== null && (
                <button type="button" onClick={() => onChange('global')} disabled={disabled} className="text-charcoal underline disabled:opacity-50">
                  {m.resetToGlobal}
                </button>
              )}
            </>
          )}
        </p>
      </div>
      <Switch checked={effective} disabled={disabled} label={label} onChange={(next) => onChange(next ? 'on' : 'off')} testId={testId} />
    </div>
  );
}

export function AccountSettingsForm({ noteAccountId, initial, globals, monetization }: AccountSettingsFormProps) {
  const [autoTheme, setAutoTheme] = useState<TriState>(toTriState(initial.auto_theme_enabled));
  const [themesPerDay, setThemesPerDay] = useState(initial.themes_per_day != null ? String(initial.themes_per_day) : '');
  const [autopass, setAutopass] = useState<TriState>(toTriState(initial.autopass_enabled));
  const [autoPublish, setAutoPublish] = useState<TriState>(toTriState(initial.auto_publish_enabled));
  const [tiktok, setTiktok] = useState<TriState>(toTriState(initial.tiktok_enabled));
  const [paidPublish, setPaidPublish] = useState<TriState>(toTriState(initial.paid_publish_enabled));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 収益化
  const [paidRatioOn, setPaidRatioOn] = useState(monetization.paid_ratio !== undefined);
  const [paidRatio, setPaidRatio] = useState(Math.round((monetization.paid_ratio ?? 0.3) * 100));
  const [freeRatio, setFreeRatio] = useState(Math.round(monetization.free_ratio * 100));
  const [priceMin, setPriceMin] = useState(String(monetization.price_band?.[0] ?? 100));
  const [priceMax, setPriceMax] = useState(String(monetization.price_band?.[1] ?? 1000));
  const [membership, setMembership] = useState(monetization.membership);
  const [monError, setMonError] = useState<string | null>(null);
  const [monSaved, setMonSaved] = useState(false);
  const [monPending, startMonTransition] = useTransition();

  const save = (overrides: Partial<{ autoTheme: TriState; themesPerDay: string; autopass: TriState; autoPublish: TriState; tiktok: TriState; paidPublish: TriState }> = {}) => {
    setError(null);
    setSaved(false);
    const next = {
      auto_theme_enabled: overrides.autoTheme ?? autoTheme,
      themes_per_day: overrides.themesPerDay ?? themesPerDay,
      autopass_enabled: overrides.autopass ?? autopass,
      auto_publish_enabled: overrides.autoPublish ?? autoPublish,
      tiktok_enabled: overrides.tiktok ?? tiktok,
      paid_publish_enabled: overrides.paidPublish ?? paidPublish,
    };
    startTransition(async () => {
      const result = await updateAccountSettings({ note_account_id: noteAccountId, ...next });
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  };

  const saveMonetization = (overrides: Partial<{ paidRatioOn: boolean; paidRatio: number; freeRatio: number; priceMin: string; priceMax: string; membership: boolean }> = {}) => {
    setMonError(null);
    setMonSaved(false);
    const on = overrides.paidRatioOn ?? paidRatioOn;
    const payload = {
      note_account_id: noteAccountId,
      paid_ratio: on ? (overrides.paidRatio ?? paidRatio) / 100 : null,
      free_ratio: (overrides.freeRatio ?? freeRatio) / 100,
      price_min: overrides.priceMin ?? priceMin,
      price_max: overrides.priceMax ?? priceMax,
      membership: overrides.membership ?? membership,
    };
    startMonTransition(async () => {
      const result = await updateAccountMonetization(payload);
      if (!result.ok) setMonError(result.error);
      else setMonSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-space-relaxed">
      {/* 自動運転 */}
      <section className="flex flex-col gap-space-snug rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="account-automation-settings">
        <div>
          <h3 className="text-card-title font-medium text-charcoal">{m.title}</h3>
          <p className="text-caption text-muted">{m.description}</p>
        </div>
        <OverrideToggle
          label={m.autoThemeEnabled}
          description={m.autoThemeDescription}
          value={autoTheme}
          globalValue={globals.auto_theme_enabled}
          disabled={isPending}
          onChange={(v) => {
            setAutoTheme(v);
            save({ autoTheme: v });
          }}
          testId="account-toggle-auto-theme"
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-body text-charcoal">{m.themesPerDay}</p>
            <p className="text-caption text-muted">{m.themesPerDayDescription(globals.themes_per_day)}</p>
          </div>
          <input
            type="number"
            min={1}
            max={20}
            value={themesPerDay}
            placeholder={String(globals.themes_per_day)}
            disabled={isPending}
            onChange={(e) => setThemesPerDay(e.target.value)}
            onBlur={() => save({ themesPerDay })}
            className="w-24 rounded-card border border-border-warm bg-white px-2 py-1 text-right text-body text-charcoal disabled:opacity-50"
            data-testid="account-themes-per-day"
          />
        </div>
        <OverrideToggle
          label={m.autopassEnabled}
          description={m.autopassDescription}
          value={autopass}
          globalValue={globals.autopass_enabled}
          disabled={isPending}
          onChange={(v) => {
            setAutopass(v);
            save({ autopass: v });
          }}
          testId="account-toggle-autopass"
        />
        <OverrideToggle
          label={m.autoPublishEnabled}
          description={m.autoPublishDescription}
          value={autoPublish}
          globalValue={globals.auto_publish_enabled}
          disabled={isPending}
          onChange={(v) => {
            setAutoPublish(v);
            save({ autoPublish: v });
          }}
          testId="account-toggle-auto-publish"
        />
        <OverrideToggle
          label={m.paidPublishEnabled}
          description={m.paidPublishDescription}
          value={paidPublish}
          globalValue={null}
          disabled={isPending}
          onChange={(v) => {
            setPaidPublish(v);
            save({ paidPublish: v });
          }}
          testId="account-toggle-paid-publish"
        />
        <OverrideToggle
          label={m.tiktokEnabled}
          description={m.tiktokDescription}
          value={tiktok}
          globalValue={null}
          disabled={isPending}
          onChange={(v) => {
            setTiktok(v);
            save({ tiktok: v });
          }}
          testId="account-toggle-tiktok"
        />
        {saved && !error && <p className="text-caption text-muted">{m.saved}</p>}
        {error && (
          <p role="alert" className="text-caption text-red-600">
            {error}
          </p>
        )}
      </section>

      {/* 収益化 */}
      <section className="flex flex-col gap-space-snug rounded-container border border-border-warm bg-cream-light p-space-relaxed" data-testid="account-monetization-settings">
        <div>
          <h3 className="text-card-title font-medium text-charcoal">{mm.title}</h3>
          <p className="text-caption text-muted">{mm.description}</p>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body text-charcoal">{mm.paidRatio}</p>
            <p className="text-caption text-muted">{mm.paidRatioDescription}</p>
          </div>
          <Switch
            checked={paidRatioOn}
            disabled={monPending}
            label={mm.paidRatio}
            onChange={(next) => {
              setPaidRatioOn(next);
              saveMonetization({ paidRatioOn: next });
            }}
            testId="account-toggle-paid-ratio"
          />
        </div>
        {paidRatioOn && (
          <label className="flex items-center gap-3 text-caption text-muted">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={paidRatio}
              disabled={monPending}
              onChange={(e) => setPaidRatio(Number(e.target.value))}
              onMouseUp={() => saveMonetization({ paidRatio })}
              onTouchEnd={() => saveMonetization({ paidRatio })}
              onKeyUp={() => saveMonetization({ paidRatio })}
              className="w-full accent-charcoal"
              aria-label={mm.paidRatio}
              data-testid="account-paid-ratio"
            />
            <span className="w-24 shrink-0 text-right text-body tabular-nums text-charcoal">{mm.ratioValue(paidRatio)}</span>
          </label>
        )}

        <div>
          <p className="text-body text-charcoal">{mm.freeRatio}</p>
          <p className="text-caption text-muted">{mm.freeRatioDescription}</p>
          <label className="mt-1 flex items-center gap-3 text-caption text-muted">
            <input
              type="range"
              min={5}
              max={95}
              step={5}
              value={freeRatio}
              disabled={monPending}
              onChange={(e) => setFreeRatio(Number(e.target.value))}
              onMouseUp={() => saveMonetization({ freeRatio })}
              onTouchEnd={() => saveMonetization({ freeRatio })}
              onKeyUp={() => saveMonetization({ freeRatio })}
              className="w-full accent-charcoal"
              aria-label={mm.freeRatio}
              data-testid="account-free-ratio"
            />
            <span className="w-24 shrink-0 text-right text-body tabular-nums text-charcoal">{mm.ratioValue(freeRatio)}</span>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-space-snug">
          <label className="flex flex-col gap-1 text-caption text-muted">
            {mm.priceMin}
            <input
              type="number"
              min={0}
              max={50000}
              step={100}
              value={priceMin}
              disabled={monPending}
              onChange={(e) => setPriceMin(e.target.value)}
              onBlur={() => saveMonetization({ priceMin })}
              className="w-32 rounded-card border border-border-warm bg-white px-2 py-1 text-right text-body text-charcoal disabled:opacity-50"
              data-testid="account-price-min"
            />
          </label>
          <label className="flex flex-col gap-1 text-caption text-muted">
            {mm.priceMax}
            <input
              type="number"
              min={0}
              max={50000}
              step={100}
              value={priceMax}
              disabled={monPending}
              onChange={(e) => setPriceMax(e.target.value)}
              onBlur={() => saveMonetization({ priceMax })}
              className="w-32 rounded-card border border-border-warm bg-white px-2 py-1 text-right text-body text-charcoal disabled:opacity-50"
              data-testid="account-price-max"
            />
          </label>
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body text-charcoal">{mm.membership}</p>
            <p className="text-caption text-muted">{mm.membershipDescription}</p>
          </div>
          <Switch
            checked={membership}
            disabled={monPending}
            label={mm.membership}
            onChange={(next) => {
              setMembership(next);
              saveMonetization({ membership: next });
            }}
            testId="account-toggle-membership"
          />
        </div>
        {monSaved && !monError && <p className="text-caption text-muted">{m.saved}</p>}
        {monError && (
          <p role="alert" className="text-caption text-red-600">
            {monError}
          </p>
        )}
      </section>
    </div>
  );
}
