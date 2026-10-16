-- ペーパーバックのロイヤリティを royalty_jpy の内数として持つ (docs/09 §10.9)。
--
-- ペーパーバックは電子書籍と別 ASIN (books.pb_asin) で売上が立つ。突合漏れで
-- 2026-09 のペーパーバック ¥1,942 がまるごと欠落していたため、取り込んだことを
-- 画面で確認できるように内訳列を持つ (kenp_royalty_jpy と同じ考え方)。
ALTER TABLE "sales_records"
  ADD COLUMN IF NOT EXISTS "paperback_royalty_jpy" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "paperback_units_sold" INTEGER NOT NULL DEFAULT 0;
