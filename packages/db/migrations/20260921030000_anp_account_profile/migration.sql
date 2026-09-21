-- docs/11-anp-design.md §3.1/§7 F-ANP-05: note アカウント詳細でのプロフィール素材 (bio / アイコン / カバー) 生成。
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "avatar_r2_key" TEXT;
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "header_r2_key" TEXT;
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "profile_generated_at" TIMESTAMP(3);
