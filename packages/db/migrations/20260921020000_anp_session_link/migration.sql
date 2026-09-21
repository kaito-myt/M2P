-- docs/11-anp-design.md §3.1/§7 F-ANP-20: ANP UI からの note セッション連携 (Cookie 貼り付け)。
-- 連携日時と経路を持たせ、UI に「連携済み (日時)」を出す。IF NOT EXISTS で冪等。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "session_linked_at" TIMESTAMP(3);
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "session_source" TEXT;
