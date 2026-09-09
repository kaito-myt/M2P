-- [F-091] note ブラウザ自動エンゲージ(フォロー/スキ)のマスタスイッチ。
-- note は IG/TikTok より制限が緩く凍結リスクが低いため既定 ON(キルスイッチ)。
ALTER TABLE "app_settings" ADD COLUMN "note_engage_enabled" BOOLEAN NOT NULL DEFAULT true;
