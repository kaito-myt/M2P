-- F-094b: 却下書籍の自動再申請(bw.retag.tick)の有効化フラグ
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "bw_retag_enabled" BOOLEAN NOT NULL DEFAULT false;
