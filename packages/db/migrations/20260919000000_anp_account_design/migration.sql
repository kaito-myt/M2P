-- docs/11-anp-design.md §3.1/§6/§7 F-ANP-01/03: note アカウント設計 (NoteAccountDesign)。
-- 本番 `_prisma_migrations` 履歴の既知の不整合 (docs/11 §7 申し送り14) に合わせ、
-- 新規テーブルも IF NOT EXISTS で冪等に書く (raw SQL 直接適用 + migrate resolve 運用を想定)。
CREATE TABLE IF NOT EXISTS "note_account_designs" (
    "id" TEXT NOT NULL,
    "brief_json" JSONB NOT NULL,
    "design_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "error" TEXT,
    "note_account_id" TEXT,
    "avatar_r2_key" TEXT,
    "header_r2_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_account_designs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "note_account_designs_status_time_idx"
    ON "note_account_designs"("status", "created_at" DESC);

DO $$ BEGIN
    ALTER TABLE "note_account_designs"
        ADD CONSTRAINT "note_account_designs_note_account_id_fkey"
        FOREIGN KEY ("note_account_id") REFERENCES "note_accounts"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
