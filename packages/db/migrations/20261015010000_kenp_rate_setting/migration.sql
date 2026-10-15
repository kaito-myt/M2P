-- 運営者設定の KENP 推計レート (円/頁)。docs/09 §10.7。
-- 4 シート構成の月別ロイヤリティ PMR には KENP 金額が構造的に存在しない (「総収益」の KENP 行は
-- 種類=該当なし・収益=0) ため、確定月から実効レートを導出できない。導出できないときのフォールバック。
-- NULL = 未設定 (推計しない)。設定値による計上も「推計」(sales_records.kenp_royalty_estimated_jpy)。
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "kenp_rate_jpy_per_page" DECIMAL(6,4);
