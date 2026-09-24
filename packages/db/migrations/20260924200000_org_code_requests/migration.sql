-- F-098: CEO が「ソースコードをこう変えたい」と起票するテーブル。
-- worker は本番コンテナで動いておりリポジトリを書き換えられないため、要求を残して
-- 運営者 (または開発エージェント) が実装する。会話で完結させるための受け皿。
CREATE TABLE IF NOT EXISTS "org_code_requests" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "files_json" JSONB NOT NULL DEFAULT '[]',
  "change_summary" TEXT NOT NULL,
  "urgency" TEXT NOT NULL DEFAULT 'normal',
  -- open | in_progress | done | rejected
  "status" TEXT NOT NULL DEFAULT 'open',
  "source_message_id" TEXT,
  "resolution_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "org_code_requests_status_idx" ON "org_code_requests" ("status", "created_at" DESC);
