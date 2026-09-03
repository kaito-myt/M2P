-- F-094: BOOK☆WALKER サーバー自動入稿 (bw.submit / bw.submit.dispatch)
ALTER TABLE "books"
  ADD COLUMN "bw_publish_status" TEXT NOT NULL DEFAULT 'unlisted',
  ADD COLUMN "bw_publish_queued" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bw_publish_queued_at" TIMESTAMP(3),
  ADD COLUMN "bw_submitted_at" TIMESTAMP(3),
  ADD COLUMN "bw_submit_cooldown_until" TIMESTAMP(3);

-- F-095/F-096: 楽天Kobo・BOOTH のチャネル別ステータス/キュー (タブUI先行、入稿エンジンは後続)
ALTER TABLE "books"
  ADD COLUMN "kobo_publish_status" TEXT NOT NULL DEFAULT 'unlisted',
  ADD COLUMN "kobo_publish_queued" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kobo_publish_queued_at" TIMESTAMP(3),
  ADD COLUMN "kobo_submitted_at" TIMESTAMP(3),
  ADD COLUMN "booth_publish_status" TEXT NOT NULL DEFAULT 'unlisted',
  ADD COLUMN "booth_publish_queued" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "booth_publish_queued_at" TIMESTAMP(3),
  ADD COLUMN "booth_submitted_at" TIMESTAMP(3);

ALTER TABLE "app_settings"
  ADD COLUMN "bw_auto_submit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bw_auto_submit_cron" TEXT NOT NULL DEFAULT '*/30 * * * *',
  ADD COLUMN "bw_submit_dry_run" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bw_session_state_enc" TEXT,
  ADD COLUMN "kobo_auto_submit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kobo_submit_dry_run" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "kobo_session_state_enc" TEXT,
  ADD COLUMN "booth_auto_submit_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "booth_submit_dry_run" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "booth_session_state_enc" TEXT;
