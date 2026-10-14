-- 3DP (3D Products) — docs/12-3dp-design.md
-- 3Dモデル商材を企画・生成・検査し BOOTH で販売する。アバター本体は扱わない。
--
-- BOOTH の AI 生成物規制 (2025-07-18) が前提:
-- 依拠性の高い商品と「大量・連続的に出品する行為」は商品の強制非公開 →
-- ショップ強制非公開 → アカウント停止。よって
--   R-1 月間出品上限をツール側に持つ (app_settings.tdp_monthly_publish_limit)
--   R-2 依拠性のある企画を機械的に弾く (tdp_products.derivative_check_json に判定を残す)
--   R-3 AI 生成であることを商品ページに明記する (商品説明テンプレート)

CREATE TABLE IF NOT EXISTS "tdp_products" (
  "id"                    TEXT NOT NULL,
  "kind"                  TEXT NOT NULL,
  "title"                 TEXT NOT NULL,
  "concept"               TEXT NOT NULL,
  -- 拒否された企画も監査のため残す (何を弾いたかが運用の判断材料になる)
  "derivative_check_json" JSONB,
  "price_jpy"             INTEGER,
  "status"                TEXT NOT NULL DEFAULT 'planned',
  "booth_item_url"        TEXT,
  "listed_at"             TIMESTAMP(3),
  "cost_jpy_total"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  "last_error"            TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tdp_products_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tdp_products_status_time_idx" ON "tdp_products" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "tdp_products_listed_idx" ON "tdp_products" ("listed_at" DESC);

CREATE TABLE IF NOT EXISTS "tdp_assets" (
  "id"           TEXT NOT NULL,
  "product_id"   TEXT NOT NULL,
  "provider"     TEXT NOT NULL,
  -- 再現性のため必ず残す (同じ物をもう一度作れないと商品が維持できない)
  "prompt"       TEXT NOT NULL,
  "r2_key"       TEXT NOT NULL,
  "format"       TEXT NOT NULL,
  "inspect_json" JSONB,
  "poly_count"   INTEGER,
  "byte_size"    INTEGER,
  "version"      INTEGER NOT NULL DEFAULT 1,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tdp_assets_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tdp_assets_product_version_idx" ON "tdp_assets" ("product_id", "version" DESC);

CREATE TABLE IF NOT EXISTS "tdp_previews" (
  "id"         TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "r2_key"     TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tdp_previews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "tdp_previews_product_kind_idx" ON "tdp_previews" ("product_id", "kind");

DO $$ BEGIN
  ALTER TABLE "tdp_assets" ADD CONSTRAINT "tdp_assets_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "tdp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "tdp_previews" ADD CONSTRAINT "tdp_previews_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "tdp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- R-1 / R-2 の設定。上限は目標ではない。0 で出品を完全停止できる。
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "tdp_monthly_publish_limit" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "tdp_derivative_denylist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
