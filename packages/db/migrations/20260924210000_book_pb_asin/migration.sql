-- F-097b: ペーパーバック版の ASIN (Kindle 版とは別採番)。本棚同期で書き戻す。
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_asin" TEXT;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_status_checked_at" TIMESTAMP(3);
