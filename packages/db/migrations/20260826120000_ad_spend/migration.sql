-- [F-090] Amazon Ads 広告費 (公式 Amazon Advertising API 由来) を計上するテーブル。
CREATE TABLE "ad_spend" (
    "id" TEXT NOT NULL,
    "ads_date" TEXT NOT NULL,
    "year_month" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "spend_jpy" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "sales_jpy" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'JPY',
    "amount_original" DECIMAL(12,2),
    "source" TEXT NOT NULL DEFAULT 'amazon_ads_api',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ad_spend_profile_date_key" ON "ad_spend"("profile_id", "ads_date");
CREATE INDEX "ad_spend_year_month_idx" ON "ad_spend"("year_month");
