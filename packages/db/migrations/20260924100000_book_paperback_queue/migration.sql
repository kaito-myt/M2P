-- F-097: ペーパーバック出版状態を DB で管理する (それまではローカルの
-- scripts/paperback/pb-published.txt / pb-drafted.txt が唯一の記録だったため、
-- 新刊が自動でペーパーバック化されず、93 冊中 12 冊しか出ていなかった)。
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_publish_status" TEXT NOT NULL DEFAULT 'unlisted';
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_publish_queued" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_publish_queued_at" TIMESTAMP(3);
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_drafted_at" TIMESTAMP(3);
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_submitted_at" TIMESTAMP(3);
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_submit_cooldown_until" TIMESTAMP(3);
-- KDP のペーパーバック title id (下書き作成時に採番。出版フェーズで使う)。
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_title_id" TEXT;
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "pb_last_error" TEXT;

CREATE INDEX IF NOT EXISTS "books_pb_queue_idx" ON "books" ("pb_publish_queued", "pb_publish_status");
