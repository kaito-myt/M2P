'use client';

/**
 * F-ANP-17 (docs/11-anp-design.md §3.1/§7): アカウント別パイプライン自動パス設定フォーム。
 * `note_accounts.settings_json` を編集する。各項目は「グローバルに従う/有効/無効」の
 * tri-state で、未指定 (グローバルに従う) がデフォルト。
 */
import { useState, useTransition } from 'react';

import { updateAccountSettings } from '@/app/actions/accounts';
import { messages } from '@/lib/messages';

type TriState = 'global' | 'on' | 'off';

function toTriState(v: boolean | undefined): TriState {
  if (v === true) return 'on';
  if (v === false) return 'off';
  return 'global';
}

interface AccountSettingsFormProps {
  noteAccountId: string;
  initial: {
    auto_theme_enabled?: boolean;
    themes_per_day?: number;
    autopass_enabled?: boolean;
    auto_publish_enabled?: boolean;
    tiktok_enabled?: boolean;
  };
}

const m = messages.accountDetail.accountSettings;

function TriSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-body text-charcoal">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as TriState)}
        className="rounded-card border border-border-warm bg-white px-2 py-1 text-body text-charcoal disabled:opacity-50"
      >
        <option value="global">{m.triState.global}</option>
        <option value="on">{m.triState.on}</option>
        <option value="off">{m.triState.off}</option>
      </select>
    </label>
  );
}

export function AccountSettingsForm({ noteAccountId, initial }: AccountSettingsFormProps) {
  const [autoTheme, setAutoTheme] = useState<TriState>(toTriState(initial.auto_theme_enabled));
  const [themesPerDay, setThemesPerDay] = useState(
    initial.themes_per_day != null ? String(initial.themes_per_day) : '',
  );
  const [autopass, setAutopass] = useState<TriState>(toTriState(initial.autopass_enabled));
  const [autoPublish, setAutoPublish] = useState<TriState>(toTriState(initial.auto_publish_enabled));
  const [tiktok, setTiktok] = useState<TriState>(toTriState(initial.tiktok_enabled));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const save = (overrides: Partial<{ autoTheme: TriState; themesPerDay: string; autopass: TriState; autoPublish: TriState; tiktok: TriState }> = {}) => {
    setError(null);
    setSaved(false);
    const next = {
      auto_theme_enabled: overrides.autoTheme ?? autoTheme,
      themes_per_day: overrides.themesPerDay ?? themesPerDay,
      autopass_enabled: overrides.autopass ?? autopass,
      auto_publish_enabled: overrides.autoPublish ?? autoPublish,
      tiktok_enabled: overrides.tiktok ?? tiktok,
    };
    startTransition(async () => {
      const result = await updateAccountSettings({
        note_account_id: noteAccountId,
        auto_theme_enabled: next.auto_theme_enabled,
        themes_per_day: next.themes_per_day,
        autopass_enabled: next.autopass_enabled,
        auto_publish_enabled: next.auto_publish_enabled,
        tiktok_enabled: next.tiktok_enabled,
      });
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-space-snug rounded-container border border-border-warm bg-cream-light p-space-relaxed">
      <div>
        <h3 className="text-body font-medium text-charcoal">{m.title}</h3>
        <p className="text-caption text-muted">{m.description}</p>
      </div>
      <TriSelect
        label={m.autoThemeEnabled}
        value={autoTheme}
        disabled={isPending}
        onChange={(v) => {
          setAutoTheme(v);
          save({ autoTheme: v });
        }}
      />
      <label className="flex items-center justify-between gap-3 text-body text-charcoal">
        <span>{m.themesPerDay}</span>
        <input
          type="number"
          min={1}
          max={20}
          value={themesPerDay}
          placeholder={m.themesPerDayPlaceholder}
          disabled={isPending}
          onChange={(e) => setThemesPerDay(e.target.value)}
          onBlur={() => save({ themesPerDay })}
          className="w-40 rounded-card border border-border-warm bg-white px-2 py-1 text-body text-charcoal disabled:opacity-50"
        />
      </label>
      <TriSelect
        label={m.autopassEnabled}
        value={autopass}
        disabled={isPending}
        onChange={(v) => {
          setAutopass(v);
          save({ autopass: v });
        }}
      />
      <TriSelect
        label={m.autoPublishEnabled}
        value={autoPublish}
        disabled={isPending}
        onChange={(v) => {
          setAutoPublish(v);
          save({ autoPublish: v });
        }}
      />
      <TriSelect
        label={m.tiktokEnabled}
        value={tiktok}
        disabled={isPending}
        onChange={(v) => {
          setTiktok(v);
          save({ tiktok: v });
        }}
      />
      {saved && !error && <p className="text-caption text-muted">{m.saved}</p>}
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  );
}
