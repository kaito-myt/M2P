-- docs/11-anp-design.md §3.1/§7 F-ANP-04: note アカウント戦略の AI 相談 (NoteAccountConsultation /
-- NoteAccountConsultationMessage) と、設計案→相談の紐付け (note_account_designs.consultation_id)。
-- 本番 `_prisma_migrations` 履歴の既知の不整合 (docs/11 §7 申し送り14) に合わせ IF NOT EXISTS で冪等に書く。
CREATE TABLE IF NOT EXISTS "note_account_consultations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "brief_draft_json" JSONB,
    "ready_to_design" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_account_consultations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "note_account_consultations_status_time_idx"
    ON "note_account_consultations"("status", "updated_at" DESC);

CREATE TABLE IF NOT EXISTS "note_account_consultation_messages" (
    "id" TEXT NOT NULL,
    "consultation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "error" TEXT,
    "research_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_account_consultation_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "note_account_consultation_messages_time_idx"
    ON "note_account_consultation_messages"("consultation_id", "created_at");

DO $$ BEGIN
    ALTER TABLE "note_account_consultation_messages"
        ADD CONSTRAINT "note_account_consultation_messages_consultation_id_fkey"
        FOREIGN KEY ("consultation_id") REFERENCES "note_account_consultations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "note_account_designs" ADD COLUMN IF NOT EXISTS "consultation_id" TEXT;

CREATE INDEX IF NOT EXISTS "note_account_designs_consultation_idx"
    ON "note_account_designs"("consultation_id");

DO $$ BEGIN
    ALTER TABLE "note_account_designs"
        ADD CONSTRAINT "note_account_designs_consultation_id_fkey"
        FOREIGN KEY ("consultation_id") REFERENCES "note_account_consultations"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
