-- docs/11-anp-design.md §3.4 F-ANP-32: アカウント別・媒体別の販促施策 (X / Instagram / TikTok / ブログ)。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "promotion_policy_json" JSONB NOT NULL DEFAULT '{}';

-- docs/11-anp-design.md §5.4: 運営者が /settings (モデル設定) で作成するカスタム AI ロールの表示名・説明。
-- プロンプト本体は prompts (role='anp.<slug>')、モデル割当は model_assignments に持つ。
CREATE TABLE IF NOT EXISTS "anp_agent_roles" (
  "role"        TEXT PRIMARY KEY,
  "label"       TEXT NOT NULL,
  "description" TEXT,
  "created_by"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL
);
