import { type CronItem, parseCronItems, type ParsedCronItem } from 'graphile-worker';

import { ALERT_COST_CHECK_TASK_NAME } from './tasks/alert-cost-check.js';
import { ARCHIVE_DB_BACKUP_TASK_NAME } from './tasks/archive-db-backup.js';
import { ARCHIVE_JOBS_TASK_NAME } from './tasks/archive-jobs.js';
import { BATCH_PLAN_DISPATCHER_TASK_NAME } from './tasks/batch-plan-dispatcher.js';
import { CATALOG_FETCH_TASK_NAME } from './tasks/catalog-fetch.js';
import { MODEL_HEALTH_PROBE_TASK_NAME } from './tasks/model-health-probe.js';
import { FX_FETCH_TASK_NAME } from './tasks/fx-fetch.js';
import { ADS_SPEND_FETCH_TASK_NAME } from './tasks/ads-spend-fetch.js';
import { SALES_FETCH_DISPATCHER_TASK_NAME } from './tasks/sales-fetch-dispatcher.js';
import { BOOK_CULL_DETECT_TASK_NAME } from './tasks/book-cull-detect.js';
import { KDP_PUBLISH_STATUS_SYNC_TASK_NAME } from './tasks/kdp-publish-status-sync.js';
import { PIPELINE_THEME_AUTO_TASK_NAME } from './tasks/pipeline-theme-auto.js';
import { KDP_SUBMIT_DISPATCHER_TASK_NAME } from './tasks/kdp-submit-dispatcher.js';
import { BW_SUBMIT_DISPATCHER_TASK_NAME } from './tasks/bw-submit-dispatcher.js';
import { BW_RETAG_TASK_NAME } from './tasks/bw-retag.js';
import { PROMOTION_DISPATCH_TASK_NAME } from './tasks/promotion-dispatch.js';
import { PROMOTION_REVIEW_DAILY_TASK_NAME } from './tasks/promotion-review-daily.js';
import { COST_OPTIMIZE_WEEKLY_TASK_NAME } from './tasks/cost-optimize-weekly.js';
import { ORG_PLAN_TASK_NAME } from './tasks/org-plan.js';
import { ORG_EXECUTE_DISPATCH_TASK_NAME } from './tasks/org-execute.js';
import { ORG_OPS_WATCH_TASK_NAME } from './tasks/org-ops-watch.js';
import { ORG_FINANCE_TICK_TASK_NAME } from './tasks/org-finance-tick.js';
import { ORG_KDP_SCREEN_TASK_NAME } from './tasks/org-kdp-screen.js';
import { PROMOTION_PLAYBOOK_REFRESH_TASK_NAME } from './tasks/promotion-playbook-refresh.js';
import { PROMOTION_METRICS_FETCH_TASK_NAME } from './tasks/promotion-metrics-fetch.js';
import { ORG_PROMO_TICK_TASK_NAME } from './tasks/org-promo-tick.js';
import { KDP_PUBLISH_DIGEST_TASK_NAME } from './tasks/kdp-publish-digest.js';
import { PROMOTION_GROWTH_TODO_TASK_NAME } from './tasks/promotion-growth-todo.js';
import { PROMOTION_X_ENGAGE_TASK_NAME } from './tasks/promotion-x-engage.js';
import { PROMOTION_SNS_ENGAGE_TASK_NAME } from './tasks/promotion-sns-engage.js';
import { NOTE_ENGAGE_TASK_NAME } from './tasks/note-engage.js';
import { PROMOTION_GROWTH_LOOP_TASK_NAME } from './tasks/promotion-growth-loop.js';
import { RECURRING_COST_REFRESH_TASK_NAME } from './tasks/recurring-cost-refresh.js';
import { NOTE_PUBLISH_DISPATCHER_TASK_NAME } from './tasks/note-publish-dispatcher.js';
import { NOTE_PUBLISH_STATUS_SYNC_TASK_NAME } from './tasks/note-publish-status-sync.js';
import { NOTE_SALES_FETCH_DISPATCHER_TASK_NAME } from './tasks/note-sales-fetch-dispatcher.js';

/**
 * graphile-worker cron 定義 (docs/05 §5.4 / SP-01 仕様: `apps/worker/src/crontab.ts`)
 *
 * docs/05 §5.1 ではタスク名にドット表記 (`pipeline.book.kickoff`) を採用しているが、
 * graphile-worker 0.16 の crontab 文字列パーサ (`CRONTAB_COMMAND` 正規表現:
 * `^([_a-zA-Z][_a-zA-Z0-9:_-]*)...`) はドットを許容しない。一方で `CronItem` の
 * プログラマティック API はタスク名に制約がないため、本ファイルでは `CronItem[]` を
 * 直接生成して `parseCronItems()` に渡す方式を採用する（docs/05 §5.1 の命名規約と
 * graphile-worker の cron 文字列制約を両立するための実装上の決定）。
 *
 * Phase 1 (SP-01) 時点で有効化する cron:
 *   - `archive.db.backup`: 週次 pg_dump → R2 退避 (R-12 緩和)
 *
 * Phase 1 後半 / Phase 2 で有効化する cron は docs/05 §5.4 に列挙。各 SP でタスク本実装
 * とセットで本配列に追記する運用とする。
 */

/**
 * 毎週土曜 18:00 UTC = 日曜 03:00 JST。docs/03 R-12 緩和 (Railway 障害時の R2 復元手段)。
 *
 * graphile-worker の cron は UTC ベース:
 *   日曜 03:00 JST = 土曜 18:00 UTC → `0 18 * * 6`
 * docs/05 §5.4 に「日曜 03:00 JST」と記載されているため、土曜 18:00 UTC で起動する。
 */
export const ARCHIVE_DB_BACKUP_CRON = '0 18 * * 6';

/**
 * SP-02 T-02-07: 毎時 0 分に期限切れ BookLock を掃除。
 * docs/05 OQ-D-05 で運用方針が確定 (「必要なら alert.cost.check と同 cron で掃除」)、
 * かつ docs/05 §14 #4 で BookLock は `expires_at` 自動解放と定められているため。
 */
export const LOCKS_SWEEP_CRON = '0 * * * *';

/**
 * SP-02 T-02-08: 日次の為替レート取得。
 * `55 18 * * *` UTC = JST 03:55。catalog.fetch (T-02-09, JST 04:00) より 5 分前に
 * 走らせて `AppSettings.latest_fx_rate` を更新しておく (docs/05 §5.4 と整合)。
 */
export const FX_FETCH_CRON = '55 18 * * *';

/**
 * [F-090] Amazon Ads 広告費の日次取得(`ads.spend.fetch`)。`0 19 * * *` UTC = JST 04:00。
 * creds(AMAZON_ADS_*) 未設定なら no-op スキップなので、常時 ON の静的 cron とする(トグル不要)。
 * 直近30日を毎回上書きして遅延 attribution を反映。当月分は cost-meter/純利益に自動算入。
 */
export const ADS_SPEND_FETCH_CRON = '0 19 * * *';

/**
 * SP-02 T-02-09: 日次の単価カタログ取得。
 * env `MODEL_CATALOG_FETCH_CRON` (既定 `0 19 * * *` UTC = JST 04:00) を使用 (docs/05 §5.4)。
 * fx.fetch (`55 18 * * *`) の 5 分後に走らせ、`AppSettings.latest_fx_rate` を
 * 同日分のレートとして利用する。
 */
export const CATALOG_FETCH_CRON_DEFAULT = '0 19 * * *';

/**
 * SP-03 T-03-10: 毎分 batch_plan のスケジュール起動チェック。
 * `BatchPlan.status='scheduled' AND planned_at <= now()` の plan を一括 kick する
 * (docs/05 §5.4 / F-021)。1 分粒度で十分 (BatchPlan の planned_at は分単位)。
 */
export const BATCH_PLAN_DISPATCHER_CRON = '* * * * *';

/**
 * SP-07 T-07-02: 毎時 0 分にコストアラートチェック (docs/05 §5.4)。
 * `0 * * * *` UTC — monthly scope は毎時、per_book scope は個別 enqueue。
 */
export const ALERT_COST_CHECK_CRON = '0 * * * *';

/**
 * T-09-04: 毎週日曜 03:00 JST = 土曜 18:00 UTC (docs/05 §5.3.18)。
 * archive.db.backup (`0 18 * * 6`) と同スケジュール — 日曜朝メンテナンスウィンドウ統一。
 */
export const ARCHIVE_JOBS_CRON = '0 18 * * 6';

/**
 * KDP 出版ステータス自動同期 (`kdp.publish.status.sync`): 6 時間毎。
 * `publish_status='submitted'` の本を KDP 本棚 READ-ONLY 巡回し LIVE 検知で `published` に昇格する
 * (入稿は `scripts/kdp-publish.mjs` が担当するため submitted→published のギャップを埋める)。
 * セッション再利用の READ-ONLY 操作のみで危険性が低いため AppSettings トグル無しの常時 ON とする。
 */
export const KDP_PUBLISH_STATUS_SYNC_CRON = '0 */6 * * *';

/**
 * F-064: 販促プレイブック(web検索リサーチ)の週次更新。月曜 16:00 UTC = 火 01:00 JST。
 * promo_strategist が各チャンネルの「今伸びている型/フック/ハッシュタグ」を調べ
 * `promotion_channel_settings.playbook_json` に保存。生成器(promoter/content_creator)が
 * このプレイブックを材料に投稿を書くため、常時 ON の静的 cron とする(トグル不要)。
 * web検索コストを抑えるため頻度は週次。
 */
export const PROMOTION_PLAYBOOK_REFRESH_CRON = '0 16 * * 1';

/**
 * 販促実測トラッキング: 投稿済みSNSの実エンゲージメント取得 (2026-08-10, まず X)。
 * 日次 `0 15 * * *` UTC = 00:00 JST。X public_metrics を取得し promotion_posts に保存。
 * 常時ONの静的 cron（低コスト・実績が戦略最適化の前提のため）。
 */
export const PROMOTION_METRICS_FETCH_CRON = '0 15 * * *';

/**
 * [F-073] 販促本部の自己監視(org.promo.tick)。日次 `0 16 * * *` UTC = 01:00 JST。
 * metrics.fetch(0 15) の1時間後に走らせ当日の実測を評価→到達/成長が危機的なら運営者へアラート。
 * 常時ONの静的 cron（決定的・低コスト・組織の自己申告が目的のため）。
 */
export const ORG_PROMO_TICK_CRON = '0 16 * * *';

/**
 * [PUB-3] 出版デイリーレポート(kdp.publish.digest)。日次 `30 22 * * *` UTC = JST 07:30。
 * 公開/審査待ち/作成上限待機/失敗を1通にまとめて運営者へLINE通知（完了ゼロでも状況が届く）。
 * 常時ONの静的 cron。
 */
export const KDP_PUBLISH_DIGEST_CRON = '30 22 * * *';

/**
 * [F-075] 手動グロースToDo(promotion.growth.todo)。週次 `0 22 * * 1` UTC = JST 火 07:00。
 * IG/TikTok/note の手動フォロー/いいね対象を web_search で特定→needs_human org_task＋LINE。
 * 常時ONの静的 cron。
 */
export const PROMOTION_GROWTH_TODO_CRON = '0 22 * * 1';

/**
 * [F-076] X 能動エンゲージメント(promotion.x.engage)。1日3回 `0 1,7,13 * * *` UTC = JST 10/16/22時。
 * タスク内で `x_engage_enabled`(既定OFF)を確認し、無効なら no-op。ランプアップ＋1回少量で分散実行。
 * cron は常時登録・実行可否はフラグで制御。
 */
export const PROMOTION_X_ENGAGE_CRON = '0 1,7,13 * * *';

/**
 * [F-077] IG/TikTok ブラウザ自動フォロー(promotion.sns.engage)。1日2回 `0 3,9 * * *` UTC = JST 12/18時。
 * タスク内で `sns_engage_enabled`(既定OFF)と取り込み済みセッションの有無を確認し、無ければ no-op。
 * 凍結リスクが高いため X より控えめ(2回/日・ランプアップ・1回少量)。
 */
export const PROMOTION_SNS_ENGAGE_CRON = '0 3,9 * * *';

/**
 * [F-091] note ブラウザ自動フォロー & スキ(note.engage)。1日2回 `0 4,10 * * *` UTC = JST 13/19時。
 * タスク内で `note_engage_enabled`(既定ON=キルスイッチ)と取り込み済みセッションの有無を確認し、
 * 無効/未取り込みなら no-op。IG/TikTok より制限が緩いが ToS 配慮で控えめ(2回/日・ランプアップ・1回少量)。
 */
export const NOTE_ENGAGE_CRON = '0 4,10 * * *';

/**
 * [F-081] 販促強化の継続AIループ(promotion.growth.loop)。毎日 `0 21 * * *` UTC = JST 06:00。
 * タスク内で `promo_growth_loop_enabled`(既定OFF)を確認し、無効なら no-op。
 * 実測に応じて良書紹介投稿の再生成/市場リサーチ更新を自動実行し、黒字化へ販促を自己強化する。
 */
export const PROMOTION_GROWTH_LOOP_CRON = '0 21 * * *';

/**
 * [F-085] 固定/従量原価の最新化(recurring.cost.refresh)。毎月1日 `0 20 1 * *` UTC = JST 05:00。
 * USD建て(Railway等)を最新FXで再換算＋X API従量を実使用量から推定して recurring_costs を更新。
 */
export const RECURRING_COST_REFRESH_CRON = '0 20 1 * *';

/** env から catalog cron を取得 (既定 `0 19 * * *`)。 */
export function resolveCatalogFetchCron(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.MODEL_CATALOG_FETCH_CRON;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return CATALOG_FETCH_CRON_DEFAULT;
}

/**
 * SP-12 T-12-05: 日次の売上自動取得 dispatcher。
 * `0 17 * * *` UTC = JST 02:00。docs/05 §5.4 / F-038。
 * このエントリは CRON_ITEMS に静的追加せず、`buildCronItemsWithSettings` で条件付き追加する。
 */
export const SALES_FETCH_CRON_DEFAULT = '0 17 * * *'; // 02:00 JST

/** env から sales.fetch.dispatch cron を取得 (既定 `0 17 * * *`)。 */
export function resolveSalesFetchCron(env: NodeJS.ProcessEnv = process.env): string {
  const v = env.SALES_FETCH_CRON;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return SALES_FETCH_CRON_DEFAULT;
}

/** `sales.fetch.dispatch` の CronItem 定義 (AppSettings.sales_auto_fetch_enabled=true のときのみ使用)。 */
export const SALES_FETCH_DISPATCH_CRON_ITEM: CronItem = {
  task: SALES_FETCH_DISPATCHER_TASK_NAME,
  match: resolveSalesFetchCron(),
  identifier: 'sales-fetch-dispatch-daily',
};

/** 低品質本間引き検出の既定 cron (月 06:00 JST = UTC 日 21:00)。 */
export const BOOK_CULL_CRON_DEFAULT = '0 21 * * 1';

/** `book.cull.detect` の CronItem 定義 (AppSettings.book_cull_enabled=true のときのみ使用)。 */
export const BOOK_CULL_CRON_ITEM: CronItem = {
  task: BOOK_CULL_DETECT_TASK_NAME,
  match: BOOK_CULL_CRON_DEFAULT,
  identifier: 'book-cull-detect-weekly',
};

/**
 * パイプライン設定: テーマ自動生成の既定 cron (`0 22 * * *` UTC = 07:00 JST)。
 * AppSettings.pipeline_theme_cron の既定値 (schema.prisma) と一致させる。
 */
export const PIPELINE_THEME_AUTO_CRON_DEFAULT = '0 22 * * *';

/** `pipeline.theme.auto` の CronItem 定義 (AppSettings.autopass_theme_enabled=true のときのみ使用)。 */
export const PIPELINE_THEME_AUTO_CRON_ITEM: CronItem = {
  task: PIPELINE_THEME_AUTO_TASK_NAME,
  match: PIPELINE_THEME_AUTO_CRON_DEFAULT,
  identifier: 'pipeline-theme-auto-daily',
};

/**
 * F-041 Phase3: サーバー側自動入稿ディスパッチャの既定 cron (30分毎)。
 * AppSettings.kdp_auto_submit_enabled=true のときだけ条件付き追加する（既定OFF）。
 * 同時 1 冊出版のため間隔は出版 1 冊(~10分)より十分長くする。
 */
export const KDP_SUBMIT_DISPATCHER_CRON_DEFAULT = '*/30 * * * *';

/** `kdp.submit.dispatch` の CronItem 定義。 */
export const KDP_SUBMIT_DISPATCHER_CRON_ITEM: CronItem = {
  task: KDP_SUBMIT_DISPATCHER_TASK_NAME,
  match: KDP_SUBMIT_DISPATCHER_CRON_DEFAULT,
  identifier: 'kdp-submit-dispatch',
};

/**
 * F-094: BOOK☆WALKER サーバー自動入稿ディスパッチャの既定 cron (30分毎)。
 * AppSettings.bw_auto_submit_enabled=true のときだけ条件付き追加する（既定OFF）。
 */
export const BW_SUBMIT_DISPATCHER_CRON_DEFAULT = '*/30 * * * *';

/** `bw.submit.dispatch` の CronItem 定義。 */
export const BW_SUBMIT_DISPATCHER_CRON_ITEM: CronItem = {
  task: BW_SUBMIT_DISPATCHER_TASK_NAME,
  match: BW_SUBMIT_DISPATCHER_CRON_DEFAULT,
  identifier: 'bw-submit-dispatch',
};

// F-094b: 却下書籍の自動再申請 tick。日次 05:00 JST(20:00 UTC)。タスク側で bw_retag_enabled を
// 見て自己ゲートするため静的 cron でよい(無効/セッション無しなら本棚を開く前に即 return)。
export const BW_RETAG_CRON = '0 20 * * *';

/**
 * docs/11-anp-design.md §7 Phase2: note サーバー自動公開ディスパッチャの既定 cron (30分毎)。
 * AppSettings.anp_auto_publish_enabled=true のときだけ条件付き追加する(既定OFF)。
 */
export const NOTE_PUBLISH_DISPATCHER_CRON_DEFAULT = '*/30 * * * *';

/** `note.publish.dispatch` の CronItem 定義。 */
export const NOTE_PUBLISH_DISPATCHER_CRON_ITEM: CronItem = {
  task: NOTE_PUBLISH_DISPATCHER_TASK_NAME,
  match: NOTE_PUBLISH_DISPATCHER_CRON_DEFAULT,
  identifier: 'note-publish-dispatch',
};

/**
 * docs/11-anp-design.md §7 Phase2 F-ANP-22: note 公開ステータス同期。READ-ONLY で常時ON
 * (kdp.publish.status.sync と同型)。6 時間毎。
 */
export const NOTE_PUBLISH_STATUS_SYNC_CRON = '30 */6 * * *';

/**
 * docs/11-anp-design.md §7 Phase3 F-ANP-40: note 売上/KPI 取得ディスパッチャ。READ-ONLY で
 * 常時ON (kdp.publish.status.sync と同型)。日次 JST 06:00 = UTC 21:00 (前日)。
 */
export const NOTE_SALES_FETCH_DISPATCHER_CRON = '0 21 * * *';

/**
 * F-052: 販促投稿の自動ディスパッチ cron (既定 30分毎)。
 * AppSettings.promo_auto_post_enabled=true のときだけ条件付き追加する。
 */
export const PROMOTION_DISPATCH_CRON_DEFAULT = '*/30 * * * *';

/** `promotion.dispatch` の CronItem 定義。 */
export const PROMOTION_DISPATCH_CRON_ITEM: CronItem = {
  task: PROMOTION_DISPATCH_TASK_NAME,
  match: PROMOTION_DISPATCH_CRON_DEFAULT,
  identifier: 'promotion-dispatch',
};

/**
 * F-061: 日次の投稿見直し cron（既定 JST 08:00 = UTC 23:00）。
 * AppSettings.promo_daily_review_enabled=true のときだけ条件付き追加する。
 */
export const PROMOTION_REVIEW_CRON_DEFAULT = '0 23 * * *';

/** `promotion.review.daily` の CronItem 定義。 */
export const PROMOTION_REVIEW_CRON_ITEM: CronItem = {
  task: PROMOTION_REVIEW_DAILY_TASK_NAME,
  match: PROMOTION_REVIEW_CRON_DEFAULT,
  identifier: 'promotion-review-daily',
};

/**
 * F-062: 週次のコスト改善提案 cron（既定 毎週月曜 UTC 20:00 = 火 05:00 JST）。
 * AppSettings.cost_auto_analyze_enabled=true のときだけ条件付き追加する。
 */
export const COST_ANALYZE_CRON_DEFAULT = '0 20 * * 1';

/** `cost.optimize.weekly` の CronItem 定義。 */
export const COST_ANALYZE_CRON_ITEM: CronItem = {
  task: COST_OPTIMIZE_WEEKLY_TASK_NAME,
  match: COST_ANALYZE_CRON_DEFAULT,
  identifier: 'cost-optimize-weekly',
};

/**
 * docs/06: CEO ティック (org.plan) の日次 cron。既定 05:00 JST (UTC 20:00)。
 * AppSettings.org_auto_plan_enabled=true のときだけ条件付き追加する。
 */
export const ORG_PLAN_CRON_DEFAULT = '0 20 * * *';

/** `org.plan` の CronItem 定義。 */
export const ORG_PLAN_CRON_ITEM: CronItem = {
  task: ORG_PLAN_TASK_NAME,
  match: ORG_PLAN_CRON_DEFAULT,
  identifier: 'org-plan-daily',
  payload: { trigger: 'cron' },
};

/**
 * docs/06 P2: 承認済 org_tasks の実行ディスパッチ (org.execute.dispatch)。既定 15分毎。
 * AppSettings.org_auto_execute_enabled=true のときだけ条件付き追加する。
 */
export const ORG_EXECUTE_CRON_DEFAULT = '*/15 * * * *';

/** `org.execute.dispatch` の CronItem 定義。 */
export const ORG_EXECUTE_CRON_ITEM: CronItem = {
  task: ORG_EXECUTE_DISPATCH_TASK_NAME,
  match: ORG_EXECUTE_CRON_DEFAULT,
  identifier: 'org-execute-dispatch',
  payload: { trigger: 'cron' },
};

/**
 * docs/06 P3: 運用の自己復旧監視 (org.ops.watch)。既定 10分毎。
 * AppSettings.org_ops_watch_enabled=true のときだけ条件付き追加する。
 */
export const ORG_OPS_WATCH_CRON_DEFAULT = '*/10 * * * *';

/** `org.ops.watch` の CronItem 定義。 */
export const ORG_OPS_WATCH_CRON_ITEM: CronItem = {
  task: ORG_OPS_WATCH_TASK_NAME,
  match: ORG_OPS_WATCH_CRON_DEFAULT,
  identifier: 'org-ops-watch',
  payload: { trigger: 'cron' },
};

/**
 * docs/06 P3: 経営の予算ガード (org.finance.tick)。既定 毎時。
 * AppSettings.org_finance_tick_enabled=true のときだけ条件付き追加する。
 */
export const ORG_FINANCE_TICK_CRON_DEFAULT = '0 * * * *';

/** `org.finance.tick` の CronItem 定義。 */
export const ORG_FINANCE_TICK_CRON_ITEM: CronItem = {
  task: ORG_FINANCE_TICK_TASK_NAME,
  match: ORG_FINANCE_TICK_CRON_DEFAULT,
  identifier: 'org-finance-tick',
  payload: { trigger: 'cron' },
};

/**
 * docs/06 P4 増分3: KDP 公開の事前スクリーニング (org.kdp.screen)。既定 毎時30分。
 * AppSettings.org_kdp_auto_publish_enabled=true のときだけ条件付き追加する（既定OFF）。
 */
export const ORG_KDP_SCREEN_CRON_DEFAULT = '30 * * * *';

/** `org.kdp.screen` の CronItem 定義。 */
export const ORG_KDP_SCREEN_CRON_ITEM: CronItem = {
  task: ORG_KDP_SCREEN_TASK_NAME,
  match: ORG_KDP_SCREEN_CRON_DEFAULT,
  identifier: 'org-kdp-screen',
  payload: { trigger: 'cron' },
};

/** AppSettings の自動運用トグルに応じて CronItem 配列を組み立てる。 */
export interface CronRuntimeSettings {
  sales_auto_fetch_enabled: boolean;
  /** DB に保存されている cron 文字列 (省略時は env / 既定値を使用)。 */
  sales_auto_fetch_cron?: string | null;
  /** F-052: 販促自動投稿ディスパッチャを有効化するか。 */
  promo_auto_post_enabled?: boolean;
  /** F-052: 販促ディスパッチ cron (省略時は既定 30分毎)。 */
  promo_dispatch_cron?: string | null;
  /** F-061: 日次投稿見直しを cron 有効化するか。 */
  promo_daily_review_enabled?: boolean;
  /** F-061: 日次投稿見直し cron (省略時は既定 JST 08:00)。 */
  promo_review_cron?: string | null;
  /** F-062: 週次コスト改善提案を cron 有効化するか。 */
  cost_auto_analyze_enabled?: boolean;
  /** F-062: 週次コスト分析 cron (省略時は既定 火 05:00 JST)。 */
  cost_analyze_cron?: string | null;
  /** 低品質本の週次間引き検出を cron 有効化するか。 */
  book_cull_enabled?: boolean;
  /** 低品質本間引き検出 cron (省略時は既定 月 06:00 JST)。 */
  book_cull_cron?: string | null;
  /** docs/06: CEO ティック (org.plan) を日次 cron で自動起動するか。 */
  org_auto_plan_enabled?: boolean;
  /** docs/06: org.plan cron (省略時は既定 05:00 JST)。 */
  org_plan_cron?: string | null;
  /** docs/06 P2: 承認済タスクの実行ディスパッチ (org.execute.dispatch) を cron 有効化するか。 */
  org_auto_execute_enabled?: boolean;
  /** docs/06 P2: org.execute.dispatch cron (省略時は既定 15分毎)。 */
  org_execute_cron?: string | null;
  /** docs/06 P3: 運用の自己復旧監視 (org.ops.watch) を cron 有効化するか。 */
  org_ops_watch_enabled?: boolean;
  /** docs/06 P3: org.ops.watch cron (省略時は既定 10分毎)。 */
  org_ops_watch_cron?: string | null;
  /** docs/06 P3: 経営の予算ガード (org.finance.tick) を cron 有効化するか。 */
  org_finance_tick_enabled?: boolean;
  /** docs/06 P3: org.finance.tick cron (省略時は既定 毎時)。 */
  org_finance_tick_cron?: string | null;
  /** docs/06 P4 増分3: KDP 公開の事前スクリーニング (org.kdp.screen) を cron 有効化するか（既定OFF）。 */
  org_kdp_auto_publish_enabled?: boolean;
  /** docs/06 P4 増分3: org.kdp.screen cron (省略時は既定 毎時30分)。 */
  org_kdp_screen_cron?: string | null;
  /** パイプライン設定: テーマ自動生成 (pipeline.theme.auto) を cron 有効化するか（既定OFF）。 */
  autopass_theme_enabled?: boolean;
  /** パイプライン設定: pipeline.theme.auto cron (省略時は既定 07:00 JST)。 */
  pipeline_theme_cron?: string | null;
  /** F-041 Phase3: サーバー側自動入稿ディスパッチャ (kdp.submit.dispatch) を cron 有効化するか（既定OFF）。 */
  kdp_auto_submit_enabled?: boolean;
  /** F-041 Phase3: kdp.submit.dispatch cron (省略時は既定 30分毎)。 */
  kdp_auto_submit_cron?: string | null;
  /** F-094: BOOK☆WALKER サーバー自動入稿ディスパッチャ (bw.submit.dispatch) を cron 有効化するか（既定OFF）。 */
  bw_auto_submit_enabled?: boolean;
  /** F-094: bw.submit.dispatch cron (省略時は既定 30分毎)。 */
  bw_auto_submit_cron?: string | null;
  /** docs/11 §7 Phase2: note サーバー自動公開ディスパッチャ (note.publish.dispatch) を cron 有効化するか（既定OFF）。 */
  anp_auto_publish_enabled?: boolean;
}

/** 後方互換エイリアス (旧名)。 */
export type SalesFetchSettings = CronRuntimeSettings;

/**
 * AppSettings を受け取り、最終的な CronItem[] を返す。
 *
 * - 静的 CRON_ITEMS は常に含む
 * - `sales_auto_fetch_enabled=true`  → + sales.fetch.dispatch
 * - `promo_auto_post_enabled=true`   → + promotion.dispatch
 */
export function buildCronItemsWithSettings(settings: CronRuntimeSettings): CronItem[] {
  const items: CronItem[] = [...CRON_ITEMS];

  if (settings.sales_auto_fetch_enabled) {
    const cronMatch =
      typeof settings.sales_auto_fetch_cron === 'string' &&
      settings.sales_auto_fetch_cron.trim().length > 0
        ? settings.sales_auto_fetch_cron.trim()
        : resolveSalesFetchCron();
    items.push({ ...SALES_FETCH_DISPATCH_CRON_ITEM, match: cronMatch });
  }

  if (settings.promo_auto_post_enabled) {
    const cronMatch =
      typeof settings.promo_dispatch_cron === 'string' &&
      settings.promo_dispatch_cron.trim().length > 0
        ? settings.promo_dispatch_cron.trim()
        : PROMOTION_DISPATCH_CRON_DEFAULT;
    items.push({ ...PROMOTION_DISPATCH_CRON_ITEM, match: cronMatch });
  }

  if (settings.book_cull_enabled) {
    const cronMatch =
      typeof settings.book_cull_cron === 'string' && settings.book_cull_cron.trim().length > 0
        ? settings.book_cull_cron.trim()
        : BOOK_CULL_CRON_DEFAULT;
    items.push({ ...BOOK_CULL_CRON_ITEM, match: cronMatch });
  }

  if (settings.promo_daily_review_enabled) {
    const cronMatch =
      typeof settings.promo_review_cron === 'string' && settings.promo_review_cron.trim().length > 0
        ? settings.promo_review_cron.trim()
        : PROMOTION_REVIEW_CRON_DEFAULT;
    items.push({ ...PROMOTION_REVIEW_CRON_ITEM, match: cronMatch });
  }

  if (settings.cost_auto_analyze_enabled) {
    const cronMatch =
      typeof settings.cost_analyze_cron === 'string' && settings.cost_analyze_cron.trim().length > 0
        ? settings.cost_analyze_cron.trim()
        : COST_ANALYZE_CRON_DEFAULT;
    items.push({ ...COST_ANALYZE_CRON_ITEM, match: cronMatch });
  }

  if (settings.org_auto_plan_enabled) {
    const cronMatch =
      typeof settings.org_plan_cron === 'string' && settings.org_plan_cron.trim().length > 0
        ? settings.org_plan_cron.trim()
        : ORG_PLAN_CRON_DEFAULT;
    items.push({ ...ORG_PLAN_CRON_ITEM, match: cronMatch });
  }

  if (settings.org_auto_execute_enabled) {
    const cronMatch =
      typeof settings.org_execute_cron === 'string' && settings.org_execute_cron.trim().length > 0
        ? settings.org_execute_cron.trim()
        : ORG_EXECUTE_CRON_DEFAULT;
    items.push({ ...ORG_EXECUTE_CRON_ITEM, match: cronMatch });
  }

  if (settings.org_ops_watch_enabled) {
    const cronMatch =
      typeof settings.org_ops_watch_cron === 'string' && settings.org_ops_watch_cron.trim().length > 0
        ? settings.org_ops_watch_cron.trim()
        : ORG_OPS_WATCH_CRON_DEFAULT;
    items.push({ ...ORG_OPS_WATCH_CRON_ITEM, match: cronMatch });
  }

  if (settings.org_finance_tick_enabled) {
    const cronMatch =
      typeof settings.org_finance_tick_cron === 'string' && settings.org_finance_tick_cron.trim().length > 0
        ? settings.org_finance_tick_cron.trim()
        : ORG_FINANCE_TICK_CRON_DEFAULT;
    items.push({ ...ORG_FINANCE_TICK_CRON_ITEM, match: cronMatch });
  }

  if (settings.org_kdp_auto_publish_enabled) {
    const cronMatch =
      typeof settings.org_kdp_screen_cron === 'string' && settings.org_kdp_screen_cron.trim().length > 0
        ? settings.org_kdp_screen_cron.trim()
        : ORG_KDP_SCREEN_CRON_DEFAULT;
    items.push({ ...ORG_KDP_SCREEN_CRON_ITEM, match: cronMatch });
  }

  if (settings.autopass_theme_enabled) {
    const cronMatch =
      typeof settings.pipeline_theme_cron === 'string' && settings.pipeline_theme_cron.trim().length > 0
        ? settings.pipeline_theme_cron.trim()
        : PIPELINE_THEME_AUTO_CRON_DEFAULT;
    items.push({ ...PIPELINE_THEME_AUTO_CRON_ITEM, match: cronMatch });
  }

  if (settings.kdp_auto_submit_enabled) {
    const cronMatch =
      typeof settings.kdp_auto_submit_cron === 'string' && settings.kdp_auto_submit_cron.trim().length > 0
        ? settings.kdp_auto_submit_cron.trim()
        : KDP_SUBMIT_DISPATCHER_CRON_DEFAULT;
    items.push({ ...KDP_SUBMIT_DISPATCHER_CRON_ITEM, match: cronMatch });
  }

  if (settings.bw_auto_submit_enabled) {
    const cronMatch =
      typeof settings.bw_auto_submit_cron === 'string' && settings.bw_auto_submit_cron.trim().length > 0
        ? settings.bw_auto_submit_cron.trim()
        : BW_SUBMIT_DISPATCHER_CRON_DEFAULT;
    items.push({ ...BW_SUBMIT_DISPATCHER_CRON_ITEM, match: cronMatch });
  }

  if (settings.anp_auto_publish_enabled) {
    items.push({ ...NOTE_PUBLISH_DISPATCHER_CRON_ITEM });
  }

  return items;
}

export const CRON_ITEMS: CronItem[] = [
  {
    task: ARCHIVE_DB_BACKUP_TASK_NAME,
    match: ARCHIVE_DB_BACKUP_CRON,
    identifier: 'archive-db-backup-weekly',
    // payload は不要 (タスク本体は env と helpers.job から状態を取る)
  },
  {
    task: FX_FETCH_TASK_NAME,
    match: FX_FETCH_CRON,
    identifier: 'fx-fetch-daily',
    // payload 不要 (タスク本体は env FX_RATE_API_URL を内部で読む)
  },
  {
    task: ADS_SPEND_FETCH_TASK_NAME,
    match: ADS_SPEND_FETCH_CRON,
    identifier: 'ads-spend-fetch-daily',
    // payload 不要 (creds は env AMAZON_ADS_* を内部で読む。未設定なら no-op)
  },
  {
    // F-094b: 却下書籍の自動再申請(bw.retag.tick)。bw_retag_enabled=false なら即 no-op。
    task: BW_RETAG_TASK_NAME,
    match: BW_RETAG_CRON,
    identifier: 'bw-retag-tick-daily',
  },
  {
    task: CATALOG_FETCH_TASK_NAME,
    match: resolveCatalogFetchCron(),
    identifier: 'catalog-fetch-daily',
    payload: { trigger: 'cron' },
  },
  // モデル可用性 probe（1トークン試行で「実際に呼べるか」を検証）＋自己修復。
  // 「動く・安い・止まらない」の要。1日2回（catalog.fetch 後の 04:20 と 16:20 UTC）。
  {
    task: MODEL_HEALTH_PROBE_TASK_NAME,
    match: '20 4,16 * * *',
    identifier: 'model-health-probe-12h',
  },
  {
    task: BATCH_PLAN_DISPATCHER_TASK_NAME,
    match: BATCH_PLAN_DISPATCHER_CRON,
    identifier: 'batch-plan-dispatcher-minute',
    // payload 不要 (タスク本体は now() を内部で取り DB 駆動で plan を探す)
  },
  // SP-07 T-07-02: 毎時 0 分に monthly scope コストチェック (docs/05 §5.4)
  {
    task: ALERT_COST_CHECK_TASK_NAME,
    match: ALERT_COST_CHECK_CRON,
    identifier: 'alert-cost-check-hourly',
    payload: { scope: 'monthly' },
  },
  // T-09-04: 週次ジョブログアーカイブ (日曜 03:00 JST = 土曜 18:00 UTC, docs/05 §5.3.18)
  {
    task: ARCHIVE_JOBS_TASK_NAME,
    match: ARCHIVE_JOBS_CRON,
    identifier: 'archive-jobs-weekly',
  },
  // KDP 出版ステータス自動同期 (submitted→published, docs/05 §5.3.19): 6 時間毎
  {
    task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME,
    match: KDP_PUBLISH_STATUS_SYNC_CRON,
    identifier: 'kdp-publish-status-sync-6h',
  },
  // docs/11 §7 Phase2 F-ANP-22: note 公開ステータス同期(published→unlisted 検知)。6 時間毎・常時ON。
  {
    task: NOTE_PUBLISH_STATUS_SYNC_TASK_NAME,
    match: NOTE_PUBLISH_STATUS_SYNC_CRON,
    identifier: 'note-publish-status-sync-6h',
  },
  // docs/11 §7 Phase3 F-ANP-40: note 売上/KPI 取得ディスパッチャ。READ-ONLY・常時ON。日次。
  {
    task: NOTE_SALES_FETCH_DISPATCHER_TASK_NAME,
    match: NOTE_SALES_FETCH_DISPATCHER_CRON,
    identifier: 'note-sales-fetch-dispatch-daily',
  },
  // F-064: 販促プレイブック(web検索リサーチ)の週次更新 — 生成器が参照する研究を鮮度維持
  {
    task: PROMOTION_PLAYBOOK_REFRESH_TASK_NAME,
    match: PROMOTION_PLAYBOOK_REFRESH_CRON,
    identifier: 'promotion-playbook-refresh-weekly',
  },
  // 販促実測: 投稿済みSNSの実エンゲージメント取得 (まず X)。日次・常時ON。
  {
    task: PROMOTION_METRICS_FETCH_TASK_NAME,
    match: PROMOTION_METRICS_FETCH_CRON,
    identifier: 'promotion-metrics-fetch-daily',
  },
  // [F-073] 販促本部の自己監視: 実測を評価し到達/成長が危機的なら運営者へアラート。
  // metrics.fetch(0 15) の後に走らせて当日の実測を反映する。日次・常時ON。
  {
    task: ORG_PROMO_TICK_TASK_NAME,
    match: ORG_PROMO_TICK_CRON,
    identifier: 'org-promo-tick-daily',
  },
  // [PUB-3] 出版デイリーレポート: 公開/審査待ち/作成上限待機/失敗を毎朝LINE通知。日次・常時ON。
  {
    task: KDP_PUBLISH_DIGEST_TASK_NAME,
    match: KDP_PUBLISH_DIGEST_CRON,
    identifier: 'kdp-publish-digest-daily',
  },
  // [F-075] 手動グロースToDo: IG/TikTok/note の手動フォロー/いいね対象を週次生成。常時ON。
  {
    task: PROMOTION_GROWTH_TODO_TASK_NAME,
    match: PROMOTION_GROWTH_TODO_CRON,
    identifier: 'promotion-growth-todo-weekly',
  },
  // [F-076] X能動エンゲージ: 1日3回。実行可否は x_engage_enabled フラグでタスク内制御。
  {
    task: PROMOTION_X_ENGAGE_TASK_NAME,
    match: PROMOTION_X_ENGAGE_CRON,
    identifier: 'promotion-x-engage',
  },
  // [F-077] IG/TikTok自動フォロー: 1日2回。実行可否は sns_engage_enabled + セッション有無でタスク内制御。
  {
    task: PROMOTION_SNS_ENGAGE_TASK_NAME,
    match: PROMOTION_SNS_ENGAGE_CRON,
    identifier: 'promotion-sns-engage',
  },
  // [F-091] note自動フォロー&スキ: 1日2回。実行可否は note_engage_enabled + セッション有無でタスク内制御。
  {
    task: NOTE_ENGAGE_TASK_NAME,
    match: NOTE_ENGAGE_CRON,
    identifier: 'note-engage',
  },
  // [F-081] 販促強化ループ: 毎日。実行可否は promo_growth_loop_enabled フラグでタスク内制御。
  {
    task: PROMOTION_GROWTH_LOOP_TASK_NAME,
    match: PROMOTION_GROWTH_LOOP_CRON,
    identifier: 'promotion-growth-loop',
  },
  // [F-085] 固定/従量原価の最新化: 毎月1日。常時ON。
  {
    task: RECURRING_COST_REFRESH_TASK_NAME,
    match: RECURRING_COST_REFRESH_CRON,
    identifier: 'recurring-cost-refresh',
  },
  // sales.fetch.dispatch は AppSettings.sales_auto_fetch_enabled に応じて
  // buildCronItemsWithSettings() で条件付き追加する (SP-12 T-12-05)。
  // 静的 CRON_ITEMS には含めない — 既存テストの 6 件アサーションを維持するため。
];

/** graphile-worker `run({ parsedCronItems })` に渡す。空配列なら cron 無効。 */
export function buildParsedCronItems(items: CronItem[] = CRON_ITEMS): ParsedCronItem[] {
  return parseCronItems(items);
}
