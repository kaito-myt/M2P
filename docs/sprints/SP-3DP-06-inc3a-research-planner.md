# SP-3DP-06 inc3a-research-planner — 週次リサーチ・企画の自動作成・依拠性の許可規則 (Inc-3)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-05 完了で P-0 = A。** P-0 が B の場合、本スプリントの前に SP-3DP-07 (テクスチャ経路) を置いて再編する。
> **注意**: 本スプリントは Inc-2 の実測 (U-14 の歩留まり・U-13 のポーリング値) を入力にする。着手時に pm を計画モードで再起動して、実測と食い違うタスクを直してよい。

## 1. 目的

運営者が試作を 1 点ずつ登録する段階から、**企画が自動で立ち、依拠性ガードを通った物だけが生成に流れる**段階へ。
同時に、**市場の実際の言い回し (全アバター対応・N 体対応・ツール名対応) を R-2 が誤って弾かない**ように許可規則を入れる (F-3DP-22。過剰に弾くと市場に存在しない書き方しか残らず、緩いとアカウントを失う)。
**量を増やすための増分ではない**: 企画の自動作成は在庫上限 (残枠の 2 倍) と R-1 の天井の内側でしか動かさない。

## 2. 対応機能 ID

F-3DP-18 (週次リサーチ), F-3DP-19 (企画 + 構成比), F-3DP-20 (価格下限・手取り), F-3DP-22 (許可規則), F-3DP-23 (BOOTH 公開データ: **U-8 待ち**), F-3DP-24 (リサーチ画面), F-3DP-21 (Inc-2 で前倒し済み)
対応画面: S-3DP-05 (新規), S-3DP-06 (企画と価格タブ), S-3DP-02 (試作登録に手取り表示)

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-10** | **U-8: BOOTH の改定後スクレイピング・ガイドライン本文を読み、「常識的な範囲の取得」が公開カテゴリページの低頻度取得を許容するかを判断する** (pixiv は 2025-10-10 に許容方針を公表したが、当方は本文を未読)。許容 → T-3DP-06-06 を実装 / 許容と読めない → **Tavily / LLM の Web 検索経由に倒す** (初版の前提) | T-3DP-06-06 の着手前。**同じ回答が SP-3DP-11 の公開状態確認 (`tdp.listing.status.check`) の前提でもある** | T-3DP-06-06 は ⛔ のまま。`tdp_booth_public_fetch_enabled` は OFF のまま。リサーチは売上と過去所見と Web 検索のみで完走する (設計どおりの degrade) |
| OP-20 | 提案値 (A-1〜A-14) のうち、企画に効くもの (種別構成比 50/30/20・価格下限 ¥500・在庫上限 = 残枠の 2 倍) の「確認した」 | フラグ `tdp_planner_enabled` を ON にする前 | 提案値のまま動く (注意書きが残る) |
| (操作) | `tdp_research_enabled` / `tdp_planner_enabled` を ON にする (実行状況画面 S-3DP-08。**再起動は不要**: cron は常時登録) | 本スプリントの完了後 | 既定 OFF のまま。cron は `skipped` の `jobs` 行を作るだけ |
| OP-17 | S-3DP-05 は `prompt.md` が無い (designer の対象に入っていない)。§9.8 の文章から実装する | — | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-06-01 | ⬜ | DB migration (Inc-3): リサーチ所見 | `tdp_research_findings`・`source_research_id` | F-3DP-18 | S |
| T-3DP-06-02 | ⬜ | research / planner の I/O 契約 | zod・`validateResearchOutput` | F-3DP-18, 19 | M |
| T-3DP-06-03 | ⬜ | 媒体の手数料モデルと `computeNet` | 手取り 6 行を期待値に固定 | F-3DP-20, 50 (一部) | M |
| T-3DP-06-04 | ⬜ | **依拠性ガードの許可規則 (F-3DP-22)** | 通る 13 / 弾く 6 類型 | F-3DP-22, 01 | M |
| T-3DP-06-05 | ⬜ | `tdp.research` / `tdp.planner` の実装と seed | DB プロンプト・実行時注入 | F-3DP-18, 19 | L |
| T-3DP-06-06 | ⛔ | BOOTH 公開データ取得 | 週 1・間隔 3 秒・最大 10 ページ・robots.txt | F-3DP-23 | M |
| T-3DP-06-07 | ⬜ | `tdp.market.research` タスク | 区分単位 catch・Tavily 事前検索・upsert | F-3DP-18, 46 | L |
| T-3DP-06-08 | ⬜ | `tdp.product.plan` タスク | 在庫上限・構成比・ガード #1・生成への投入 | F-3DP-19, 20 | L |
| T-3DP-06-09 | ⬜ | 設定「企画と価格」タブと手取り表示 | 構成比・価格下限・手取り早見表・試作登録の手取り | F-3DP-19, 20, 38 | M |
| T-3DP-06-10 | ⬜ | リサーチ画面 S-3DP-05 | 所見・企画の内訳・拒否率・実行状況 | F-3DP-24, 22 ⑤ | L |
| T-3DP-06-11 | ⬜ | E2E: 企画の自動作成とリサーチ画面 | 見送り理由・拒否の内訳・フラグ切替 | F-3DP-19, 24 | M |
| T-3DP-06-12 | ⬜ | 設計書の追従と Inc-3 完了の記録 | docs/12・dev-plan | (Rule #7/#8) | S |

合計 **12 タスク**。

---

## 5. タスク詳細

### T-3DP-06-01 DB migration (Inc-3)

- **対象ファイル**: `packages/db/migrations/<ts>_tdp_inc3_research/migration.sql` / `packages/db/schema.prisma` / `packages/db/__tests__/tdp-migration.test.ts` (拡張)
- **やること**: `tdp_research_findings` (§7.2。`UNIQUE(week_key, kind_group)`) と `tdp_products.source_research_id` (FK `ON DELETE SET NULL`)。既存を DROP / 型変更しない。
- **受入基準**: `prisma validate` / `generate` と typecheck 緑。静的テストに `tdp_research_week_group_key` の存在を追加。実 PG で `(week_key, kind_group)` の重複が `23505`。本番未適用 (OP-18)。
- **依存**: SP-3DP-03 T-3DP-03-01
- **参照**: docs/12 §7.2 `TdpResearchFinding`, §17.15 Inc-3

### T-3DP-06-02 research / planner の I/O 契約

- **対象ファイル**: `packages/contracts/src/agents/tdp.ts` (追記) / テスト
- **やること**: §17.7.1 / §17.7.2 の zod を実装 (`KindGroupSchema` `TdpKindSchema` `MediumIdSchema` `TdpResearchInputSchema` `TdpResearchOutputSchema` `TdpPlannerInputSchema` `TdpPlanCandidateSchema` `TdpPlannerOutputSchema`、`TdpPlanDetail` 型)。**`validateResearchOutput(input, output)`**: `basis='booth_public'` なのに `input.booth_public===null`、`basis='web_search'` なのに `web_search_results` が空、は不合格 (LLM が観測していない価格帯を「観測した」と書く事故の防止)。
- **受入基準**: 各 zod の境界値 (`title` 60 字・`concept` 20〜800 字・候補 6 件・`size_m ≤ 5`)。出所偽装の 2 ケースが不合格、正当なケースが合格。`pnpm --filter @a2p/contracts test:unit` 緑。
- **依存**: SP-3DP-04 T-3DP-04-04 (ファイル新設済み)
- **参照**: docs/12 §17.7.1, §17.7.2

### T-3DP-06-03 媒体の手数料モデルと `computeNet`

- **目的**: 「販売価格 → 手数料 → 手取り」を**純関数**にし、価格下限と承認画面と損益が同じ式を読む (F-3DP-20)。
- **対象ファイル**: `packages/contracts/src/tdp/media.ts` (新規) / `packages/contracts/package.json` / テスト
- **やること**: `TDP_MEDIA` の型は 5 項目 (手数料モデル・AI 開示の方法と義務性・出品枠・自動化可否・黒字判定への算入) を**必須**にし、欠けた媒体は型エラー。BOOTH の `fee_model_id='booth-2025-10-28'`: サービス利用料 = `ceil(price × 0.056 + 45)` / 件、手取り = 価格 − 利用料 (= **手取りは切り捨て**。F-3DP-20 ②の決定と §13.3.1 の表に合わせる)。`computeNet(medium, price, units?)` — **1 件単位で算出**して合計。`missingMediaFields(media)`。Jinxxy は枠 0 (出品しない) の保守的な既定。AI 開示の**文面**は SP-3DP-08。
  - **設計書内の食い違い (本タスクで解消方針を固定)**: §17.5.6 は `fee = floor(price × 0.056) + 45` と書くが、これだと ¥100 の手取りが ¥50 になり、**F-3DP-20 ② (手取りは切り捨て) と §13.3.1 の 6 行の期待値 (¥100→¥49) と矛盾する**。F-3DP-20 の受入は 6 行を期待値に固定すると明記しているので、**`ceil` を採る**。実売上との差異は F-3DP-32 ⑤ (`tdp_payouts`) で突合し、丸めが判明したら期待値を直す。§17.5.6 の式の訂正は T-3DP-06-12。
- **受入基準**: 手取り 6 行 (¥100→**¥49** / ¥300→**¥238** / ¥500→**¥427** / ¥800→**¥710** / ¥1,000→**¥899** / ¥1,500→**¥1,371**) を §13.3.1 の表そのものとして期待値に固定。`units` 件は件ごとに算出した合計 (月合計の `gross` から一意に決まらないときの検算は SP-3DP-11)。5 項目のどれかが欠けた媒体定義がコンパイルエラー (`@ts-expect-error` テスト)。判定にリテラルを持たず手数料率は `fee_model` から読む。
- **依存**: なし
- **参照**: F-3DP-20/50 / docs/12 §13.3.1, §17.5.6, §15.2 F-3DP-20 ②

### T-3DP-06-04 依拠性ガードの許可規則 (F-3DP-22)

- **目的**: **過剰に弾かず、緩くもしない。** 市場上位の言い回しをそのまま通し、固有名詞への依拠は弾く。事業の成立条件。
- **対象ファイル**: `packages/contracts/src/tdp/derivative-guard.ts` / 既存テストファイル (追記)
- **やること**: 許可を**語の列挙でなく「`対応`/`専用`/`用`/`向け` の主語の型」**で定義: 主語が (a) 数量表現 (`全` / 数字+`体` / 数字+`アバター` / `以上`) または (b) プラットフォーム・ツール・フォーマット名のときだけ `specific_avatar_fit` を通し、**主語が固有名詞のものは従来どおり弾く**。決定論 (LLM 非使用)。拒否率の算出関数 `rejectionRate(products)` (F-3DP-22 ⑤・F-3DP-47)。
- **受入基準**:
  1. **必ず通る入力 (§13.2 の実観測タイトル)**: 「シンプルジェルネイル【54アバター対応】」/「【100アバター以上対応】HoroNail」/「†Lost Bind† ボディピアス（全アバター）」/「全アバター対応ボディピアス」/「N体対応」/「Modular Avatar 対応」/「MA 対応」/「lilToon 対応」/「Poiyomi 対応」/「宙の詩EyeTexture」/「リアル肌 Material」/「モダンなインテリア・家具セット」/「和風アンティーク風ランタン」 — **13 本すべて**が `allowed=true`。(設計書の本文は「この 12 件」と書くが列挙は 13 本。数え違いと判断して列挙を正とし、完了報告に記録。docs/12 の訂正は T-3DP-06-12)
  2. **必ず弾く 6 類型**: 「セレスティア対応アクセサリ」(固有名詞 + 対応) / 「ミコトちゃん専用衣装」/ 「某有名アバター風の角」(`style_imitation`) / 「◯◯先生のデザインを再現」(`creator_reference` + `fan_work_wording`) / `™` `®` `©` を含む文 / 運営者が `tdp_derivative_denylist` に登録した語を含む文。**6 類型すべて `allowed=false`**。
  3. 既存 20 件 + SP-3DP-04 T-3DP-04-03 の英語テストが**無変更で緑**。同じ入力で結果が不変 (決定論)。
  4. 造語ブランド名 (「宙の詩EyeTexture」) は通る。他者のブランド名の担保は禁止語の運用であることをコメントに明記 (ガードは実在を知り得ない)。
  5. `rejectionRate`: 分母 0 のとき `null` (0% にしない)。
- **依存**: SP-3DP-04 T-3DP-04-03
- **参照**: F-3DP-22 / docs/12 §15.2 F-3DP-22 (①〜⑥), §12 (判定仕様), §13.2

### T-3DP-06-05 `tdp.research` / `tdp.planner` の実装と seed

- **対象ファイル**: `packages/agents/src/tdp/research.ts` / `packages/agents/src/tdp/planner.ts` / `packages/db/seed-tdp.ts` (追記) / テスト
- **やること**: §17.7.0 の共通規約 — `loadActivePrompt(role, null)`・**エージェントはツールを呼ばない** (Tavily / BOOTH / 売上はタスクが決定論的に集めて入力に入れる)・所見/構成比/禁止語/価格下限/媒体は **user メッセージへ実行時注入** (`prompts` 本文は不変)・運営者の指示はメッセージの**最後**。モデルは `tdp.research` = `claude-opus-5` / `tdp.planner` = `claude-opus-5` (seed の初期値。`model_assignments` に role ごと active 1 件。`claude-sonnet-5` 系には temperature を渡さない)。`tdp.planner` のプロンプトで**「実在の作品・作家・キャラクターに寄せない」「作れない物を企画しない (`kind_limits`)」「推測と事実を分ける」**を明示。
- **受入基準**: fake LLM で zod 検証通過 / 不正 JSON は最大 2 回再呼び出し。**`prompts` の本文がリサーチ・企画の前後でバイト一致** (F-3DP-18 の受入)。`withTokenLogging` が `tool='3dp'`・role 別に記録。seed の冪等 (2 回実行で重複なし)・各 role に active 1 件。`pnpm check:llm-client` 緑。
- **依存**: T-3DP-06-02, SP-3DP-04 T-3DP-04-04
- **参照**: F-3DP-18/19 / docs/12 §17.7.0〜§17.7.2, §8, §15.2 F-3DP-18

### T-3DP-06-06 BOOTH 公開データ取得  ⛔ OP-10 待ち

- **目的**: リサーチの入力として、BOOTH の公開カテゴリページの**価格帯・件数・上位商品の傾向**を低負荷で取得する。**U-8 を読まずに実装してはいけない** (これ自体が受入のゲート: F-3DP-23)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/booth-public-fetch.ts` / テスト (HTML は**合成**。実物の保存は運営者の 1 商品に限り、他人の商品ページを fixtures に置かない)
- **やること** (OP-10 で許容と判断されたとき): 週 1・同時 1 (直列)・リクエスト間隔 **3 秒以上**・1 回の実行で最大 **10 ページ**・`robots.txt` を尊重・UA に連絡先を明示 (設定 `tdp_tuning_json.booth_fetch` から読む。連絡先は `booth_fetch.contact` — SP-3DP-02 T-3DP-02-01 で足したキー。**未設定なら取得しない**)。カテゴリ 4 種 (3D装飾品 / 3Dテクスチャ / 3D小道具 / 3D環境・ワールド)。`cheerio` で題名・価格・順位を抽出。**失敗は URL 単位で記録して続行** (`{url, reason}` を返す)。フラグ `tdp_booth_public_fetch_enabled` が false なら呼ばれない。OP-10 が「許容と読めない」なら**本タスクは実装せず**、`tdp.market.research` は Web 検索経由のまま。
- **受入基準**: 注入した `fetch` / 時計で ① 間隔 3 秒未満にリクエストしない ② 11 ページ目を取らない ③ `robots.txt` の Disallow を取らない ④ UA に連絡先が入る ⑤ 1 ページの失敗で他が続く ⑥ フラグ OFF で 0 リクエスト。
- **依存**: OP-10
- **参照**: F-3DP-23 / docs/12 §15.2 F-3DP-23, §16.6, §11 U-8, §17.5.4 (`tdp.market.research`)

### T-3DP-06-07 `tdp.market.research` タスク

- **対象ファイル**: `apps/worker/src/tasks/tdp/market-research.ts` / `packages/contracts/src/tdp/cron-registry.ts` (`implemented: true`) / `apps/worker/src/runner.ts` / テスト
- **やること**: §17.5.4 の行どおり。`tdp_research_enabled` が**明示的に false** なら `skipped` (`flag_off`)。3 区分 (`accessory` / `texture` / `prop_furniture`) を**区分単位の try/catch** で順に: 過去 8 週の売上 (区分別。Inc-3 時点は空でよい) / 前週の所見 / Tavily 事前検索 (キー無しは省いて `web_search=false`) / BOOTH 公開 (フラグ ON のときのみ) → `tdp.research` を 1 回 → zod + `validateResearchOutput` → `tdp_research_findings` を `(week_key, kind_group)` で upsert。`week_key` は JST の ISO 週。結果は `{groups, updated, failed}` + `reasons[]` (失敗した区分と理由)。全区分失敗でも throw せず `outcome='failed'`。ハードタイムアウトは 12 分 (例外)。
- **受入基準**: ① 1 区分が失敗しても残りが更新され `outcome='partial'`・`reasons` に失敗区分 ② Tavily キー無しで完走し `web_search_used=false` ③ フラグ OFF で `jobs` 行が `done`+`skipped`、LLM 0 回 ④ **`prompts` 本文が実行前後でバイト一致** ⑤ 同じ週を 2 回実行しても所見は 1 行 ⑥ 実 PG で `week_key` の JST 境界 (月曜 0:00 JST の前後) が正しい ⑦ `CRON_ITEMS` に入り、`buildTaskList()` にある (静的テスト緑)。
- **依存**: T-3DP-06-01/-02/-05。T-3DP-06-06 は任意 (無ければ Web 検索のみ)
- **参照**: F-3DP-18/46 / docs/12 §17.5.4, §17.5.3 台帳 #1〜#3, §17.7.1

### T-3DP-06-08 `tdp.product.plan` タスク

- **対象ファイル**: `apps/worker/src/tasks/tdp/product-plan.ts` / `packages/contracts/src/tdp/kinds.ts` (新規。`TDP_IMPLEMENTED_KINDS`) / `cron-registry.ts` / `runner.ts` / テスト
- **やること**: §17.5.4 の行どおり。① フラグ false → `skipped` ② 停止中 / 撤退中 → `skipped` ③ **「ブロックされた `planned` の再投入」** (`status_reason_json` が設定未了系の商品を `tdp.asset.generate` へ戻す) ④ **在庫判定**: 在庫 = `planned`〜`approved` の非終端商品数。`在庫 > 残枠 × stock_cap_multiplier` → `skipped` (`stock_over_cap`: 「見送り: 在庫 N 件 > 残枠の 2 倍 (M)」)。残枠は `computeSlots` (Inc-3 時点の公開数は `tdp_products.listed_at` の当月 JST 件数、予約 0。**SP-3DP-10 で予約込みに差し替える**ことをコメントに) ⑤ 区分ごとの目標数を `tdp_kind_weights_json` から按分 (1 回の実行で最大 2 件。**最大剰余法で決定論**)。**`TDP_IMPLEMENTED_KINDS` に無い種別 (テクスチャは SP-3DP-07 まで) は重みから除いて再按分**する (生成経路の無い企画が `planned` で滞留するのを防ぐ) ⑥ `tdp.planner` を呼ぶ (最新所見・直近 90 日の題名・価格下限・`kind_limits`・禁止語を実行時注入) ⑦ **各候補に R-2 ガード #1 と価格下限**を適用し `planned` / `rejected` で保存 (拒否も行を残す。`origin='planner'`・`source_research_id`・`plan_json`)。`planned` ごとに `jobs` 行 + `tdp.asset.generate` (`reason:'initial'`) を投入。
- **受入基準**:
  1. **ガードで拒否された企画が `tdp.asset.generate` を 1 件も投入しない** (投入関数の呼出回数 0。F-3DP-19 ①の機械判定)。
  2. 在庫 5・残枠 2・倍率 2 → `skipped`/`stock_over_cap` で planner 呼び出し 0 回。在庫 4 なら通る。
  3. 按分: 重み 50/30/20・N=2 で結果が決定論、`texture` が未実装なら `accessory` と `prop_furniture` のみで合計 N、いずれの区分も N を超えない。
  4. 価格 499 の候補は `rejected` (`price_below_min`) で保存、生成に流れない。
  5. フラグ OFF・停止中・撤退中はそれぞれ `skipped` で理由が異なる。`jobs` 行が必ず 1 本できる。
  6. `token_usage` が `tool='3dp'`・`tdp.planner`。planner 呼び出しの前後で `prompts` 本文が不変。
  7. 手動実行の対象に**ならない** (`manual_run=false` を静的テストで固定: credit に流れるため)。
- **依存**: T-3DP-06-01/-02/-03/-04/-05, SP-3DP-05 T-3DP-05-01
- **参照**: F-3DP-19/20 / docs/12 §17.5.4 (`tdp.product.plan`), §15.2 F-3DP-19 ①②③, §17.10.4

### T-3DP-06-09 設定「企画と価格」タブと手取り表示

- **対象ファイル**: `apps/3dp/app/(app)/settings/_tabs/plan-price.tsx` / `apps/3dp/app/(app)/products/_components/trial-dialog.tsx` / `apps/3dp/lib/settings-groups-core.ts` (構成比の検証) / テスト
- **やること**: 種別構成比 (合計 100%。装飾品 / テクスチャ / プロップ・家具の 3 区分。**「テクスチャは準備中のため企画されません」を表示**) / 価格下限 / `ready` 在庫の上限 (倍率) / **手取りの早見表** (販売価格 → 手数料 → 手取り の 6 行。`computeNet` から。端数は切り捨てである旨) / 試作登録ダイアログに「販売価格 → 手数料 → 手取り」を並べる。価格が下限未満なら登録不可 (理由つき)。
- **受入基準**: 構成比の合計 ≠ 100 は拒否 (拒否値と現在値)。早見表 6 行が T-3DP-06-03 の期待値と一致。ダイアログの手取りが `computeNet` と一致。価格下限は `tdp_min_price_jpy` から読み、コードの `500` を使っていない (grep)。
- **依存**: T-3DP-06-03, SP-3DP-02 T-3DP-02-07/-08, SP-3DP-05 T-3DP-05-03
- **参照**: F-3DP-19/20/38 / docs/12 §9.8 S-3DP-06 (企画と価格タブ), §15.2 F-3DP-20

### T-3DP-06-10 リサーチ画面 S-3DP-05

- **対象ファイル**: `apps/3dp/app/(app)/research/page.tsx` / `apps/3dp/lib/research-core.ts` / `apps/3dp/components/layout/nav-items.ts` (「リサーチ」を有効化) / テスト
- **やること** (§9.8 S-3DP-05): ① **実行状況** (最終実行 JST・`{種別数, 更新数, 失敗数}`・**失敗した種別と理由**・次回予定・フラグ・Web 検索の有無 =「売上と過去所見のみ」) ② **種別別の所見** (ピル。観点・知見・狙う題材・避ける題材・**観測価格帯 + 取得日 + 出所**) ③ **企画の内訳** (直近 N 件の採用 / 拒否。拒否は種別別。**拒否率**と 50% 超の「規則が過剰である疑い」警告。**見送りの理由** = 在庫 > 残枠の 2 倍) ④ **BOOTH 観測** (取得ページ数・日・取得できなかったページと理由。U-8 未了の間は「LLM の Web 検索経由で実行中」) ⑤ 過去の所見 (畳む)。所見は**画面から編集しない**。リサーチの手動実行は S-3DP-08 から。空状態 (実行 0 回) は「週次リサーチはまだ一度も実行されていません」+ 次回予定 / フラグ / Tavily キーの有無 (§9.6.3)。
- **受入基準**: `research-core` の単体: 拒否率の分母 0 → `—`、50% 超で警告、観測価格帯に取得日と出所が必ず付く (欠けたら表示しない)、見送りの理由が `jobs` の `stock_over_cap` から読める。空状態に空の所見表が出ない。運営者向け文言に `Inc-` が無い。
- **依存**: T-3DP-06-04/-07/-08。OP-17 (S-3DP-05 は `prompt.md` なし)
- **参照**: F-3DP-24 / docs/12 §9.8 S-3DP-05, §9.6.3, §9.7 台帳 #1〜#5

### T-3DP-06-11 E2E: 企画の自動作成とリサーチ画面

- **対象ファイル**: `tests/e2e/3dp/research.spec.ts` / `tests/e2e/3dp/plan-skip.spec.ts`
- **シナリオ**: ① 実行 0 回のリサーチ画面で空状態の文言と次回予定 ② 区分が 1 つ失敗した `jobs` を用意 → 失敗した区分と理由が読める ③ 在庫超過の `skipped` が S-3DP-05 と S-3DP-08 に「見送り: 在庫 N 件 > 残枠の 2 倍 (M)」と出る ④ 拒否の内訳 (「〜風」「専用」) と拒否率の警告 ⑤ 実行状況で `tdp_planner_enabled` を ON/OFF → DB が変わる・再起動不要の文言 ⑥ `tdp.product.plan` に「今すぐ実行」が**無い**。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑。
- **依存**: T-3DP-06-10, SP-3DP-05 T-3DP-05-06
- **参照**: docs/12 §17.13 (Playwright), §9.8 S-3DP-05/08

### T-3DP-06-12 設計書の追従と Inc-3 完了の記録

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md`
- **やること**: F-3DP-18〜24 の状態を実装範囲だけ「実装済」に (F-3DP-23 は OP-10 の結論つき)。F-3DP-22 の受入「この 12 件」を「13 件」に訂正し数え違いを注記。§17.5.6 の BOOTH 手数料式 `floor(price × 0.056) + 45` を `ceil(price × 0.056 + 45)` に訂正 (F-3DP-20 ② / §13.3.1 と整合。T-3DP-06-03 の判断)。§12 に Inc-3 の実装状況。dev-plan §11 の Inc-3 を完了に。
- **受入基準**: grep で F-3DP-22 の行に「13」、§17.5.6 に `ceil`。コードは触らない。
- **依存**: T-3DP-06-11
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: contracts (agents/tdp・media・guard の許可規則)、research / planner (fake LLM)、market-research / product-plan の分岐 (fetch・時計・LLM を注入)、research-core。
- **Vitest (実 PG)**: `tdp_research_findings` の UNIQUE、`week_key` の JST 境界、plan の在庫判定。
- **Playwright**: 2 本。
- **LLM の実呼び出しは本番の worker のみ** (cron)。ローカルで実呼び出しをする場合は `token_usage` に記録される経路だけを使う。

## 7. 完了判定

- T-3DP-06-01〜12 が APPROVED + PASS (T-3DP-06-06 は OP-10 の結論が「許容と読めない」なら**対象外として理由を記録**してよい。その場合も完了報告に結論を書く)。
- `pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` / `E2E_TARGET=3dp ... playwright` 緑。
- **Inc-3 の完了条件 (§10)**: 企画が自動で立ち、依拠性ガードを通って生成に流れる。ただし**既定は両フラグ OFF**。ON にするのは運営者 (OP-20 の確認後)。ON にして最初の 1 回の実行結果 (S-3DP-05 と S-3DP-08) を運営者が見て問題なければ完了とする。
- 申し送り: 企画の種別にテクスチャが無いこと (SP-3DP-07 で `TDP_IMPLEMENTED_KINDS` に追加)。OP-10 の結論は SP-3DP-11 (公開状態確認) の前提になる。
