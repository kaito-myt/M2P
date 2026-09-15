-- docs/11-anp-design.md §7 Phase3: F-ANP-30 SNS 販促 / F-ANP-40 売上・フォロワー取得。
ALTER TABLE "promotion_posts" ADD COLUMN IF NOT EXISTS "note_article_id" TEXT;
CREATE INDEX IF NOT EXISTS "promotion_posts_note_article_id_idx" ON "promotion_posts"("note_article_id");

ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "followers_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "note_accounts" ADD COLUMN IF NOT EXISTS "followers_fetched_at" TIMESTAMP(3);
