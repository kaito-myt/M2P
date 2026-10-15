# SP-3DP-11 inc5b-regulation-and-gates — 公開状態の監視・kill switch・撤退判定・損益 (Inc-5 中盤)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-10 完了 (`tdp_listings` が存在し、公開記録ができる)。**
> **本スプリントは「出品を始める前」に動いていなければならない安全装置。** 出品が始まった瞬間から P-1 の 90 日カウントと G-D (規制) の監視が始まる(§10 の追記)。**SP-3DP-12 の初回出品は本スプリントの完了が条件。**

## 1. 目的

3DP の最大のリスクは、BOOTH アカウントが **A2P と共用**で、1 件の違反が**商品 → ショップ → アカウント**と非線形に広がること(§14.6)。したがって「出し続けられるか」を機械で守る:
**出品済み商品の公開状態を毎日確認し、異常を 1 件でも検知したら全媒体の新規出品を自動停止する(解除は運営者の明示操作のみ)。**
併せて、続ける / やめるを**見える数字**にする: 判定ゲート G-A〜G-E の日次スナップショット(総合点にしない・4 値)、3DP 単体で閉じる損益、撤退モード(新規停止のみ。既存商品は取り下げない)。

## 2. 対応機能 ID

F-3DP-39 (公開状態の定期確認), F-3DP-40 (kill switch と明示解除), F-3DP-36/37 (ゲートの算出とパネル), F-3DP-31 (売上: 手入力), F-3DP-32 (純利益・入金突合), F-3DP-35 (ホーム), F-3DP-44 (撤退モード), F-3DP-45 (黒字判定の算入フラグ), F-3DP-46 (定期タスク), F-3DP-49 (R2 保持), F-3DP-43 (稼働: 公開区間)
対応画面: S-3DP-01 (停止中パネル・判定パネル・成果), S-3DP-06 (規制ゲート・運用・媒体), S-3DP-07 (損益), S-3DP-08 (定期タスク 5 行)
解く未確認事項: **U-8, U-11, U-16, U-28**

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-10** | U-8: BOOTH ガイドライン本文の判断(SP-3DP-06 で依頼済み)。**公開状態確認も同じ作法(素の取得・低頻度)なので、許容と読めない場合はこの取得方法を再設計する**。併せて **UA に載せる運営者の連絡先** を決める(`tdp_tuning_json.booth_fetch.contact`) | T-3DP-11-02 の着手前 | T-3DP-11-02 は ⛔。**監視が無ければ初回出品しない** |
| **OP-12** | **U-16**: 運営者の**自分の BOOTH 商品 1 点**で「公開 → 取得」「自主的に非公開 → 取得」を `status-probe` で比べ、判定条件が公開と非公開を分けるかを確認(終わったら必ず公開に戻す。**強制非公開は再現しようとしない**) | T-3DP-11-10 | 200 の中身の判定は `unreachable` に倒れたまま(= 安全側。404/410 だけが `abnormal`)。G-D の検知力が弱いまま出品することになるので**運営者が受容を明示**する必要がある |
| **OP-13** | **U-11**: 強制非公開・警告が運営者に**通知されるか**(BOOTH の公式ヘルプ・処分事例) | T-3DP-11-10。調べられる範囲で | **通知されない前提**で設計済み(公開状態確認が唯一の検知手段) |
| **OP-15** | **U-28**: `manage.booth.pm` の売上関連画面を 1 度見て、商品別の販売数・売上・CSV の有無を記録 | 任意 | 売上は**手入力が既定**(`sales_source='manual'`)。自動取得は実装しない |
| OP-08 | 判定値(G-B 本数・G-C 判定点・G-E 時間)の「確認した」 | 初回出品の前 | 提案値のまま動く |
| OP-19 | **TBD-5 の受容**: worker プロセス全体が止まると公開状態確認も日次スナップショットも一緒に止まり、3DP 内からは通知できない(2026-08-30〜09-01 の事故と同型)。画面を開いたときのナビの異常印が最後の砦で、**運営者が画面を開かない限り気付けない**。外形監視(Railway の通知・外部 uptime)は A2P/ANP 共通の課題で 3DP 単独では解かない | 初回出品の前に「受容する / 外形監視を先に用意する」を記録 | 受容として進める。**記録は必須** |
| OP-18 | 本番 DB の migration 適用 (SP-3DP-10 T-3DP-10-01)、デプロイ後に `tdp_status_check_enabled` が既定 ON のまま動くこと、cron の identifier が実行状況画面に出ることの確認 | スプリント末 | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-11-01 | ⬜ | 公開状態の分類 (純関数) | 3 値・理由コード・仮規則 | F-3DP-39 | M |
| T-3DP-11-02 | ⛔ | `tdp.listing.status.check` | 対照先行・再取得・発火・不発の検知 | F-3DP-39, 46 | L |
| T-3DP-11-03 | ⬜ | kill switch・撤退・縮退のドメインと Action | 発火 / 解除 / 操作ログ / 自動解除の不在 | F-3DP-40, 44 | L |
| T-3DP-11-04 | ⬜ | `computeGates` の全ゲート | G-B〜G-E・R1-REVIEW・暫定規則 | F-3DP-36, 38, 45 | L |
| T-3DP-11-05 | ⬜ | `tdp.gates.snapshot` の完成と R2 保持 | スナップショット・保持方針・不発通知 | F-3DP-36, 49 | L |
| T-3DP-11-06 | ⬜ | 売上の手入力・入金の記録・`tdp.sales.fetch` | 欠測は 0 にしない・冪等 | F-3DP-31, 32 | M |
| T-3DP-11-07 | ⬜ | 損益と原価 S-3DP-07 (月次損益・商品別・入金突合) | 3DP 単体で損益が閉じる | F-3DP-32, 45 | L |
| T-3DP-11-08 | ⬜ | ホームの完成 (停止中パネル・成果・判定パネル) と全画面の停止帯 | StopBanner・Stage 2 | F-3DP-35, 36, 37, 40 | L |
| T-3DP-11-09 | ⬜ | 設定: 規制ゲート・運用・媒体の算入切替 | 停止 / 解除 / 撤退 / 縮退 / Jinxxy 算入 | F-3DP-40, 44, 45 | L |
| T-3DP-11-10 | ⛔ | **U-8 / U-11 / U-16 / U-28 の確定** | `status-probe`・実 HTML・規則の確定 | F-3DP-39 | M |
| T-3DP-11-11 | ⬜ | E2E: 停止と解除・撤退・判定パネル | 空状態 Stage 0/1/2 | F-3DP-37, 40, 44 | M |
| T-3DP-11-12 | ⬜ | 設計書の追従と Inc-5 中盤の記録 | docs/12・dev-plan | (Rule #7/#8) | S |

合計 **12 タスク**。

---

## 5. タスク詳細

### T-3DP-11-01 公開状態の分類 (純関数)

- **目的**: 「公開と確認できないものは全て異常」にすると偽陽性で毎回止まり、運営者が解除を**反射的に押す**ようになる(本物の異常を見逃す)。**取得できず (`unreachable`) は止めない**3 値にする(D-5)。
- **対象ファイル**: `packages/contracts/src/tdp/listing-status.ts` / `packages/contracts/package.json` / テスト
- **やること**: `classifyObservation({ http_status, html, final_url, control_ok, product, rules_verified })` → `{ value: 'confirmed_public'|'abnormal_candidate'|'unreachable', reason_code }`。理由コードは §17.10.3 の表: `public_ok` / `http_404` / `http_410` / `title_mismatch` / `no_purchase_cta` / `redirected_away` / `http_5xx` / `http_429` / `http_403_challenge` / `timeout` / `network_error` / `control_unreachable`。**U-16 が閉じるまでの仮規則(安全側)**: 404 / 410 のみ異常候補。200 は「商品名が本文または `og:title` にある」ときだけ `confirmed_public`、それ以外は `unreachable` (`public_page_undetermined`) —— **`abnormal_candidate` にしない**(= kill switch を発火させない)。`rules_verified=true` (T-3DP-11-10 で確定後) のとき `title_mismatch` / `no_purchase_cta` / `redirected_away` を異常候補にする。対照が取れていない (`control_ok=false`) なら全て `unreachable` / `control_unreachable`。
- **受入基準**: 404 → 異常候補 / 410 同様 / 5xx・429・403 とチャレンジ画面・タイムアウト・ネットワーク断 → `unreachable` / `rules_verified=false` の 200 で商品名なし → `unreachable` (異常候補にならない) / `rules_verified=true` で商品名なし → `title_mismatch` / `control_ok=false` は常に `unreachable` / 判定は決定論。HTML フィクスチャは**合成**(観測済みは「存在しない ID の 404」のみ。他人の商品ページを置かない)。
- **依存**: SP-3DP-10 完了
- **参照**: F-3DP-39 / docs/12 §17.10.3 (表と仮実装の注記), §16.6, §17.13 (`isPublicPage`/分類)

### T-3DP-11-02 `tdp.listing.status.check`  ⛔ OP-10 待ち

- **対象ファイル**: `apps/worker/src/tasks/tdp/listing-status-check.ts` / `apps/worker/src/tasks/tdp/lib/fetch-polite.ts` (間隔・robots・UA) / `packages/contracts/src/tdp/cron-registry.ts` (`implemented: true`) / `apps/worker/src/runner.ts` / テスト (単体 + 実 PG)
- **やること** (§17.10.3 の手順 0〜8): ① `tdp_status_check_enabled` が**明示的に false** のときだけ `skipped` (`flag_off`)。取得失敗は**既定の側 (= 実行する)** ② 対象 = `state='published'` かつ `expected_public` かつ `item_url` あり。`status_check_full_below` (30) 以下は全件、超えたら公開記録が新しい 30 件 + 残りを `status_check_cycle_days` 日で一巡 ③ **対照を先に取る** (BOOTH の既知の公開ページが 200 か)。取れなければ全対象を `unreachable` / `control_unreachable` で記録して終了 — **対照が無いと `abnormal` を出せない** ④ 各対象を素の `fetch` で取得(間隔 3 秒以上・UA に運営者の連絡先・`robots.txt` 尊重・タイムアウト 20 秒・**セッションに触れない**) ⑤ `classifyObservation` ⑥ 異常候補は **60 秒後に 1 回だけ再取得し対照も再確認**。再取得でも異常なら `abnormal`、回復 / 取得失敗なら `confirmed_public` / `unreachable` ⑦ 観測を `tdp_public_observations`、`tdp_listings.last_*` と `consecutive_unreachable` を更新(`confirmed_public` で 0 に戻す) ⑧ `abnormal` が 1 件でもあれば T-3DP-11-03 の `engageKillSwitch(source='auto')` + LINE。すでに停止中なら二重に発火しない。`outcome`: 全件 `confirmed_public` → `ok` / `unreachable` を含む → `partial`(項目別の理由) / 例外 → `failed`。`summary={observed, confirmed, abnormal, unreachable, control_ok}`。**`unreachable` が 2 日連続した listing は G-D を `warn` にして LINE で知らせる(止めない)**。
- **受入基準**: ① 対照が取れない → 全件 `unreachable`・`abnormal` 0・kill switch 発火 0 ② 404 → 60 秒後に再取得(注入した時計)→ なお 404 → `abnormal` → 発火 1 回 ③ 1 回目 404・再取得 200 → `confirmed_public`・発火なし ④ `unreachable` の連続は発火しない ⑤ 間隔 3 秒未満にリクエストしない(偽時計)・`robots.txt` の Disallow を取らない・UA に連絡先が入る・連絡先未設定なら `skipped` (`fetch_contact_missing`) ⑥ 31 件以上のとき選択が「新しい 30 件 + 巡回分」 ⑦ 明示 false で `skipped`・`jobs` 行が `done`+`skipped` ⑧ セッション関連の import が無い(静的テスト: `booth_session_state_enc` への参照が 0) ⑨ すでに停止中なら `TdpRegulationEvent` が増えない。
- **依存**: T-3DP-11-01/-03, SP-3DP-10 T-3DP-10-01, OP-10
- **参照**: F-3DP-39/46 / docs/12 §17.10.3, §16.6, §17.5.1, §15.2 F-3DP-39 ①〜⑥

### T-3DP-11-03 kill switch・撤退・縮退のドメインと Action

- **目的**: 「止めるのは軽く、解除は重く」(UR-4)。**自動解除のコードを書かない。**
- **対象ファイル**: `packages/db/src/tdp/regulation.ts` (web と worker の両方から呼ぶ。`packages/db` の公開方式に従う) / `apps/3dp/app/actions/regulation.ts` / テスト (単体 + 実 PG)
- **やること**: `engageKillSwitch({source, reason?, listing_id?, observation_id?})` — `tdp_kill_switch_on=true` / `tdp_kill_switch_since` と `TdpRegulationEvent(kind='kill_engage')` を**同一トランザクション**。すでに停止中なら何もしない。LINE 通知は 1 イベント 1 回(連投しない)。`releaseKillSwitch({reason})` — 停止中のときだけ。理由は `release_reason_min_chars` (既定 20) 以上、空白のみ不可。フラグ解除とイベント `kill_release` (source=`operator`) を同一トランザクション。`setRetireMode({on, reason})` / `setDegradeMode({on, reason})` — 設定列 + イベント。**撤退は既存商品を取り下げない**。撤退中も売上取得と公開状態確認は止めない。停止 / 撤退 / 縮退が既に効いている箇所(`tdp.asset.generate`・`tdp.product.plan`・`startPublishWork`)が実際に止まることを統合テストで確認。
- **受入基準**: ① 発火でフラグとイベントが同時に変わる(トランザクション途中で失敗したら両方変わらない) ② 二重発火でイベントが増えない ③ 理由 19 字 → `reason_too_short`、停止中でないと → `not_engaged` ④ **`tdp_kill_switch_on = false` を書く箇所が `releaseKillSwitch` だけ**(静的テスト)。時間経過・再デプロイ・起動時処理・cron のどれでも解除されない(解除する関数がそれ以外に存在しない) ⑤ 撤退モード中に `tdp.listing.status.check` と `tdp.sales.fetch` が実行される ⑥ 縮退中は Meshy 系の関所が止まり、テクスチャ (画像) は止まらない ⑦ 撤退で既存商品の `status` が変わらない ⑧ 未認証は `auth`。
- **依存**: SP-3DP-10 T-3DP-10-05/-06, SP-3DP-03 T-3DP-03-10 (静的テストの拡張)
- **参照**: F-3DP-40/44 / docs/12 §17.8.3 (発火経路), §17.4, §9.13-5/8, §15.2 F-3DP-40・44

### T-3DP-11-04 `computeGates` の全ゲート

- **対象ファイル**: `packages/contracts/src/tdp/gates.ts` (SP-3DP-05 の G-A に G-B〜G-E・R1-REVIEW を追加) / テスト
- **やること**: §17.10.1 の表を実装。4 値 `ok` / `warn` / `fail` / `unevaluated`。**暫定判定の一般則(D-3)**: 判定日**前**に出してよいのは `ok` / `warn` / `unevaluated` だけで **`fail` を出さない**。判定日**後**は `ok` / `fail`。例外は G-E (累積作業時間は減らない) と G-D (常時)。
  - **G-B**: 「最初の 8 商品」(黒字判定に算入する媒体の初回公開記録が早い順)の累計販売本数 / `tdp_gate_b_min_sales`。判定日 = 初回 BOOTH 公開記録日 + `tdp_gate_b_window_days`。暫定 = `value ≥ line × 経過日 ÷ 観測窓` → `ok`、未満 → `warn`。売上が一度も取れていない(行も入力も無い)→ `unevaluated`。
  - **G-C**: 直近の**確定月**(JST で月が終わった月)の「手取り − 実コスト」/ 0。実コスト = `token_usage` の `tool='3dp'` を JST の月で合計 + `tdp_meshy_plan_jpy_month`。判定日 = + `tdp_gate_c_point_days`。確定月が無い / 売上取得が一度も成功していない → `unevaluated`。暫定 `≥0` → `ok`、未満 → `warn`。
  - **G-D**: 公開記録済み・`expected_public` の listing が 0 件 / 確認が一度も成功していない → `unevaluated`(**「異常 0 件」を `ok` にしない**)。常時: 停止中 or `abnormal` あり → `fail` / 最終成功が `status_check_stale_hours` 超 or `unreachable` が `status_check_unreachable_warn_days` 連続 → `warn` / それ以外 `ok`。
  - **G-E**: SP-3DP-09 の `monthWorkSummary` を使う。完了した承認〜公開記録のペアが当月 0 → `unevaluated`。累計 > 上限 → `fail`、≥ 80% → `warn`。
  - **R1-REVIEW**: 公開記録済み 100 未満は**行自体を出さない**。以上で `warn` 固定。
  - Jinxxy は `counts_toward_gate=false` の間、別行「参考(判定対象外)」。**黒字判定に算入する媒体の売上だけ**を G-B / G-C に使う(F-3DP-45。切替日を `inputs_json` に残す)。
- **受入基準**: 各ゲート × 4 値のケース(境界: 判定日ちょうど / 前日 / 翌日)/ **判定日前に `fail` が出ない**(G-D・G-E を除く)/ 設定値を変えると結果が変わる(リテラルが無いことの機械判定: `gates.ts` の数値リテラルは許可リスト方式の静的テスト)/ 欠測が `ok` にならない / Jinxxy の算入 ON/OFF で G-B/G-C の値が変わる / `inputs_json` 用の入力スナップショットを返す。
- **依存**: SP-3DP-09 T-3DP-09-03, SP-3DP-05 T-3DP-05-01, SP-3DP-10 T-3DP-10-01
- **参照**: F-3DP-36/38/45 / docs/12 §17.10.1, §14.5.2, §9.12-3

### T-3DP-11-05 `tdp.gates.snapshot` の完成と R2 保持

- **対象ファイル**: `apps/worker/src/tasks/tdp/gates-snapshot.ts` / `apps/worker/src/tasks/tdp/lib/retention.ts` / `packages/storage/src/operations.ts` (削除・使用量の関数が足りなければ) / テスト
- **やること**: SP-3DP-05 の Inc-2 分に追加: ② **`applyRetention()`** (§17.9.3): 最新 `intermediate_keep_versions` (3) 版より古い版の `shape` / `textured` / 未承認の `distribution` / `fbx` を R2 から物理削除し `tdp_assets.r2_state='purged'`・`r2_purged_at`(**行は残す**)。デバッグ画像は 30 日。**消さない**: `is_distribution=true` の行 / `approved_asset_version` と一致する版の全成果物 / 承認時点のプレビュー / 配布 ZIP / `meshy-task.json`。「削除は論理削除」の既存規約の**例外**であることをコードのコメントに ④ `computeGates` → `tdp_gate_snapshots` に `gates_json` と `inputs_json`。**算出に失敗したら `ok=false, error` の行を残す**(画面は最終成功 + 「算出に失敗しています: 理由」)。⑤ `tdp.listing.status.check` の最終成功が `status_check_stale_hours` 超なら LINE (1 日 1 回)。⑥ 各部が独立に失敗しても他を続行し `outcome='partial'`。
- **受入基準** (実 PG + R2 は fake): 5 版あるとき古い 2 版の中間物だけが削除対象でキー一覧が期待どおり / 配布版・承認版・ZIP・`meshy-task.json` は**削除されない** / 削除後も行が残り `r2_state='purged'` / 算出失敗で `ok=false` 行ができ例外にならない / 不発通知が 1 日 1 回 / `jobs` 行が cron 起点でも 1 本。
- **依存**: T-3DP-11-04, SP-3DP-05 T-3DP-05-01
- **参照**: F-3DP-36/49 / docs/12 §17.9.3, §17.5.4 (`tdp.gates.snapshot`), §17.10.3 末尾

### T-3DP-11-06 売上の手入力・入金の記録・`tdp.sales.fetch`

- **対象ファイル**: `apps/3dp/app/actions/sales.ts` (`upsertManualSales` / `recordPayout`) / `apps/3dp/lib/sales-core.ts` / `apps/worker/src/tasks/tdp/sales-fetch.ts` / `cron-registry.ts` / `runner.ts` / テスト
- **やること**: **BOOTH に公開 API が無く、A2P にも売上取得の実装が無い**ので手入力が既定(D-11)。`upsertManualSales({listing_id, year_month, units, gross_jpy, note?})` — `published` の listing のみ。`(listing_id, year_month)` で upsert (**冪等**)。**欠測は行が無いで表す(0 を入れない限り 0 にならない)**。`fee_model_id` は記録時の媒体定義。`units × price_jpy` と `gross_jpy` が合わなければ画面に「価格と合わない」を出せるよう `price_mismatch` を算出。`recordPayout({medium, year_month, received_jpy, transfer_fee_jpy?, note?})` — `expected_net_jpy` をその月の計算値(`computeNet`)で保存し `diff_jpy` を算出(丸め方向の確定材料: F-3DP-32 ⑤)。`tdp.sales.fetch`: `sales_source='manual'` では `skipped` (`sales_manual_mode`) で終え、**「売上の最終入力 〈JST〉」**を結果に残す。`booth_manage_readonly` / `jinxxy_api` は**実装しない**(U-28 / U-5 が解けるまで。設定で選べない)。撤退モード中も止めない。
- **受入基準**: 同じ月を 2 回入力しても 1 行で最新値 / 入力しない月に行が作られない / `units=0` を明示した月は 0 として扱われ欠測と区別される / `year_month` が JST の月 / 手取りが件ごと `ceil` の手数料で算出(SP-3DP-06 の `computeNet`)/ 価格と合わない入力が `price_mismatch` / 入金差異が保存され差が `received - (expected - transfer_fee)` / cron 起点で `jobs` 行 / 公開されていない listing への入力は `listing_not_published` / 未認証 `auth`。
- **依存**: SP-3DP-10 T-3DP-10-01/-06, SP-3DP-06 T-3DP-06-03
- **参照**: F-3DP-31/32 / docs/12 §17.5.6, §17.4 (`upsertManualSales` `recordPayout`), §15.2 F-3DP-32, §11 U-28

### T-3DP-11-07 損益と原価 S-3DP-07 (月次損益・商品別・入金突合)

- **対象ファイル**: `apps/3dp/app/(app)/profit/page.tsx` / `apps/3dp/lib/profit-core.ts` (SP-3DP-05 のものを拡張) / `apps/3dp/app/(app)/profit/_components/*.tsx` / テスト
- **やること** (§9.8 S-3DP-07): ビューに **月次損益** / **商品別** を追加(既存の原価と歩留まりと並べる)。月次損益: 月 / 売上 / 手数料(媒体別)/ 振込手数料 / **手取り** / AI コスト(LLM・画像・Meshy credit に分けて)/ 実コスト / **手取り − 実コスト** / G-C の判定。Jinxxy は**別行「参考(判定対象外)」**で算入切替日があれば併記。入金の突合(計算上の手取りと実入金の差、入力欄)。取得状況(売上の最終入力 JST・**欠測期間は 0 円にしない**・失敗の理由)。商品別: 商品 / 出品日 / 公開日数 / 販売本数 / 売上 / 手取り + 上に「最初の 8 商品の累計 N 本 / ライン 5 本」。**予測月商は出さない**(U-7)。
- **受入基準**: 欠測の月が「未入力」で 0 円にならない / 当月純利益が売上の行なしで `null`(= 画面で `—` + 理由)/ 実コストに Meshy の月額(`tdp_meshy_plan_jpy_month`)が含まれる / AI コストの内訳が `token_usage` の `provider`・`role` から / Jinxxy が参考行で G-B/G-C の値に混ざらない / 月境界が JST / 「予測」「見込み月商」という語が画面に無い(走査テスト)。
- **依存**: T-3DP-11-04/-06, SP-3DP-05 T-3DP-05-07
- **参照**: F-3DP-32/45 / docs/12 §9.8 S-3DP-07, §17.10.1 (実コスト・手取り・ヒーロー指標 D-15), §9.6.3

### T-3DP-11-08 ホームの完成 (停止中パネル・成果・判定パネル) と全画面の停止帯

- **対象ファイル**: `apps/3dp/app/(app)/layout.tsx` (`StopBanner`) / `apps/3dp/app/(app)/page.tsx` / `apps/3dp/components/home/*.tsx` / `apps/3dp/components/layout/sidebar-nav.tsx` (異常の印) / `apps/3dp/lib/home-core.ts` / テスト
- **やること** (§9.8 S-3DP-01): ① **停止中バー**を全画面共通で(停止中だけ。ホームを開かないと気付けない状態を避ける: §9.13-2)② **停止中パネル**(G-D 発火時のみ最上部): 「新規出品を停止中」・発火時刻・発火元(自動検知 / 運営者)・原因の商品へのリンク・**解除の手順は文章 + 設定 安全装置タブへのテキストリンクのみ。ホームに解除ボタンを置かない**③ **成果**(ヒーロー): 当月純利益 (手取り − 実コスト。売上の行が無ければ `—` + 理由)・1 商品あたりの売上 (D-15)。Jinxxy は別行「参考」④ **判定パネル**を全行実体化し「最終算出 〈JST〉」・36 時間以上古い / 算出失敗のときの表の直上の警告 ⑤ Stage 2 では立ち上げチェックを畳む(全部済なら消える)⑥ 要対応に「公開状態の異常 N」「定期タスクの異常 N」「公開状態確認の不発(48 時間超)」⑦ ナビに**異常の印**(異常 / 不発 / 停止中)。
- **受入基準**: 停止中バーが**どの画面でも**出る(layout のテスト)/ ホームに解除ボタンが無い / `abnormal` 発火時の停止中パネルに発火元と原因商品リンク / ヒーローが売上なしで `0` を出さない / 判定パネルが総合点を持たない・4 値が全て別の形 / 算出が 36 時間超古い or `ok=false` の警告 / 「予測月商」が無い / Stage の切替が表示の順序と強調だけ。
- **依存**: T-3DP-11-03/-04/-05/-07。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-01-home/prompt.md` の停止中・Stage 0・判定パネル)
- **参照**: F-3DP-35/36/37/40 / docs/12 §9.8 S-3DP-01, §9.4, §9.13-2/5, §9.1 UR-1/2/4/6

### T-3DP-11-09 設定: 規制ゲート・運用・媒体の算入切替

- **対象ファイル**: `apps/3dp/app/(app)/settings/_tabs/safety-regulation.tsx` / `ops.tsx` / `media.tsx` (Jinxxy 算入切替を追加) / `apps/3dp/app/actions/regulation.ts` (T-3DP-11-03) / `apps/3dp/app/actions/media.ts` / テスト
- **やること** (§9.8 S-3DP-06): **安全装置タブ ⑤ 規制ゲート**: 状態(通常 / 停止中)・公開状態確認の最終成功・**「新規出品を止める…」**(確認ダイアログ 1 回・理由は任意)・**停止の解除**(停止中だけ。**畳まれた「停止を解除する…」**を本文より目立たない見た目で。展開すると原因(発火時刻・原因の商品・観測内容)と「原因を確認しましたか」の文言・理由の入力(必須・空不可・短すぎる入力は拒否)・送信ボタンは条件を満たすまで無効。解除後にもう一度確認ダイアログ「次の公開状態確認で異常が出ると再び停止します」)・**操作ログ**(時刻・発火元・理由)。**運用タブ**(他のタブから離した独立タブ): 撤退モード(確認ダイアログ + 理由必須。「新規の企画・生成・出品を停止。既存商品は公開のまま」)・縮退。2 行の説明で「新規出品の停止」と「撤退モード」を区別。**媒体タブ**: Jinxxy の「黒字判定に算入」切替は **Jinxxy の実着金(`tdp_payouts` の `medium='jinxxy'`)が記録済みのときだけ**可能で、切替日 (`tdp_jinxxy_gate_switched_at`) を残す。
- **受入基準**: 解除フォームが停止中以外では描画されない / 理由が最小文字数未満で送信ボタンが無効 / 解除が確認ダイアログを 2 回通る / 操作ログに発火と解除の両方 / 運用タブに停止ボタンが無く、安全装置タブに撤退モードが無い(取り違え防止)/ Jinxxy の着金記録なしの切替が拒否 / 切替日が保存 / 一括取り下げの部品が無い。
- **依存**: T-3DP-11-03/-06。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-06-settings/prompt.md` の解除の畳み / 展開)
- **参照**: F-3DP-40/44/45 / docs/12 §9.8 S-3DP-06 (安全装置の詳細・停止の解除・運用タブ), §9.13-5/8

### T-3DP-11-10 U-8 / U-11 / U-16 / U-28 の確定  ⛔ OP-10 / OP-12 / OP-13 / OP-15 待ち

- **目的**: 公開状態の判定条件を**実物で**確定する。確定できない場合は安全側の仮規則のまま運営者が受容を明示する。
- **対象ファイル**: `scripts/3dp/status-probe.ts` / `packages/contracts/src/tdp/listing-status.ts` (規則の確定) / `packages/contracts/src/tdp/__fixtures__/` (運営者の**自分の**商品の HTML のみ) / `docs/12-3dp-design.md` (§11 U-8/U-11/U-16/U-28)
- **やること**: `status-probe.ts <booth商品URL>` — 未ログインの素の `fetch` で取得し、`classifyObservation` の結果と判定に使った特徴(商品名の有無・購入導線の有無・最終 URL)を出力する(セッションに触れない)。運営者が自分の 1 商品で **公開 / 自主的に非公開**を比べる。差が出れば `rules_verified=true` にして `title_mismatch` / `no_purchase_cta` / `redirected_away` を異常候補に昇格し、実 HTML から作った(運営者の商品に限る)フィクスチャでテストを足す。**区別できなければ**: 運営者が ① 共用セッションで管理画面を読む二次案を**自分の判断で**有効にする(既定 OFF。実装は別タスクとして起票) ② 日次の目視確認に倒す、のどちらかを選び dev-plan に記録。強制非公開の見え方は**起きない限り分からない**ことを受容として記録。U-11 / U-28 の調査結果も記録。
- **受入基準**: U-8 / U-11 / U-16 / U-28 の行に「結論 / 実施日」か「未確認 (理由)」。`rules_verified` が true になるのは公開と非公開が**実物で区別できた場合のみ**(テスト: 区別できないフィクスチャで true にならない)。他人の商品ページを fixtures に置いていない。強制非公開を再現しようとしていない。
- **依存**: T-3DP-11-01, OP-10/12/13/15
- **参照**: docs/12 §16.6 (U-16 のクローズ条件), §11 U-8/U-11/U-16/U-28, §17.10.3

### T-3DP-11-11 E2E: 停止と解除・撤退・判定パネル

- **対象ファイル**: `tests/e2e/3dp/regulation.spec.ts` / `tests/e2e/3dp/home-stages.spec.ts`
- **シナリオ** (§17.13): ① **停止と解除**: 異常を作る(公開記録 + 観測 `abnormal`)→ 全画面に停止中バー・ホームに停止中パネル(解除ボタンなし)→ 設定の解除は畳まれ、19 字では送信不可、20 字で解除でき帯が消える ② 撤退モード: 運用タブ・確認・理由必須・既存商品が公開のまま・全画面の帯 ③ Stage 0 / 1 / 2 のホーム: `未評価` と `ok` の区別・「0 円」が出ない・判定パネルに予測月商なし・定期タスク 5 行が「一度も実行されていません」④ 判定パネルの 4 値の見た目 ⑤ 取り下げの記録後に `expected_public=false` ⑥ 売上の手入力で欠測が 0 にならない。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑。
- **依存**: T-3DP-11-08/-09
- **参照**: docs/12 §17.13 (停止と解除・空状態)

### T-3DP-11-12 設計書の追従と Inc-5 中盤の記録

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md`
- **やること**: F-3DP-31〜32・35〜37・39〜40・44〜46・49 の状態を実装範囲だけ更新。§7.3 の `tdp_tuning_json.booth_fetch` に `contact` を追記(本スプリントで足したキー)。§12 に実装状況。dev-plan に「**初回出品の前提チェック**」(下記 §7)を転記。OP-19 (TBD-5 の受容) の記録欄。
- **受入基準**: grep で F-3DP-40 が「未」でない / §7.3 に `contact` / dev-plan に前提チェックの表。コードは触らない。
- **依存**: T-3DP-11-11
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `classifyObservation` / `computeGates` (全ゲート × 4 値 × 境界) / `sales-core` / `profit-core` / `home-core` / 静的テスト(`tdp_kill_switch_on=false` は解除関数のみ・`gates.ts`/`hold.ts` にリテラル無し・セッション参照 0)。
- **Vitest (実 PG)**: kill switch のトランザクション・status.check の分岐・retention・snapshot・売上の冪等。
- **Playwright**: 停止と解除 / Stage 別ホーム。
- **手動 (自動化しない)**: 自分の商品での公開 / 非公開の比較 (OP-12)。**強制非公開は再現しない。**

## 7. 完了判定

- T-3DP-11-01〜12 が APPROVED + PASS (T-3DP-11-02 / -10 は運営者待ち ⛔)。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` / E2E 緑。
- **初回出品の前提チェック(機械的に確認。SP-3DP-12 の着手条件)**:

| # | 前提 | 確認方法 |
|---|---|---|
| 1 | `tdp.listing.status.check` が本番で 1 回以上成功している(対象 0 件でも `done` + `ok`/`skipped` でなく**実行された**) | 実行状況画面 / `jobs` |
| 2 | kill switch の発火・解除が本番で 1 回通っている(テスト用の商品または操作で。**実出品前に手順を一度通す**) | 操作ログ |
| 3 | `tdp.gates.snapshot` の最終算出が 36 時間以内で `ok=true` | ホーム |
| 4 | OP-09 (標準文面) / OP-11 (U-9/U-10) / OP-14 (U-19) / OP-10 / OP-12 / OP-19 が記録済み | dev-plan |
| 5 | `tdp_listings` の部分 UNIQUE・CHECK (e) が本番に適用済み | OP-18 |

- 申し送り: SP-3DP-12 が初回出品。**G-D の検知力が仮規則のまま(OP-12 が未了)なら、その旨を運営者が受容した記録が必要**。
