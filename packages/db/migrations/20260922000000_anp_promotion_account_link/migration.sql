-- docs/11-anp-design.md §3.4 F-ANP-33: note アカウントごとの販促 SNS アカウント連携。
ALTER TABLE "promotion_accounts" ADD COLUMN IF NOT EXISTS "note_account_id" TEXT;
DO $$ BEGIN
  ALTER TABLE "promotion_accounts" ADD CONSTRAINT "promotion_accounts_note_account_id_fkey"
    FOREIGN KEY ("note_account_id") REFERENCES "note_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "promotion_accounts_note_account_channel_idx" ON "promotion_accounts"("note_account_id", "channel");
