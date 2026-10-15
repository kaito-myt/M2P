-- 当月 KENP ロイヤリティの推計 (docs/09 §KENP 当月推計, docs/05 §sales_records)。
--
-- 背景: KDP は当月の KENP 金額を翌月 15 日頃まで確定しない。レポートにも概要サマリにも
-- 金額が無い当月は、KENP 収益が丸ごと ¥0 で計上され売上を過少報告していた
-- (2026-10-15 実測: KDP ¥3,211 に対し ¥1,708)。確定月の実効レート (円/頁) × ページ数で
-- 推計計上し、確定値と区別できるよう内訳を持つ。いずれも royalty_jpy の内数。
--
--  kenp_royalty_jpy           : KENP 確定分。実効レート導出 (収益 ÷ ページ数) の根拠。
--  kenp_royalty_estimated_jpy : KENP 推計分。0 = 推計を含まない。確定値の取込で 0 に戻る。
ALTER TABLE "sales_records" ADD COLUMN IF NOT EXISTS "kenp_royalty_jpy" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales_records" ADD COLUMN IF NOT EXISTS "kenp_royalty_estimated_jpy" INTEGER NOT NULL DEFAULT 0;
-- 注意: 既存行は 0 埋め = 確定月サンプルが無い状態。適用直後は推計が発生しない。
-- 前月を 1 回取り直して kenp_royalty_jpy を埋めること (docs/09 §10.5)。
