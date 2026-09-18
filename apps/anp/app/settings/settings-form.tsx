'use client';

import { useState, useTransition } from 'react';

import { updateAnpSettings } from '@/app/actions/settings';
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
    <div className="flex flex-col gap-space-relaxed">
      <label className="flex items-start gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <input
          type="checkbox"
          checked={autoPublish}
          disabled={isPending}
          onChange={(e) => {
            setAutoPublish(e.target.checked);
            save({ anp_auto_publish_enabled: e.target.checked });
          }}
          className="mt-1"
        />
        <span>
          <span className="block text-body font-medium text-charcoal">
            {messages.settings.autoPublishEnabled}
          </span>
          <span className="block text-caption text-muted">
            {messages.settings.autoPublishEnabledDescription}
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <input
          type="checkbox"
          checked={dryRun}
          disabled={isPending}
          onChange={(e) => {
            setDryRun(e.target.checked);
            save({ anp_publish_dry_run: e.target.checked });
          }}
          className="mt-1"
        />
        <span>
          <span className="block text-body font-medium text-charcoal">{messages.settings.dryRun}</span>
          <span className="block text-caption text-muted">{messages.settings.dryRunDescription}</span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <input
          type="checkbox"
          checked={autoTheme}
          disabled={isPending}
          onChange={(e) => {
            setAutoTheme(e.target.checked);
            save({ anp_auto_theme_enabled: e.target.checked });
          }}
          className="mt-1"
        />
        <span>
          <span className="block text-body font-medium text-charcoal">
            {messages.settings.autoThemeEnabled}
          </span>
          <span className="block text-caption text-muted">
            {messages.settings.autoThemeEnabledDescription}
          </span>
        </span>
      </label>

      <label className="flex items-center gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <span className="text-body font-medium text-charcoal">{messages.settings.themesPerDay}</span>
        <input
          type="number"
          min={1}
          max={20}
          value={themesPerDay}
          disabled={isPending}
          onChange={(e) => setThemesPerDay(Number(e.target.value))}
          onBlur={() => save({ anp_themes_per_day: themesPerDay })}
          className="w-20 rounded-card border border-border-warm bg-white px-2 py-1 text-body text-charcoal disabled:opacity-50"
        />
      </label>

      <label className="flex items-start gap-3 rounded-container border border-border-warm bg-cream-light p-space-relaxed">
        <input
          type="checkbox"
          checked={autopass}
          disabled={isPending}
          onChange={(e) => {
            setAutopass(e.target.checked);
            save({ anp_autopass_enabled: e.target.checked });
          }}
          className="mt-1"
        />
        <span>
          <span className="block text-body font-medium text-charcoal">
            {messages.settings.autopassEnabled}
          </span>
          <span className="block text-caption text-muted">
            {messages.settings.autopassEnabledDescription}
          </span>
        </span>
      </label>

      {saved && !error && <p className="text-caption text-muted">{messages.settings.saved}</p>}
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  );
}
