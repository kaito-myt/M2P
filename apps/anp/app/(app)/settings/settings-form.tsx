'use client';

/**
 * SettingsForm — 運用設定 (全体の既定)。On/Off はトグル (運営者要望 2026-09-21)。
 * 1 日のテーマ作成数はアカウントごとに設定する方針のため、ここは「アカウント未設定時の全体既定」のみ。
 */
import { useState, useTransition } from 'react';

import { updateAnpSettings } from '@/app/actions/settings';
import { Switch } from '@/components/switch';
import { messages } from '@/lib/messages';

interface SettingsFormProps {
  initial: {
    anp_auto_publish_enabled: boolean;
    anp_publish_dry_run: boolean;
    anp_auto_theme_enabled: boolean;
    anp_themes_per_day: number;
    anp_autopass_enabled: boolean;
  };
}

type SettingsPatch = Partial<SettingsFormProps['initial']>;

const m = messages.settings;

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
      <div className="min-w-0">
        <p className="text-body font-medium text-charcoal">{label}</p>
        <p className="mt-0.5 text-caption text-muted">{description}</p>
      </div>
      <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} testId={testId} />
    </div>
  );
}

export function SettingsForm({ initial }: SettingsFormProps) {
  const [autoPublish, setAutoPublish] = useState(initial.anp_auto_publish_enabled);
  const [dryRun, setDryRun] = useState(initial.anp_publish_dry_run);
  const [autoTheme, setAutoTheme] = useState(initial.anp_auto_theme_enabled);
  const [themesPerDay, setThemesPerDay] = useState(initial.anp_themes_per_day);
  const [autopass, setAutopass] = useState(initial.anp_autopass_enabled);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const save = (next: SettingsPatch) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateAnpSettings(next);
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
  };

  return (
    <div className="flex flex-col gap-space-snug" data-testid="ops-settings">
      <ToggleRow
        label={m.autoThemeEnabled}
        description={m.autoThemeEnabledDescription}
        checked={autoTheme}
        disabled={isPending}
        onChange={(v) => {
          setAutoTheme(v);
          save({ anp_auto_theme_enabled: v });
        }}
        testId="ops-toggle-auto-theme"
      />
      <div className="flex items-center justify-between gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <div className="min-w-0">
          <p className="text-body font-medium text-charcoal">{m.themesPerDay}</p>
          <p className="mt-0.5 text-caption text-muted">{m.themesPerDayDescription}</p>
        </div>
        <input
          type="number"
          min={1}
          max={20}
          value={themesPerDay}
          disabled={isPending}
          onChange={(e) => setThemesPerDay(Number(e.target.value))}
          onBlur={() => save({ anp_themes_per_day: themesPerDay })}
          className="w-20 rounded-card border border-border-warm bg-white px-2 py-1 text-right text-body text-charcoal disabled:opacity-50"
          data-testid="ops-themes-per-day"
        />
      </div>
      <ToggleRow
        label={m.autopassEnabled}
        description={m.autopassEnabledDescription}
        checked={autopass}
        disabled={isPending}
        onChange={(v) => {
          setAutopass(v);
          save({ anp_autopass_enabled: v });
        }}
        testId="ops-toggle-autopass"
      />
      <ToggleRow
        label={m.autoPublishEnabled}
        description={m.autoPublishEnabledDescription}
        checked={autoPublish}
        disabled={isPending}
        onChange={(v) => {
          setAutoPublish(v);
          save({ anp_auto_publish_enabled: v });
        }}
        testId="ops-toggle-auto-publish"
      />
      <ToggleRow
        label={m.dryRun}
        description={m.dryRunDescription}
        checked={dryRun}
        disabled={isPending}
        onChange={(v) => {
          setDryRun(v);
          save({ anp_publish_dry_run: v });
        }}
        testId="ops-toggle-dry-run"
      />

      {saved && !error && <p className="text-caption text-muted">{m.saved}</p>}
      {error && (
        <p role="alert" className="text-caption text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
