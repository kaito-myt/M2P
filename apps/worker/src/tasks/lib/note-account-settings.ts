/**
 * F-ANP-17 (docs/11-anp-design.md §3.2/§7) — アカウント別パイプライン自動パス設定の解決。
 *
 * `note_accounts.settings_json` (`NoteAccountSettingsSchema`) の各キーは未指定ならグローバル
 * `AppSettings` (`AnpAutopassFlags` / `anp_auto_publish_enabled`) に従う。`note.theme.auto` /
 * `note.publish.dispatch` がアカウントごとの実効値を計算する際に使う。
 */
import { parseNoteAccountSettings } from '@a2p/contracts/agents/anp';

import type { AnpAutopassFlags } from './anp-autopass.js';

export interface EffectiveThemeAutoSettings {
  auto_theme_enabled: boolean;
  themes_per_day: number;
  autopass_enabled: boolean;
}

/** `note.theme.auto` 用: グローバル既定値をアカウント別 settings_json で上書きした実効値。 */
export function resolveThemeAutoSettings(
  accountSettingsJson: unknown,
  global: AnpAutopassFlags,
): EffectiveThemeAutoSettings {
  const s = parseNoteAccountSettings(accountSettingsJson);
  return {
    auto_theme_enabled: s.auto_theme_enabled ?? global.anp_auto_theme_enabled,
    themes_per_day: s.themes_per_day ?? global.anp_themes_per_day,
    autopass_enabled: s.autopass_enabled ?? global.anp_autopass_enabled,
  };
}

/** `note.publish.dispatch` 用: グローバル既定値をアカウント別 settings_json で上書きした実効値。 */
export function resolveAutoPublishEnabled(accountSettingsJson: unknown, globalEnabled: boolean): boolean {
  const s = parseNoteAccountSettings(accountSettingsJson);
  return s.auto_publish_enabled ?? globalEnabled;
}

/** `promotion.note.article` 用: TikTok 連動動画を作るか (既定 OFF、グローバル設定は無くアカウント単位のみ)。 */
export function resolveTiktokEnabled(accountSettingsJson: unknown): boolean {
  const s = parseNoteAccountSettings(accountSettingsJson);
  return s.tiktok_enabled ?? false;
}
