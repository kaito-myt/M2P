# SP-3DP-03 inc2a-ledger-submit-poll — 二重課金を防ぐ台帳と Meshy の投入・待ち (Inc-2 前半)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-01 の D-0 が A であること** (B の場合は `SP-3DP-01` §7 の凍結と前倒しに従い、pm を計画モードで再起動して本スプリントを再編する)。

## 1. 目的

Meshy は credit 課金 (事前購入) で、**再試行・並走・再起動・二重クリック・デプロイの並走**のどれが起きても同じ生成を 2 回払わない仕組みを、実キーを worker に入れる**前**に作って検証する。
この仕組み (台帳 `tdp_generations` と `meshy-submit.ts`) が 3DP で最も壊れてはいけない箇所なので (§17.17-5)、**検査・最適化・画面より先**に作る。

> **実キー投入の前提 (申し送り 4)**: worker / ポータルに Meshy の実キーを入れる前に、本スプリントの **T-3DP-03-02 (制約の統合テスト) / -07 / -08 / -09 / -10 が CI で緑**であること。
> これを満たすまで OP-01 のキーをポータル API 管理に登録しない。実キーでの初回実行は SP-3DP-05 T-3DP-05-11。

## 2. 対応機能 ID

F-3DP-05 (台帳経由の呼び出し), F-3DP-13 (一部: submit/poll), F-3DP-17 (credit の記録), F-3DP-46 (`jobs` 行: 基盤), F-3DP-48 (直列化), F-3DP-11 (Meshy キー: 解決経路)
対応する設計: §7.2 `TdpGeneration` / §7.4 (a)(b)(c) / §16.4.4 / §17.5.2 / §17.6 / §17.11

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-18** | 本番 DB への migration 適用 (T-3DP-03-01) と、worker の再デプロイ (T-3DP-03-11 は `Dockerfile` を変えるためイメージの再ビルドになる)。**`railway up --service A2P-Worker --detach` を使う (`redeploy --from-source` は反映されない)**。生成の最中でないことを確認してから | スプリント末 | 本番の worker は `@a2p/mesh` を含まないイメージのまま。ただし 3DP タスクは SP-3DP-05 まで cron に載らないので、**デプロイが遅れても本番は壊れない** |
| (OP-01) | Meshy キーの**ポータル API 管理への登録**は、本スプリントの CI が緑になってから (上記)。それまではローカル `.env.local` のみ | T-3DP-03-10 完了後 | 実キーでの初回実行ができない |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-03-01 | ⬜ | DB migration (Inc-2): 台帳・G-A 判定・外部値・Meshy 列 | `tdp_generations` ほか 3 表、`tdp_assets` 列、CHECK (a)(b)(c) | F-3DP-05, 48 | L |
| T-3DP-03-02 | ⬜ | 台帳制約の統合テスト | 部分 UNIQUE・CHECK・UNIQUE を実 PG で | F-3DP-48 | M |
| T-3DP-03-03 | ⬜ | `@a2p/credentials` に `meshy` | spec / store / test / `.env.example` / ポータル表示 | F-3DP-11 | M |
| T-3DP-03-04 | ⬜ | storage キーと `TdpJobResult` 契約 | R2 キー関数・`TdpReason`・`toTdpReason`・エラー型 | F-3DP-46 | M |
| T-3DP-03-05 | ⬜ | `transitionProduct` (状態遷移の唯一の入口) | CAS・許可表・`status_reason_json` | F-3DP-28 ① | M |
| T-3DP-03-06 | ⬜ | `runTdpTask` と中断シグナル | `jobs` 行・CAS・タイムアウト・結果の形 | F-3DP-46 | L |
| T-3DP-03-07 | ⬜ | 台帳の予約 `reserveGeneration` と credit 見積り | L1 / L8・上限の同一トランザクション判定 | F-3DP-14, 48 | L |
| T-3DP-03-08 | ⬜ | `tdp.meshy.submit` と `recordMeshyUsage` | **唯一の POST 箇所**・失敗系 10 ケース | F-3DP-05, 17 | L |
| T-3DP-03-09 | ⬜ | `tdp.meshy.poll` | 1 回 1 GET・自己再投入・R2 保存・成果物の冪等 | F-3DP-13 | L |
| T-3DP-03-10 | ⬜ | 二重課金・承認バイパスの静的テスト | grep 型の再発防止テスト | F-3DP-28 ①, 05 | S |
| T-3DP-03-11 | ⬜ | worker 配線 (Dockerfile・依存・lockfile・タスク登録) | `COPY packages/mesh` ほか | (Inc-2 漏らし防止) | M |

合計 **11 タスク**。

---

## 5. タスク詳細

### T-3DP-03-01 DB migration (Inc-2)

- **目的**: 台帳と、Inc-2 で使う列・制約を足す。**手書き SQL の (a)(b)(c) を Prisma が追跡しない**ので、存在を静的テストで固定する。
- **対象ファイル**: `packages/db/migrations/<timestamp>_tdp_inc2_generations/migration.sql` / `packages/db/schema.prisma` / `packages/contracts/src/tdp/settings.ts` (Meshy 系 4 列の既定を追加) / `packages/db/__tests__/tdp-migration.test.ts` (拡張)
- **やること**:
  - 新規 3 表: `tdp_generations` / `tdp_gate_a_judgements` / `tdp_resource_snapshots` (§7.2 のとおり、index 名も)。
  - `tdp_assets` の追加列 (`stage` `name` `generation_id` (UNIQUE) `parent_asset_id` `is_distribution` `inspect_ok` `inspected_at` `sha256` `normalized_json` `r2_state` `r2_purged_at`) と UNIQUE `(product_id, version, stage, name)`、`tdp_assets_retention_idx`。`tdp_products.derivative_rechecks_json`。`app_settings` の Meshy 系 4 列 (`tdp_meshy_model` 既定 **null**・`tdp_meshy_usd_per_credit` 0.02・`tdp_meshy_plan_jpy_month` 3000・`tdp_meshy_credit_table_json` null)。
  - 手書き SQL: **(a)** `tdp_generations_single_inflight` (部分 UNIQUE) **(b)** `tdp_assets_one_distribution` **(c)** `tdp_generations_parent_required` / `tdp_generations_state_valid` / `tdp_generations_task_id_required`。
  - 適用前の確認 SQL を先頭コメントと完了報告に結果つきで: ① `SELECT product_id, version, count(*) FROM tdp_assets GROUP BY 1,2 HAVING count(*) > 1;` が 0 行 ② `SELECT count(*) FROM tdp_assets;` (Inc-1 では生成していないので 0 の見込み)。
- **受入基準**:
  1. `prisma validate` / `generate` と `pnpm typecheck` 緑。
  2. `tdp-migration.test.ts` に追加: (a)(b)(c) と 2 つの CHECK 名が migration.sql に**存在**する / Meshy 系 4 列の `DEFAULT` が `TDP_SETTINGS_DEFAULTS` と一致 / 既存列の DROP・型変更が無い。
  3. `tdp_meshy_model` の既定が **null** (null の間は生成を始めない: §7.3)。
  4. 本番には適用しない (OP-18)。
- **依存**: SP-3DP-02 T-3DP-02-03
- **参照**: docs/12 §7.2, §7.3, §7.4 (a)(b)(c), §7.5, §17.17-6

### T-3DP-03-02 台帳制約の統合テスト

- **対象ファイル**: `packages/db/__tests__/tdp-ledger-constraints.int.test.ts` (新規)
- **受入基準 (実 PG)**:
  1. **(a)** `provider='meshy'` で `state IN ('submitting','submitted')` の行が 1 本あるとき、別商品の 2 本目を `submitted` にすると一意制約違反 (`23505`)。`reserved` / `failed` / `lost` / `succeeded` は何本でも入る。1 本目を `succeeded` にすれば 2 本目が入る。
  2. **(b)** 同じ商品に `is_distribution=true` が 2 行は不可。**`false` に倒してから `true`** の順なら 1 トランザクション内で付け替えられる (§17.5.5-2 の手順)。
  3. **(c)** `stage='refine'` かつ `parent_generation_id IS NULL` は `23514`。`preview` / `image` は親なしで可。`state='bogus'` は拒否。`provider='meshy'` で `state='submitted'` かつ `meshy_task_id IS NULL` は拒否、`provider='openai-image'` なら task_id 無しの `submitted` が可。
  4. `purpose_key` の重複は `23505`。`tdp_assets.generation_id` の重複 (1 対 1) も `23505`。`(product_id, version, stage, name)` の重複も同様。
  5. `pnpm test:integration` 緑。
- **依存**: T-3DP-03-01, SP-3DP-02 T-3DP-02-04
- **参照**: docs/12 §7.4, §17.13 (実 PG の統合テスト 2・3・5)

### T-3DP-03-03 `@a2p/credentials` に `meshy`

- **目的**: キーを **DB 優先 → env `MESHY_API_KEY` → null** で解決し、無ければ「3D 生成だけが止まる (degrade)」にする (Tavily と同じ規約)。
- **対象ファイル**: `packages/credentials/src/spec.ts` / `packages/credentials/src/store.ts` / `packages/credentials/src/test.ts` / `.env.example` (+ 各テスト)。ポータルの API 管理画面が自動で `meshy` を出さない場合に限り `apps/portal` の該当 1 ファイル。
- **やること**: §16.4.4 の表のとおり。`SERVICE_PROVIDERS` に `'meshy'`、`SERVICE_PROVIDER_META.meshy` (項目 `api_key`・secret・env `MESHY_API_KEY`)、`toMeshyCredentials`、`summarizeServiceFields` の `case`、`resolveMeshyCredentials()`、`testServiceCredentials` の `case 'meshy'` = **credit を消費しない** `GET /openapi/v1/balance`: `200` = 成功 (残高フィールドが取れなければ残高を出さず成功のみ) / `401`・`403` = 「キーが違います」/ それ以外 = 「原因不明 (HTTP 〇〇)」 — いずれも日本語。
- **受入基準**:
  1. `ServiceProvider` を広げたことで `switch` が型エラーになる箇所が**全て**解消され `pnpm typecheck` 緑 (漏れの機械検出)。
  2. `pnpm check:env` 緑 (`.env.example` に `MESHY_API_KEY=` がある)。
  3. テスト: DB に有効なキー → それを返す / 無く env あり → env / 両方無し → `null`。接続テストが 200 / 401 / 403 / 500 / ネットワーク断で日本語の 3 区分を返し、**キーを文面に含めない**。マスク表示は末尾のみ。
  4. ポータルの API 管理に Meshy が出ること (出ないなら該当ファイルを最小変更し、変更箇所を完了報告に書く)。
- **依存**: なし (SP-3DP-02 完了後ならいつでも)
- **参照**: F-3DP-11 / docs/12 §16.4.4, §15.2 F-3DP-11, §17.14 d-5, `docs/10-platform-portal.md` §10.4b-2

### T-3DP-03-04 storage キーと `TdpJobResult` 契約

- **対象ファイル**: `packages/storage/src/keys.ts` (+ テスト) / `packages/contracts/src/tdp/job-result.ts` (新規) / `packages/contracts/src/tdp/errors.ts` (新規) / `packages/contracts/package.json` (`./tdp/job-result` `./tdp/errors`)
- **やること**:
  - `keys.ts`: `TDP_PREFIX='3dp/'`、`tdpAsset(productId, ver, stage, ext, name?)` / `tdpPreview(productId, ver, name)` / `tdpPackage(productId, ver)` / `tdpDebug(productId, step, ts)` を §17.9.1 のとおり。既存の `assertId` と英小文字ハイフンの規約に準じ、`ver` は 1 以上の整数。
  - `job-result.ts`: `TdpReasonSchema` / `TdpJobResultSchema` (§17.5.3)、**理由コードの表** (§17.5.3 の 17 行の `code` を定数として)、`toTdpReason(err)` (Meshy 401/403/402/429/5xx・R2・タイムアウト・zod を `message_ja` に)。
  - `errors.ts`: `TdpHoldError extends ForbiddenError` (保留理由の配列を `details.reasons` に) と `TdpTimeoutError extends PipelineError` (`retryable: true`)。既存の `@a2p/contracts/errors` を再利用する。
- **受入基準**:
  1. キーのゴールデンテスト: `tdpAsset('prod1',2,'distribution','glb')` が `3dp/prod1/asset/v2/distribution.glb` 等、§17.9.1 の表の全行。大文字・スラッシュ・`ver<1` は throw。
  2. `code → message_ja` の対応表を**テストで固定** (文言の食い違いを防ぐ)。`error` 列に入る先頭文が日本語であること。
  3. `TdpJobResultSchema.parse` が `outcome` の 5 値を受け、`reasons` 101 件を拒否。
  4. exports を足し忘れていない: `apps/worker` から `import '@a2p/contracts/tdp/job-result'` が `typecheck` で解決。
- **依存**: SP-3DP-02 T-3DP-02-01
- **参照**: F-3DP-46 / docs/12 §17.5.3, §17.9.1, §17.11

### T-3DP-03-05 `transitionProduct` (状態遷移の唯一の入口)

- **目的**: `status` を書く箇所を 1 つに絞る (C-1)。再実行・並走・二重クリックで状態が巻き戻らない。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/product-transition.ts` / `apps/worker/src/tasks/tdp/lib/__tests__/product-transition.test.ts` / `apps/worker/src/tasks/tdp/lib/__tests__/product-transition.int.test.ts` / `apps/worker/package.json` (`test:integration` と `vitest.integration.config.ts`)
- **やること**: `transitionProduct(db, id, {from: Status[], to, patch?, reason?})`。① `canTransition` を `from` の各要素で検査し、表に無い辺は throw ② `UPDATE ... WHERE id=$1 AND status = ANY($from)` の更新件数が 0 なら `{changed:false}` で何もせず戻る (冪等) ③ `status_changed_at = now()` と `status_reason_json` を**必ず**更新 ④ `to` が `listed` / `approved` / `withdrawn` を含む呼び出しは `patch.approved_at` 等を要する (DB の CHECK が最後の砦)。
- **受入基準**:
  1. 単体: 表に無い辺 (`planned→listed`) は throw、`from` が複数の場合の許可判定。
  2. 実 PG: 同じ商品に対し 2 本の `generating→inspecting` を並走させると**ちょうど 1 本が `changed:true`**。`status_changed_at` が更新される。`approved_at` 無しで `listed` へは DB が拒否。
  3. `pnpm --filter @a2p/worker test:unit` と `test:integration` 緑。
- **依存**: SP-3DP-02 T-3DP-02-01/-04/-05
- **参照**: docs/12 §17.2 C-1, §17.3

### T-3DP-03-06 `runTdpTask` と中断シグナル

- **目的**: 全 `tdp.*` タスクを同じ枠で包み、F-3DP-46 (cron 起点を含め `jobs` 行を作る) と台帳 17 行の「理由の置き場所」を**一箇所で**満たす (C-3)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/run-tdp-task.ts` / `apps/worker/src/tasks/tdp/lib/shutdown.ts` / `apps/worker/src/tasks/tdp/lib/__tests__/run-tdp-task.test.ts` (+ 統合 1 本)
- **やること**: 手本は `apps/worker/src/tasks/note-engage.ts` (行を作れなくても本体は止めない)。
  1. `payload.job_id` があればその行、無ければ (cron) `payload_json={trigger:'cron'}` で自分で作る。`tdp_product_id` を入れる。
  2. `queued/failed → running` の CAS。既に `done` なら何もしない。
  3. **ハードタイムアウト 10 分 (描画系は 8 分)** で `AbortSignal` を発火し `TdpTimeoutError` に。`shutdown.ts` の `tdpShutdown` (`AbortController`) も合流させる。
  4. 本体の戻り `TdpJobResult` を `result_json` に書き `status` を確定 (`done` + `outcome`)。例外は `toTdpReason` で日本語 1 文を `error` に、`reasons` に書き、**再 throw** (graphile の再試行判定に委ねる)。
  5. `onFinalFailure`: `maxAttempts` を使い切ったとき、商品の `status_reason_json` に「◯◯の工程が失敗しました: 理由」を書く (状態は変えない)。
  6. **`jobs.status` の語彙 (`queued/running/done/failed/cancelled`) は変えない** (共有テーブル)。
- **受入基準**:
  1. cron 起点 (payload に `job_id` 無し) でも `jobs` 行が 1 本できる。行の作成に失敗しても本体が走る (注入した失敗で確認)。
  2. 既に `done` の行に対する 2 回目の実行は本体を呼ばない。
  3. 本体が 10 分 (テストでは短縮した注入値) を超えると `failed` / `TdpTimeoutError` / 日本語の `error`。
  4. 例外時に `result_json.reasons[0].message_ja` と `error` の先頭が一致。
  5. 実 PG: `queued→running` の CAS を 2 本並走させると片方だけが本体を実行。
- **依存**: T-3DP-03-04, T-3DP-03-05
- **参照**: F-3DP-46 / docs/12 §17.2 C-3, §17.5.2 (ハードタイムアウト), §17.5.3, §17.11

### T-3DP-03-07 台帳の予約 `reserveGeneration` と credit 見積り

- **目的**: L1 (意図の一意化) と L8 (上限の同一トランザクション判定)。**「並走する再生成がそれぞれ上限内に見えて合計で超える」を防ぐ。**
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/reserve-generation.ts` / `packages/contracts/src/tdp/credits.ts` (新規。`estimateCredits` 純関数) / `packages/contracts/package.json` / テスト (単体 + 実 PG)
- **やること**:
  - `estimateCredits(kind, model, table)`: 1 発合格 = preview + refine (+ remesh)。最悪の系列 = preview × `tdp_regen_limit_asset` + refine + remesh。`table` は `tdp_meshy_credit_table_json ?? {preview:20, preview_lite:5, refine:10, remesh:5}`。`meshy-6-lite` は `preview_lite`。
  - `reserveGeneration(db, {productId, stage, assetVersion, n, ...})`: 1 トランザクションで ① 商品行を `FOR UPDATE` ② 既に同じ `purpose_key` (`{product_id}:{asset_version}:{stage}:{n}`) があればそれを返す (`existing`) ③ 系列内の preview 試行数 < `tdp_regen_limit_asset`、企画全体の preview 試行数 < `tdp_regen_limit_product`、商品の credit 合計 + 今回 ≤ `credit_cap_per_product`、当月 (JST) の credit 合計 + 今回 ≤ `meshy_monthly_credit_cap` (合計は `credits_charged ?? credits_estimated`、`reserved` を含む) を数える ④ 通れば `reserved` を INSERT、通らなければ `blocked` と `TdpReason` (`regen_limit_asset` / `regen_limit_product` / `credit_cap_product` / `credit_cap_month`)。`credit_warn_per_product` 超は警告を返す。refine は `:refine:1`、失敗後の再試行だけ `:refine:2` まで (最大 2)。
  - 上限値は `loadTdpSettings` 由来の引数で受け、**関数内に数値リテラルを持たない** (C-5)。
- **受入基準**:
  1. 単体: 既定表で `estimateCredits` が 1 発合格 **35**、最悪系列 **75** (preview 3 回)。`meshy-6-lite` は 15 / `5×3+10+5=30`。表を差し替えると結果が変わる (リテラルが無いことの機械判定)。
  2. 実 PG: 同じ引数の `reserveGeneration` を 5 本並走 → **行は 1 つ**で、全員が同じ `id` を受け取る。
  3. 実 PG: 系列上限 3 のとき、異なる `n` で 5 本並走 → **`reserved` は 3 行**、2 本は `blocked` / `regen_limit_asset`。
  4. 月上限の JST 境界: `2026-09-30T15:00:00Z` 作成の台帳行は 10 月に数えられる。
  5. refine の `:refine:3` は予約できない。
- **依存**: T-3DP-03-01, T-3DP-03-05, SP-3DP-02 T-3DP-02-07
- **参照**: docs/12 §17.6.1 (L1, L8), §17.6.4, §7.3 (上限の列), §17.2 C-4/C-5

### T-3DP-03-08 `tdp.meshy.submit` と `recordMeshyUsage`

- **目的**: **`createTextTo3d` / `createRemesh` を呼んでよい唯一のファイル。**L2〜L5・L7 を実装する。
- **対象ファイル**: `apps/worker/src/tasks/tdp/meshy-submit.ts` / `apps/worker/src/tasks/tdp/lib/meshy-usage.ts` / テスト 2 本 (単体: fetch 注入 / 実 PG)
- **やること**: 設計 §17.6.2 の擬似コードをそのまま実装する (手順の番号と臨界区間を崩さない)。
  1. `state !== 'reserved'` なら即 `skipped('already_claimed')`。キー未設定 / `tdp_meshy_model` が null なら **POST 前に** `failedBeforePost` (台帳は `reserved` のまま、商品に理由)。
  2. 投入権の CAS `reserved→submitting`。部分 UNIQUE 違反 (`tdp_generations_single_inflight`) なら 60 秒後に**自分を再投入して譲る** (attempts を消費しない)。
  3. POST は **`AbortSignal.timeout(30s)` のみ** (shutdown のシグナルを渡さない = 臨界区間)。`definitelyNotCreated` な 4xx は `failed`、429 は `reserved` に戻して 120 秒後に再投入 (最大 15 回で `meshy_busy`)、それ以外 (ネットワーク断・5xx・タイムアウト) は **`lost`・再投入しない**・LINE 通知 (`isLineRelayConfigured` でなければ `jobs` に理由)。
  4. `task_id` を**専用の 1 文**で永続化 (`submitting→submitted`)。失敗は 100ms / 500ms / 2s の最大 3 回再試行 (DB 書込みの再試行は課金しない)。全滅なら task_id を構造化ログ (`tdp.taskid.persist_failed`) と `jobs.result_json` に出して throw。
  5. `recordMeshyUsage()`: `token_usage` に `tool='3dp'` / `role='tdp.meshy'` / `provider='meshy'` / `model=ai_model` / `input_tokens=0` / `unit_price_snapshot={unit:'credit',credits,usd_per_credit,fx_rate_usd_jpy,stage}` / `cost_jpy = credits × usd_per_credit × fx`。**credit を `input_tokens` に押し込まない。** 為替は既存の取得 (`token_usage.unit_price_snapshot.fx_rate_usd_jpy` と同じ出所) を使う。**FAILED でも課金済みとして残す** (U-26 が確定するまで)。
  6. 世代の `jobs` 行 (`kind='tdp.meshy.poll'`, `status='running'`) を作って台帳 `job_id` に書き、`tdp.meshy.poll` を `{queueName:'tdp-meshy', maxAttempts:8, runAt: now+間隔, jobKey:'tdp-poll:{id}:1'}` で投入。
  7. `addJob('tdp.meshy.submit')` 側の呼び出し (SP-3DP-04 の `tdp.asset.generate`) は **`maxAttempts:1`**。本タスクの単体テストで submit 自身が再試行されない前提 (`maxAttempts` を渡す側の責務) をコメントで明記。
- **受入基準 (§17.13 の失敗系 10 ケースを全て。`fetch` の呼出回数で判定)**:

| ケース | 期待 |
|---|---|
| 正常 | POST **1 回**・task_id 永続化・`token_usage` **1 行**・poll 投入 |
| 同じ `generation_id` で submit を 2 回 | POST は**合計 1 回** |
| 並走する 2 本 (`Promise.all`) | POST 1 回、片方は `already_claimed` |
| POST が 402 / 400 | `failed`・credit 0・再投入されない |
| POST が 429 | `reserved` に戻り 120 秒後に再投入・attempts を消費しない |
| POST が reject (ネットワーク) / 500 | `lost`・再 POST しない・LINE 通知 |
| POST 成功後に task_id 保存が 1 回失敗 | 再試行して保存・POST は 1 回 |
| 別の生成が `submitted` の間に 2 本目 | 部分 UNIQUE 違反 → 60 秒後に自分を再投入 |
| refine を親なしで | DB の CHECK で拒否 / クライアントでも拒否 |
| キー未設定 / モデル未設定 | POST 0 回・台帳は `reserved` のまま・商品に理由 |

  加えて: ① `token_usage` の `input_tokens` が 0 ② `result_json` / ログに API キーが含まれない ③ `pnpm check:llm-client` 緑。
- **依存**: T-3DP-03-01/-02/-03/-04/-06/-07、SP-3DP-01 T-3DP-01-01 (`definitelyNotCreated`・`aiModel`)
- **参照**: F-3DP-05/17 / docs/12 §17.6.1〜§17.6.5, §17.12 (`token_usage` 記録フック), §17.13 (失敗系)

### T-3DP-03-09 `tdp.meshy.poll`

- **目的**: 待ちで worker を占有せず (D-6)、完了時の成果物を**冪等**に保存する (L9)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/meshy-poll.ts` / テスト (単体 + 実 PG)
- **やること**: **POST しない** (GET と R2 / DB 書込みだけ。`maxAttempts` 8)。
  - 1 回の実行で `getTask` を **1 回**。`PENDING / IN_PROGRESS` は進捗を台帳 (`last_progress` `poll_count` `last_polled_at`) と世代の `jobs.result_json.progress` に書き、自分を `{runAt: now+interval, queueName:'tdp-meshy', maxAttempts:8, jobKey:'tdp-poll:{id}:{n+1}'}` で再投入して終わる。間隔は `tdp_tuning_json.meshy_poll_interval_sec` (**null → 暫定 15 秒**)、上限は `meshy_poll_max_minutes` (**null → 暫定 45 分、設定の上限 90 分**)。画面用に「暫定値」であることを `result_json` に持つ。
  - 上限超過: 台帳 `failed` (`failure_code='poll_timeout'`)・**credit は課金済みとして数える**・同じタスクが後で完了しても拾わない。GLB を保存せず捨てる前に `task_id` を `jobs.result_json` に残す。
  - `SUCCEEDED`: **その場で** GLB を取得 (取得 URL は作成後の期限つき) → R2 `tdpAsset(...)` へ (キー固定なので再実行は同じキーを上書き) → `tdp_assets` 行 + 台帳 `succeeded` + `meshy-task.json` (URL は落とす) を**同一トランザクション**で。商品を `generating→inspecting` (`transitionProduct`)。次に `tdp.asset.inspect` を `jobs` 行つきで投入 (preview → `stage:'shape'`、refine → `'final'`。タスクの実装は SP-3DP-04。名前で投入するだけ)。
  - `FAILED / CANCELED`: 台帳 `failed` (原文は `detail` に 300 字まで、`message_ja` は「Meshy が生成に失敗しました (再生成の上限内で自動的にやり直します)」)。`tdp.asset.generate` (`reason:'meshy_failed'`) を投入 (上限判定は関所の責務)。
  - 完了/失敗/タイムアウトで世代の `jobs` 行を `done`/`failed` に確定する。
- **受入基準**:
  1. PENDING → `getTask` が 1 回、再投入が 1 件 (`n+1`・`runAt ≥ 間隔`・`queueName='tdp-meshy'`・`maxAttempts=8`)。
  2. SUCCEEDED を**2 回実行**しても `tdp_assets` は 1 行 (実 PG の `generation_id` UNIQUE)。R2 への書込みキーが §17.9.1 と一致。
  3. 上限超過で GLB の取得が 0 回・台帳 `failed`/`poll_timeout`・`task_id` が `jobs.result_json` に残る。
  4. FAILED で `tdp.asset.generate` が `reason:'meshy_failed'` で投入される。
  5. この関数から `createTextTo3d` / `createRemesh` への参照が無い (T-3DP-03-10 の静的テストでも保証)。
  6. 世代の `jobs` 行が 120 分を超えて `running` のままにならない (設定の上限 90 分で打ち切る) ことをテストで確認 (`sweepStaleJobs` が 120 分超を孤児扱いするため)。
- **依存**: T-3DP-03-01/-04/-05/-06/-08
- **参照**: F-3DP-13 / docs/12 §17.5.2 (Meshy の待ち), §17.5.4 (`tdp.meshy.poll`), §17.6.1 L9, §17.9.1, §17.14 d-4 (`locks-sweep`)

### T-3DP-03-10 二重課金・承認バイパスの静的テスト

- **目的**: 「他の場所から課金呼び出しを足す」「承認を経由せず `listed` を書く」変更を CI で赤にする (再発防止)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/__tests__/static-guards.test.ts` (リポジトリ全体を走査する単体テスト)
- **受入基準**:
  1. `createTextTo3d(` / `createRemesh(` の呼び出し箇所が **`meshy-submit.ts` と `packages/mesh/src/probe.ts` (SP-3DP-01 の例外。許可リストに理由コメントつき) と各 `__tests__`** に限られる。定義 (`packages/mesh/src/meshy.ts`) は除く。
  2. `status: 'listed'` / `'approved'` / `'withdrawn'` を書き込む箇所 (Prisma の `update`/`updateMany`/`create` の `data` や生 SQL) が `product-transition.ts` に限られる (migration・テスト・型定義は除く)。
  3. `schema.prisma` の `app_settings` に `auto.*approv` に一致する列が**存在しない** (自動承認フラグを追加しないこと自体が受入条件: F-3DP-28 ①)。
  4. `api.meshy.ai` の文字列が `packages/mesh/` の外に無い。
  5. **ミューテーション確認**: 検査対象ディレクトリに一時的に違反コードを置くと各テストが赤になることを確認し、その出力を完了報告に貼る (テストが空振りしていないことの証明)。
  6. `pnpm test:unit` に含まれ、CI で走る。
- **依存**: T-3DP-03-05, T-3DP-03-08
- **参照**: docs/12 §17.13 (静的テスト), §17.2 C-1/C-9, F-3DP-28 ①

### T-3DP-03-11 worker 配線 (Dockerfile・依存・lockfile・タスク登録)

- **目的**: **Inc-2 の漏らしやすい実装タスク** (§17.17-3) を 1 つにまとめて確実に入れる。
- **対象ファイル**: `apps/worker/Dockerfile` / `apps/worker/package.json` / `pnpm-lock.yaml` / `apps/worker/src/runner.ts` / `apps/worker/src/__tests__/` (配線テスト)
- **やること**: ① `Dockerfile` の `deps` ステージに `COPY packages/mesh/package.json packages/mesh/package.json` ② `apps/worker/package.json` に `"@a2p/mesh": "workspace:*"` ③ **同じ変更で `pnpm-lock.yaml` を更新** (`pnpm install --frozen-lockfile` が通る) ④ `buildTaskList()` に `tdp.meshy.submit` / `tdp.meshy.poll` を `runTdpTask` で包んで登録 ⑤ `three` はここでは足さない (SP-3DP-08)。
- **受入基準**:
  1. `pnpm install --frozen-lockfile` が通る。`pnpm --filter @a2p/worker typecheck` / `test:unit` 緑。
  2. 配線テスト: `Dockerfile` の `deps` ステージに `packages/mesh/package.json` の COPY があること / `buildTaskList()` のキーに 2 タスクがあること。
  3. 既存のタスク登録を壊さない (既存の `buildTaskList` テスト緑)。
  4. 本番デプロイは OP-18。**未デプロイでもコード完了とする**が、完了報告に「デプロイ未実施」と書く。
- **依存**: T-3DP-03-08, T-3DP-03-09
- **参照**: docs/12 §17.14 d-4, §16.9 (ビルド上の注意), §17.17-3

---

## 6. テスト計画

- **Vitest (単体)**: `estimateCredits` / `toTdpReason` / storage キー / `runTdpTask` / `meshy-submit` (fetch 注入で失敗系 10 ケース) / `meshy-poll` / 静的テスト。
- **Vitest (実 PG)**: 台帳制約 (a)(b)(c) / `transitionProduct` の並走 / `reserveGeneration` の並走 / `runTdpTask` の CAS / `meshy-poll` の冪等。
- **Playwright**: なし (画面なし)。
- **実キー**: 使わない。合成レスポンスは `__fixtures__/meshy/` に置き、**ファイル名と先頭コメントに「合成」と明記** (SP-3DP-05 T-3DP-05-11 で実応答に差し替える)。

## 7. 完了判定

- T-3DP-03-01〜11 が `/iterate` で APPROVED + PASS。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` (CI で `TDP_REQUIRE_PG=1`) / `pnpm check:env` / `pnpm check:llm-client` 緑。
- **レビュー観点 (code-reviewer に明示)**: §17.6.1 の L1〜L9 と §17.13 の失敗系。`createTextTo3d` / `createRemesh` を `meshy-submit.ts` 以外から呼ぶ変更は却下。手書き SQL (a)(b)(c) が migration にあること。
- 申し送り: SP-3DP-04 は `reserveGeneration` / `transitionProduct` / `runTdpTask` を使う。実キー投入の前提 (本スプリントの CI 緑) を満たしたことを SP-3DP-05 T-3DP-05-11 の着手条件として dev-plan に記録。
