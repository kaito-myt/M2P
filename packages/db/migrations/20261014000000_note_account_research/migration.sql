-- F-ANP-56: アカウント別 週次リサーチ (note.account.research) の成果を保存する。
-- NoteAccountResearch (packages/contracts/src/agents/anp.ts) をそのまま入れる。
-- 各 ANP エージェントのプロンプトへ実行時注入される (役割プロンプト本文は共有なので書き換えない)。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "research_json" JSONB;
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "research_updated_at" TIMESTAMP(3);
