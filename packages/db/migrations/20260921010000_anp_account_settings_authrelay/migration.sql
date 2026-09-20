-- docs/11-anp-design.md §3.1/§3.3/§6/§7 F-ANP-17 (アカウント別パイプライン設定) /
-- F-ANP-21 (note 認証リレー)。
-- 本番 `_prisma_migrations` 履歴の既知の不整合 (docs/11 §7 申し送り14) に合わせ、
-- 冪等 (IF NOT EXISTS) に書く (raw SQL 直接適用 + migrate resolve 運用を想定)。

-- F-ANP-17: アカウント別のパイプライン自動パス設定 (未指定キーはグローバル AppSettings に従う)。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "settings_json" JSONB NOT NULL DEFAULT '{}';

-- F-ANP-21: セッション失効検知 → 運営者通知 → 再取込導線のための認証リレー台帳拡張。
ALTER TABLE "note_auth_requests" ADD COLUMN IF NOT EXISTS "note_account_id" TEXT;
ALTER TABLE "note_auth_requests" ADD COLUMN IF NOT EXISTS "fulfilled_at" TIMESTAMP(3);
ALTER TABLE "note_auth_requests" ADD COLUMN IF NOT EXISTS "consumed_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "note_auth_requests_account_kind_status_idx"
    ON "note_auth_requests"("note_account_id", "purpose", "status");

DO $$ BEGIN
    ALTER TABLE "note_auth_requests"
        ADD CONSTRAINT "note_auth_requests_note_account_id_fkey"
        FOREIGN KEY ("note_account_id") REFERENCES "note_accounts"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
