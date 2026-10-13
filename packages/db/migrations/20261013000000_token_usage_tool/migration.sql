-- コスト帰属 (docs/05 §3.3): token_usage の 1 行がどのツールの活動かを記録する。
--
-- 背景: role だけでは帰属が決まらない。`growth_scout`/`promo_strategist` 等の共有
-- エージェントは A2P (書籍販促) と ANP (note) の両方から呼ばれ、cron 経由では
-- `job_id` も無いので後から辿れない。結果、A2P のダッシュボードは全件集計で note 分を
-- 含み (10月 ¥7,063 の過大計上)、ANP は `role LIKE 'anp.%'` で `note.engage` の
-- `growth_scout` 分を落としていた (10月 ¥1,809 の過小計上)。
--
-- 既定は 'a2p' (A2P が第1ツールで既存行の大多数)。値域は 'a2p' | 'anp' | 'm2p'。
ALTER TABLE "token_usage" ADD COLUMN IF NOT EXISTS "tool" TEXT NOT NULL DEFAULT 'a2p';

-- 既存行のバックフィル ------------------------------------------------------

-- 1) ANP パイプラインは role 名前空間で分離済み。
UPDATE "token_usage" SET "tool" = 'anp' WHERE "role" LIKE 'anp.%';

-- 2) AI 組織 (CEO + 本部長) と全社コスト分析はどちらのツールにも属さない。
--    実例: AI CEO は 2026-10-08 に ANP 側の設定 (anp_auto_theme_enabled) を止めている。
UPDATE "token_usage" SET "tool" = 'm2p'
 WHERE "role" IN ('ceo','ceo_chat','prompt_editor','editorial_mgr','publish_mgr',
                  'analytics_mgr','promo_mgr','ops_mgr','finance_mgr',
                  'cost_optimizer','cost_accountant',
                  'promo_analyst','account_strategist');

-- 3) 共有エージェントの履歴補正: `growth_scout` の呼び元は実行時刻で判別できる。
--    `note.engage` の cron は `0 4,10 * * *` (UTC) で、実測の時刻分布が完全に一致する
--    (docs/11「2026-10-13 再測定」)。他の呼び元は `promotion.growth.todo` (`0 22 * * 1`)
--    と `promotion.sns.engage` (`0 3,9 * * *`) で、どちらも書籍販促 = A2P。
--    これ以降の行は記録時に呼出側が `tool` を明示するので、この補正は
--    2026-10-13 より前の履歴に対してだけ意味を持つ。
UPDATE "token_usage" SET "tool" = 'anp'
 WHERE "role" = 'growth_scout'
   AND EXTRACT(HOUR FROM "created_at") IN (4, 10)
   AND "created_at" < TIMESTAMP '2026-10-13 00:00:00';

-- ツール別の月次集計がダッシュボードの主クエリなので複合インデックスを張る。
CREATE INDEX IF NOT EXISTS "token_usage_tool_time_idx" ON "token_usage" ("tool", "created_at" DESC);
