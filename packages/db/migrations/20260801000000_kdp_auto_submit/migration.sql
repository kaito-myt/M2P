-- F-041 Phase3: サーバー側自動入稿(kdp.submit)の自動運用トグル。
ALTER TABLE "app_settings"
  ADD COLUMN "kdp_auto_submit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kdp_auto_submit_cron" TEXT NOT NULL DEFAULT '*/30 * * * *',
  ADD COLUMN "kdp_submit_dry_run" BOOLEAN NOT NULL DEFAULT false;
