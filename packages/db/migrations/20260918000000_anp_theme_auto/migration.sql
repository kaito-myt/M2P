-- docs/11-anp-design.md §7 Phase4 F-ANP-17: note.theme.auto (日次テーマ自動生成+自動パス)。
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_auto_theme_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_themes_per_day" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_theme_cron" TEXT NOT NULL DEFAULT '0 23 * * *';
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_autopass_enabled" BOOLEAN NOT NULL DEFAULT false;
