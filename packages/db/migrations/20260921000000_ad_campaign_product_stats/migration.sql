-- [F-090拡張] Amazon Ads キャンペーン別・書籍(ASIN)別パフォーマンス (2026-09-21)。
CREATE TABLE "ad_campaign_stats" (
    "id" TEXT NOT NULL,
    "ads_date" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "ad_product" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_name" TEXT,
    "campaign_state" TEXT,
    "budget_jpy" INTEGER,
    "spend_jpy" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "sales_jpy" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "amount_original" DECIMAL(12,2),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaign_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_campaign_stats_unique_key" ON "ad_campaign_stats"("profile_id", "ad_product", "campaign_id", "ads_date");
CREATE INDEX "ad_campaign_stats_year_month_idx" ON "ad_campaign_stats"("year_month");
CREATE INDEX "ad_campaign_stats_campaign_id_idx" ON "ad_campaign_stats"("campaign_id");

CREATE TABLE "ad_product_stats" (
    "id" TEXT NOT NULL,
    "ads_date" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "ad_product" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ad_group_id" TEXT,
    "asin" TEXT,
    "sku" TEXT,
    "spend_jpy" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "sales_jpy" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "amount_original" DECIMAL(12,2),
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_product_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_product_stats_unique_key" ON "ad_product_stats"("profile_id", "ad_product", "campaign_id", "asin", "ads_date");
CREATE INDEX "ad_product_stats_asin_idx" ON "ad_product_stats"("asin");
CREATE INDEX "ad_product_stats_year_month_idx" ON "ad_product_stats"("year_month");
