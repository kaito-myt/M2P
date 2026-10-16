-- 3DP Inc-1 foundation (docs/12 §7.2-7.5, §17.15 / T-3DP-02-03)。
-- 列・索引・制約の追加のみ。既存の列・索引は変更も削除もしない。
-- OP-18: 本番へはスプリント末に運営者が適用する (このタスクでは適用しない)。
--
-- 本番への適用 (OP-18。運営者が手で行う)
--   pnpm --filter @a2p/db migrate:deploy は使えない。本番の _prisma_migrations には
--   20260625000000_add_book_publish_status が finished_at IS NULL のまま残っており、
--   Prisma は失敗した migration がある間 P3009 で新規適用を拒否する (2026-10-16 実測)。
--   既存の運用 (docs/11 申し送り #14/#15、20261014010000_tdp_tables も同経路) に倣う:
--     1) lock_timeout を 5s にする (jobs は A2P/ANP と共有: docs/12 §7.5)
--     2) psql -v ON_ERROR_STOP=1 --single-transaction -c "SET lock_timeout = '5s'" -f migration.sql
--        (途中失敗時に何も残らない)
--     3) pnpm --filter @a2p/db exec prisma migrate resolve --applied 20261016010000_tdp_inc1_foundation
--   全文は冪等 (IF NOT EXISTS / duplicate_object 握り潰し) なので、文を個別に流しても再実行しても同じ最終状態になる。
--   BEGIN / COMMIT は書かない (migrate deploy 経路で外側のトランザクションと二重になるため)。
--
-- 適用前の確認 SQL (本番 Railway Postgres に対して 2026-10-16 に実行済み):
--   1. SELECT DISTINCT status FROM tdp_products;
--        => 0 行 (tdp_products / tdp_assets / tdp_previews はいずれも 0 行)。
--           CHECK tdp_products_status_valid の許可値と衝突する既存値は無い。
--   2. SELECT tdp_monthly_publish_limit FROM app_settings;
--        => 8 (app_settings は 1 行、tdp_derivative_denylist = [])。
--           12 以下なので CHECK app_settings_tdp_limit_range をそのまま適用できる。
--           (12 超なら適用せず運営者に報告する約束: docs/12 §7.4-f)
--   3. SELECT count(*) FROM jobs;
--        => 6,403 行 / 7,344 kB (heap 4,448 kB)。既存索引は jobs_pkey / jobs_book_kind_idx / jobs_status_kind_idx。
--           索引作成のブロックは一瞬。低負荷時の適用依頼は不要
--           (CREATE INDEX CONCURRENTLY は Prisma のトランザクション内で使えない)。
--
-- Prisma の migrate diff は手書きの CHECK を追跡しない。存在確認は
-- packages/db/__tests__/tdp-migration.test.ts が機械的に行う (docs/12 §17.17-6)。
-- CHECK (a)(b)(c) と tdp_generations_task_id_required は対象テーブルが Inc-2 なのでここには入れない。
-- Meshy 系 4 列 (tdp_meshy_*) は Inc-2 (SP-3DP-03) の migration で足す。

-- ───────── app_settings (DEFAULT は TDP_SETTINGS_DEFAULTS と同値) ─────────
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "tdp_research_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_planner_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_sales_fetch_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_status_check_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "tdp_booth_public_fetch_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_kill_switch_on" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_kill_switch_since" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tdp_retire_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_degrade_mode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_jinxxy_monthly_limit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tdp_jinxxy_counts_toward_gate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tdp_jinxxy_gate_switched_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tdp_u9_json" JSONB,
  ADD COLUMN IF NOT EXISTS "tdp_u10_json" JSONB,
  ADD COLUMN IF NOT EXISTS "tdp_settings_confirmed_json" JSONB,
  ADD COLUMN IF NOT EXISTS "tdp_min_price_jpy" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "tdp_regen_limit_asset" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "tdp_regen_limit_product" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "tdp_gate_b_min_sales" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "tdp_gate_b_window_days" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS "tdp_gate_c_point_days" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS "tdp_gate_e_monthly_minutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "tdp_yield_warn_pct" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "tdp_derivative_reject_warn_pct" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "tdp_kind_weights_json" JSONB,
  ADD COLUMN IF NOT EXISTS "tdp_tuning_json" JSONB;

-- ───────── tdp_products ─────────
ALTER TABLE "tdp_products"
  ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'planner',
  ADD COLUMN IF NOT EXISTS "plan_json" JSONB,
  ADD COLUMN IF NOT EXISTS "target_media" TEXT[] NOT NULL DEFAULT ARRAY['booth']::TEXT[],
  ADD COLUMN IF NOT EXISTS "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "status_reason_json" JSONB,
  ADD COLUMN IF NOT EXISTS "lineage_no" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "tdp_products_stall_idx" ON "tdp_products" ("status", "status_changed_at");
CREATE INDEX IF NOT EXISTS "tdp_products_origin_idx" ON "tdp_products" ("origin", "created_at" DESC);

-- ───────── jobs (A2P / ANP と共有。nullable 列と索引の追加のみ) ─────────
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "tdp_product_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tdp_product_id_fkey"
    FOREIGN KEY ("tdp_product_id") REFERENCES "tdp_products" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "jobs_tdp_product_kind_idx" ON "jobs" ("tdp_product_id", "kind");
CREATE INDEX IF NOT EXISTS "jobs_kind_time_idx" ON "jobs" ("kind", "created_at" DESC);

-- ───────── CHECK (docs/12 §7.4 (d)(f)) ─────────
-- (d) 状態の許可値と、承認を経ない listed の禁止 (F-3DP-28)
DO $$ BEGIN
  ALTER TABLE "tdp_products" ADD CONSTRAINT "tdp_products_status_valid"
    CHECK ("status" IN ('planned','generating','inspecting','needs_fix','ready','review',
                        'approved','listed','failed','rejected','withdrawn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "tdp_products" ADD CONSTRAINT "tdp_products_approval_required"
    CHECK ("status" NOT IN ('approved','listed','withdrawn') OR "approved_at" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (f) R-1 の天井 (F-3DP-41)。API の拒否が主、これは最後の砦。TDP_MONTHLY_LIMIT_HARD_MAX と同値
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tdp_limit_range"
    CHECK ("tdp_monthly_publish_limit" BETWEEN 0 AND 12 AND "tdp_jinxxy_monthly_limit" BETWEEN 0 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
