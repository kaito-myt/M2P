-- docs/11-anp-design.md §7 Phase2: note.publish.dispatch のマスタスイッチ + ドライラン既定。
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_auto_publish_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "anp_publish_dry_run" BOOLEAN NOT NULL DEFAULT true;
