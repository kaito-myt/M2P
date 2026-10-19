# SP-3DP-02 inc1-foundation — 安全装置の天井・設定の形・実 PG テスト基盤 (Inc-1 の残り)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち

## 1. 目的

**後から足すと移行が要るものだけ**を Inc-1 に前倒しで入れる (§17.17-2): R-1 の天井 12、`approved` / `withdrawn` を許可値に含む状態の CHECK、`tdp_tuning_json` を含む `app_settings` の列、U-9/U-10 の回答欄、`jobs.tdp_product_id`。
併せて、後続すべてのスプリントが依拠する**実 PG の統合テスト基盤**を作る (現リポジトリには存在しない: `@testcontainers/postgresql` はどの `package.json` にも無く、`ci.yml` に Postgres サービスも無い)。

> **D-0 との関係**: 本スプリントは D-0 (SP-3DP-01) を待たずに着手してよい。ただし T-3DP-02-02 (天井 50 → 12) は D-0 の結果に関わらず価値がある安全修正なので**最初に入れる**。D-0 が C (撤退協議) になった場合でも、安全装置 (R-1 / R-2) は残す。

## 2. 対応機能 ID

F-3DP-38 (判定値を `app_settings` に), F-3DP-41 (R-1 天井), F-3DP-11 (設定画面の一部), F-3DP-12 (一覧の一部), F-3DP-02 (枠の判定), F-3DP-42 (U-9/U-10 回答欄まで), F-3DP-35 (ホームの一部: ヒーロー差し替え)
対応画面: S-3DP-01 (部分), S-3DP-02 (部分), S-3DP-06 (安全装置・企画と価格・生成・判定値タブ)

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-04** | 実 PG テストの置き場の決定: **A** Docker Desktop を使う (`@testcontainers/postgresql`) / **B** ローカルに空の PG を用意し `TDP_TEST_DATABASE_URL` を渡す / **C** CI の Postgres サービスのみで実行 (ローカルは skip) | T-3DP-02-04 の着手前 | 既定は **C** (ローカルでは skip、CI で `TDP_REQUIRE_PG=1` により必須)。ただし **SP-3DP-05 T-3DP-05-11 (実キー投入) の前提は「CI で統合テストが緑」** なので C でも進められる |
| **OP-11** | **U-9 / U-10 に回答** (T-3DP-02-09 の画面ができ次第。コードの完了は待たない — 聞くだけなので今でもよい) | 初回出品 (SP-3DP-12) の前まで。**早いほど R-1 初期値の判断に使える** | 未回答のまま出品を始められない (F-3DP-42。実装は SP-3DP-10 の `hold_u9_u10`)。回答欄は本スプリントから出る |
| **OP-17** | ワイヤーフレーム PNG の生成 (S-3DP-01 / S-3DP-06 の `prompt.md` を ChatGPT に投入)。本スプリントの UI は `prompt.md` と §9.8 の文章で実装できるので**ブロッカーではない** | T-3DP-02-08 / -10 の着手前が望ましい | `prompt.md` と §9.8 から実装する |
| **OP-18** | 本番 DB への migration 適用 (T-3DP-02-03 の出力)。適用前の `SELECT` 結果 (下記) を運営者が確認 | スプリント末 | 適用されないと本番の設定画面が新しい列を読めず落ちる。**コードのデプロイより先に migration を適用する** |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-02-01 | ✅ | contracts: 設定の既定値・状態機械 | `settings.ts` / `status.ts` と exports | F-3DP-38, 41 | M |
| T-3DP-02-02 | ✅ | **R-1 の天井を 12 に (アプリ側)** | 50 → 12、拒否時に拒否値と現在値、丸めない | F-3DP-41 | S |
| T-3DP-02-03 | ✅ | DB migration (Inc-1) + 一致テスト | `app_settings` 列・`tdp_products` 列・`jobs` 列・CHECK (d)(f) | F-3DP-38, 41 | L |
| T-3DP-02-04 | ✅ | 実 PG テスト基盤 | 統合テストの harness・CI の Postgres・`TDP_REQUIRE_PG` | (全体の前提) | L |
| T-3DP-02-05 | ✅ | DB 制約の統合テスト | CHECK / FK を実 PG で固定 | F-3DP-28 ①, 41 | S |
| T-3DP-02-06 | ✅ | `computeSlots` (枠の計算) | `hold.ts`、`canListMore` を委譲 | F-3DP-02, 30 | S |
| T-3DP-02-07 | ✅ | 設定グループの core・loader・Action | 検証・提案値の確認状態・媒体別枠 | F-3DP-38, 41 | M |
| T-3DP-02-08 | ✅ | 設定画面のタブ化と提案値バッジ | 4 タブ + 注意書き + 確認操作 | F-3DP-11, 38 | L |
| T-3DP-02-09 | ✅ | U-9 / U-10 回答欄 | Action と安全装置タブ内のフォーム | F-3DP-42 | S |
| T-3DP-02-10 | ✅ | ホーム・商品一覧の Inc-1 差分 | ヒーロー差し替え・空状態・立ち上げチェック・状態ピル | F-3DP-12, 35 | M |
| T-3DP-02-11 | ✅ | E2E 基盤 (`apps/3dp`) | Playwright の 3dp 対象・設定天井と空状態のシナリオ | F-3DP-41 | L |
| T-3DP-02-12 | ⬜ | 設計書の追従 | docs/12 の増分表・cron 表・不整合の訂正、docs/10 の env 名 | (Rule #7/#8) | S |

合計 **12 タスク**。

---

## 5. タスク詳細

### T-3DP-02-01 contracts: 設定の既定値・状態機械

- **目的**: 判定値・上限・状態の**定義箇所を 1 つ**にする (C-5)。
- **対象ファイル**: `packages/contracts/src/tdp/settings.ts` (新規) / `packages/contracts/src/tdp/status.ts` (新規) / `packages/contracts/package.json` (`exports` に `./tdp/settings` `./tdp/status` — **列挙式なので足し忘れると import できない**)。テストは既存 `derivative-guard` のテストと同じ場所。
- **やること**:
  - `settings.ts`: `TDP_MONTHLY_LIMIT_HARD_MAX = 12`。`TDP_SETTINGS_DEFAULTS` — §7.3 の列のうち **Meshy 系 4 列 (`tdp_meshy_model` / `_usd_per_credit` / `_plan_jpy_month` / `_credit_table_json`) を除く全部** (Meshy 系は SP-3DP-03 の migration)。`TdpTuningSchema` (§7.3 の全キーと既定、`meshy_poll_interval_sec` / `meshy_poll_max_minutes` は nullable、**`meshy_poll_max_minutes` は 90 以下**、`render_selfcheck` / `booth_fetch` は入れ子。**`booth_fetch` には設計 §7.3 に無い `contact: string | null` (既定 null) を足す** — F-3DP-23 / F-3DP-39 の「UA に連絡先を明示」を満たすための運営者の連絡先。未設定のまま BOOTH を取得するタスクは実行しない。docs/12 §7.3 への追記は SP-3DP-11 T-3DP-11-12)。`parseTuning(json)` は**欠けたキーを既定で補い**、型違いのキーは既定に戻す (保存時の検証は別: T-3DP-02-07)。`kindGroup(kind)` — accessory→accessory / texture→texture / prop・furniture→prop_furniture (D-16)。
  - `status.ts`: `PRODUCT_STATUSES` を §9.5 の流れの順 (`planned, generating, inspecting, needs_fix, ready, review, approved, listed, withdrawn, failed, rejected`)、`TERMINAL_STATUSES` (`failed, rejected, withdrawn`)、`ALLOWED_TRANSITIONS` (§17.3 の T-1〜T-16 を from→to の辺として)、`canTransition(from, to)`。
  - T-3DP-02-02 で定数だけ先に `settings.ts` へ作成済で、`apps/3dp/lib/settings-core.ts` は re-export している (定義は contracts の 1 箇所)。ここではこのファイルを拡張する。
  - **判断の記録**: `TDP_MONTHLY_LIMIT_HARD_MAX` の定義は `settings.ts` の 1 箇所とする (§17.14 d-2 ④ は `derivative-guard.ts` からの export と書くが、定義が 2 箇所になるのを避ける。`derivative-guard.ts` は必要ならここから import)。
- **受入基準 (機械判定)**:
  1. `TDP_MONTHLY_LIMIT_HARD_MAX === 12`。`TDP_SETTINGS_DEFAULTS` のキー集合が §7.3 の表 (Meshy 系を除く) と**完全一致** (テストに期待キー一覧を持つ)。
  2. `parseTuning({})` が全キー既定、`parseTuning({stall_hours:'x'})` が `stall_hours=24`、`meshy_poll_max_minutes:91` を `TdpTuningSchema.safeParse` が**拒否**する。
  3. `canTransition`: §17.3 の全辺が true。表に無い辺 (`planned→listed`, `review→listed`, `listed→approved`) が false。**`listed` への入辺が `approved→listed` のただ 1 本**。`TERMINAL_STATUSES` の出辺が 0。
  4. `apps/3dp` から `import { TDP_MONTHLY_LIMIT_HARD_MAX } from '@a2p/contracts/tdp/settings'` が `pnpm --filter @3dp/web typecheck` で解決する。
  5. `pnpm --filter @a2p/contracts test:unit` / `typecheck` 緑 (既存 `derivative-guard` 20 件を含む)。
- **依存**: なし
- **参照**: F-3DP-38/41 / docs/12 §7.3, §17.1, §17.3, §17.2 C-5

### T-3DP-02-02 R-1 の天井を 12 に (アプリ側)

- **目的**: 現行の上限 50 (= 既定 8 の 6 倍強で「今月だけ 30 商品」ができる) を即時に塞ぐ。
- **対象ファイル**: `apps/3dp/lib/settings-core.ts` / `apps/3dp/app/actions/settings.ts` / `apps/3dp/lib/messages.ts` / `apps/3dp/app/(app)/settings/limit-form.tsx` / `apps/3dp/lib/__tests__/settings-core.test.ts`
- **やること**: `MONTHLY_LIMIT_MAX = 50` を廃し `TDP_MONTHLY_LIMIT_HARD_MAX` (T-3DP-02-01) を参照。`validateMonthlyLimit` は**丸めずに失敗**を維持しつつ、失敗結果に `{refused:number|null}` を持たせる。Action は拒否時に「**13 は保存されていません。サーバー側で拒否しました (最大 12)。現在の値: 8**」の形の文面 (`messages` に関数として)。入力欄の `max` と注記「設定できる最大は 12 です (コード側の固定値。この画面からは変更できません)」を常時表示。
- **受入基準**:
  1. `validateMonthlyLimit`: 12 → ok / 13・50・-1・1.5・`''`・`null`・`'abc'` → `ok:false` (**空や null を 0 として受けない**既存挙動を維持)。
  2. Action のテスト: 13 を渡すと DB 更新関数が**呼ばれず**、返却文面が「13」「最大 12」「現在の値」を含む。未認証は拒否され DB を読み書きしない (`code:'auth'` は `ActionResult` の拡張を伴うため T-3DP-02-07 の受入基準 4 で実装。T-3DP-02-02 では見送り → T-3DP-02-07 で実装済)。
  3. `apps/3dp` 配下に数値リテラル `50` が天井として残っていない (`grep -rn "MONTHLY_LIMIT_MAX\|0〜50" apps/3dp` が 0 件)。
  4. `grep -rn "TDP_MONTHLY_LIMIT_HARD_MAX *=" apps packages` が contracts の 1 件のみ。
  5. 既存の `settings-core.test.ts` を壊さず、天井関連のみ更新。`pnpm --filter @3dp/web test:unit` / `typecheck` 緑。
- **E2E 持ち越し (T-3DP-02-11 へ)**: このタスクの E2E は**基盤が無く実行できなかった**ため T-3DP-02-11 に持ち越した。Vitest では取れない検証項目の詳細は T-3DP-02-11 の「持ち越し検証項目」を参照。掴む testid は `limit-form.tsx` に追加済み (`tdp-limit-error` / `tdp-limit-success`)。
- **依存**: T-3DP-02-01
- **参照**: F-3DP-41 / docs/12 §9.10.3-1, §9.8 S-3DP-06 (R-1 入力), §17.14 d-3

### T-3DP-02-03 DB migration (Inc-1) + 一致テスト

- **目的**: Inc-1 に前倒しする列と制約を、**本番適用済みの 3 テーブルを壊さずに**足す。
- **対象ファイル**: `packages/db/migrations/<timestamp>_tdp_inc1_foundation/migration.sql` (手書き) / `packages/db/schema.prisma` / `packages/db/__tests__/tdp-migration.test.ts` (新規。既存 `schema.test.ts` は壊さない)
- **やること**:
  - `app_settings`: §7.3 の列から **Meshy 系 4 列を除く全部** (`DEFAULT` は `TDP_SETTINGS_DEFAULTS` と同値)。
  - `tdp_products`: `origin` / `plan_json` / `target_media` / `status_changed_at` / `status_reason_json` / `lineage_no` / **`approved_at`** — `approved_at` は §17.15 では Inc-4 の列だが、**CHECK (d) `tdp_products_approval_required` がこの列を参照する**ため Inc-1 に前倒す (設計書内の不整合を本タスクで解消。docs/12 への反映は T-3DP-02-12)。`approved_by` / `approved_asset_version` ほかの承認系は Inc-4。`index` は `tdp_products_stall_idx` / `tdp_products_origin_idx`。
  - `jobs`: `tdp_product_id` (nullable, FK → `tdp_products` `ON DELETE SET NULL`) + `jobs_tdp_product_kind_idx` + `jobs_kind_time_idx`。
  - CHECK **(d)** `tdp_products_status_valid` (許可値に `approved` / `withdrawn` を含む 11 値) と `tdp_products_approval_required`、**(f)** `app_settings_tdp_limit_range` (0〜12。`tdp_jinxxy_monthly_limit` を含む)。**(a)(b)(c) と `task_id_required` は対象テーブル/列が無いので Inc-1 には入らない** (§17.15 の Inc-1 行の「CHECK (a)(d)(f)」は (d)(f) の誤り。SP-3DP-03 で入れる)。
  - **適用前の確認 SQL を migration.sql の先頭コメントと、タスク完了報告に結果つきで書く**:
    ① `SELECT DISTINCT status FROM tdp_products;` (許可値の部分集合か) ② `SELECT tdp_monthly_publish_limit FROM app_settings;` (**12 を超えていたら適用せず運営者に報告**。黙って丸めない: §7.4-f) ③ `SELECT count(*) FROM jobs;` (`jobs` は A2P/ANP と共有で、索引作成中は書込みがブロックされる。行数が大きければ運営者に低負荷時の適用を依頼。`CONCURRENTLY` は Prisma のトランザクション内で使えない)。
  - **レビュー手順 (§17.17-6)**: `prisma migrate diff` は手書き SQL の CHECK / 部分索引を追跡しない。レビュー時に **(d)(f) が migration.sql に存在すること**を下記テストで機械確認する。
- **受入基準**:
  1. `pnpm --filter @a2p/db exec prisma validate` と `generate` が通り、`pnpm typecheck` 全体が緑。
  2. `tdp-migration.test.ts` (migration.sql を読む静的テスト): ① 追加した各 `app_settings` 列の `DEFAULT` が `TDP_SETTINGS_DEFAULTS` と**一致** ② `tdp_products_status_valid` の許可値リストが `PRODUCT_STATUSES` と**集合一致** ③ `app_settings_tdp_limit_range` が存在し上限が `TDP_MONTHLY_LIMIT_HARD_MAX` と同値 ④ 既存列・既存 index を **DROP / ALTER TYPE していない** (正規表現で `DROP COLUMN|DROP INDEX|ALTER COLUMN .* TYPE` が 0 件) ⑤ 全ての `ADD COLUMN` が NULL 許容か DEFAULT 付き。
  3. 既存 `packages/db/__tests__/schema.test.ts` が緑。
  4. **本番には適用しない** (OP-18)。完了報告に確認 SQL の実行結果 (ローカル/本番のどちらに対してか明記) を含める。
- **依存**: T-3DP-02-01
- **参照**: docs/12 §7.2 (tdp_products / Job), §7.3, §7.4 (d)(f), §7.5, §17.15, §17.17-6

### T-3DP-02-04 実 PG テスト基盤

- **目的**: 「直列性は PG の性質でありモックで証明できない」(§16.5.1 罠 2) を満たす土台。台帳・CAS・部分 UNIQUE・キューの統合テストが全部これに乗る。**実キー投入の前提 (申し送り 4) はこのテストが緑であること。**
- **対象ファイル**: `packages/db/src/testing/pg.ts` (新規。`packages/db/package.json` の `exports` に **`./testing`** を足し、`apps/worker` など他パッケージの統合テストから `@a2p/db/testing` で import できるようにする) / `packages/db/package.json` (`test:integration` と devDependencies) / `packages/db/vitest.integration.config.ts` (新規。`*.int.test.ts` のみ) / ルート `package.json` (`test:integration`: `pnpm -r --if-present test:integration`) / `.github/workflows/ci.yml` (Postgres サービス付きジョブ)。スモークテストは `packages/db/__tests__/pg-helper.int.test.ts`。
- **やること**:
  - `withTestDb(fn)`: ① `TDP_TEST_DATABASE_URL` があればそれを使い、無く Docker が使えれば `@testcontainers/postgresql` で起動 (OP-04 の A/B/C に従う) ② テストファイルごとに一意のスキーマを作り `search_path` を設定 ③ `packages/db/migrations/*/migration.sql` を**ディレクトリ名の昇順に全部適用** ④ 後始末でスキーマを DROP。
  - **最初に確認して記録すること**: 既存の全 migration が空 DB に再生できるか。通らない場合 (拡張・既存データ前提など) は理由を完了報告に書き、3DP の検証に必要な最小のテーブル (`app_settings` / `tdp_*` / `jobs` / `token_usage` と graphile の `runMigrations`) だけを作る手順に倒す。**どちらにしたかを `src/testing/pg.ts` の冒頭コメントに残す。**
  - `TDP_REQUIRE_PG=1` のとき、PG に到達できなければテストを **skip ではなく失敗**させる。未設定で到達できない場合は skip + 目立つ警告ログ。CI ジョブは `services: postgres:16` + `TDP_TEST_DATABASE_URL` + `TDP_REQUIRE_PG=1`。
  - graphile-worker の `runMigrations` を呼べる関数も `src/testing/pg.ts` に (SP-3DP-03/04 のキュー統合テストが使う)。
- **受入基準**:
  1. スモークテスト `packages/db/__tests__/pg-helper.int.test.ts`: スキーマを作り、`tdp_products` に 1 行 INSERT/SELECT できる。2 つのテストファイルが同時に走っても互いのデータが見えない。
  2. PG に到達できる環境で `pnpm test:integration` が緑。`TDP_REQUIRE_PG=1` かつ PG 不達で**赤になる**ことを、環境変数を壊して確認した出力を完了報告に貼る。
  3. `ci.yml` に統合テストのジョブがあり、`TDP_REQUIRE_PG=1` が設定されている (`pnpm test:integration` を呼ぶ)。既存ジョブ (`typecheck` / `test:unit` / `check:env`) は変更しない。
  4. `docs/03-tech-selection.md` に、実際に採用した方式 (testcontainers か URL か) を 1 行追記 (同書は既に `@testcontainers/postgresql` を前提に書いているので、実態と食い違うなら訂正)。
- **依存**: T-3DP-02-03 (migration を再生するため)、OP-04
- **参照**: docs/12 §16.5.1 罠 2, §17.13 (実 PG の統合テスト), §17.17-4

### T-3DP-02-05 DB 制約の統合テスト

- **目的**: 「承認を経由しない `listed` を DB が拒否する」(S-4) などを**実 PG で固定**する。
- **対象ファイル**: `packages/db/__tests__/tdp-constraints.int.test.ts` (新規)
- **受入基準 (全て実 PG で)**:
  1. `status='listed'` かつ `approved_at IS NULL` の INSERT / UPDATE が CHECK 違反 (`23514`)。`approved_at` ありなら成功。`approved` / `withdrawn` も同様。
  2. `status='bogus'` が拒否される。11 値すべてが (`approved_at` 条件を満たせば) 受理される。
  3. `app_settings.tdp_monthly_publish_limit` に 13 / -1 を UPDATE すると拒否、12 / 0 は成功。`tdp_jinxxy_monthly_limit` も同様。
  4. `jobs.tdp_product_id` に存在しない商品 ID が入らない (FK)。商品を DELETE すると該当 `jobs` 行の `tdp_product_id` が NULL になり行は残る。
  5. `pnpm test:integration` 緑。
- **依存**: T-3DP-02-03, T-3DP-02-04
- **参照**: docs/12 §7.4 (d)(f), §17.13 の実 PG 項 3

### T-3DP-02-06 `computeSlots` (枠の計算)

- **目的**: R-1 の枠計算を**予約込みの純関数**にする (D-2)。Inc-5 の予約を足せる形を先に作り、`canListMore` は薄いラッパにする。
- **対象ファイル**: `packages/contracts/src/tdp/hold.ts` (新規。`deriveHoldReasons` は SP-3DP-10) / `packages/contracts/src/tdp/derivative-guard.ts` (`canListMore` を委譲) / `packages/contracts/package.json` (`./tdp/hold`) / テスト
- **やること**: §17.10.4 の `computeSlots({limit, publishedThisMonth, activeReservations})`。`limit` は `min(limit, TDP_MONTHLY_LIMIT_HARD_MAX)` で読む。`used = published + reserved`、`remaining = max(0, limit - used)`、`allowed = remaining > 0`。`canListMore` は `reservations=0` で `computeSlots` へ委譲し、**戻り値の形と文言を変えない**。
- **受入基準**:
  1. 既存 `derivative-guard` のテスト 20 件が**無変更で緑**。
  2. `canListMore` の旧実装をテスト内に複製し、`listed ∈ [0,12]` × `limit ∈ [0,12]` の全組で戻り値が新実装と一致 (回帰)。
  3. `computeSlots`: `limit=20` を渡しても `limit` は 12 に切られる。予約 2 + 公開 7 + 上限 8 → `remaining=0, allowed=false`。
  4. JST 月境界のヘルパテスト (`jstMonthRange` を `@a2p/contracts/cost-attribution` から使う): UTC `2026-09-30T14:59:59Z` は 9 月、`2026-09-30T15:00:00Z` は 10 月に数えられる。
- **依存**: T-3DP-02-01
- **参照**: F-3DP-02/30 / docs/12 §17.10.4, §17.14 d-2 ③

### T-3DP-02-07 設定グループの core・loader・Action

- **目的**: 設定の検証・保存・「提案値の確認状態」を**純関数 + Action** にし、UI (T-3DP-02-08) を薄くする。
- **対象ファイル**: `apps/3dp/lib/settings-groups-core.ts` (新規) / `apps/3dp/lib/tdp-settings.ts` (新規。`loadTdpSettings`) / `apps/3dp/app/actions/settings.ts` / テスト
- **やること**:
  - group = `safety` / `plan_price` / `generation` / `gates` / `media` ごとの zod (範囲は §7.3 / §15.7)。未知のキーは拒否。`kind_weights` は合計 100。`tuning` の保存は `TdpTuningSchema` で検証 (範囲外は**丸めず拒否**し `{field, refused, current}` を返す)。
  - `proposalState(group, key, settings)` → `'proposed' | 'confirmed' | 'changed'` (`tdp_settings_confirmed_json.values[key]` と現在値の比較。確認後に値を変えたら `changed`)。
  - Action: `updateTdpSettings({group, patch})` / `confirmSettingsGroup({group})` / `updateMonthlyPublishLimit({booth?, jinxxy?})` (各枠 ≤ 12 **かつ合計 ≤ 12**。媒体を増やして総量を増やす抜け道を作らない)。全 Action は `auth()` → zod → ドメイン関数 → `revalidatePath` (C-8)。
  - `loadTdpSettings(prisma)`: 型付きの設定オブジェクトを返す。**フラグの取得失敗は既定の側** (`flag_default`)、`tuning` は `parseTuning`。判定ロジックが数値リテラルを持たず、これを引数で受ける形にする (C-5)。
- **受入基準**:
  1. 範囲外の値・未知キー・合計 ≠ 100 の構成比が `ok:false` で、**拒否した値と現在値**が返る。
  2. `confirmSettingsGroup` 後に値を変えた項目だけ `changed`、他は `confirmed`。確認前は全て `proposed`。
  3. `updateMonthlyPublishLimit({booth:8, jinxxy:5})` は合計 13 で拒否 (DB 更新関数が呼ばれない)。`{booth:12, jinxxy:0}` は成功。
  4. 未認証は `code:'auth'`。DB 読込失敗時の `loadTdpSettings` はフラグを既定側に倒し、例外を握りつぶさず警告を返す。
  5. `pnpm --filter @3dp/web test:unit` / `typecheck` 緑。
- **依存**: T-3DP-02-01, T-3DP-02-03, T-3DP-02-02
- **参照**: F-3DP-38/41 / docs/12 §17.4 (`updateTdpSettings` 他), §7.3, §9.8 S-3DP-06

### T-3DP-02-08 設定画面のタブ化と提案値バッジ

- **目的**: S-3DP-06 を 1 本の縦長ページから**タブ + 提案値の明示**に (§9.10.3-2/3/4)。
- **対象ファイル**: `apps/3dp/app/(app)/settings/page.tsx` / 新規 `apps/3dp/app/(app)/settings/_tabs/*.tsx` (タブごと) / `apps/3dp/components/proposed-value-badge.tsx` / `apps/3dp/lib/messages.ts`
- **やること**: タブ (ピル型、UR-10): **安全装置 (既定。`/settings` はここを開く)** / 企画と価格 / 生成 / 判定値。`?tab=` で指定。
  > **4 タブである理由** (2026-10-16 追記): §9.8 S-3DP-06 のタブは **6 つ**だが、**媒体 = Inc-4 / 運用 = Inc-5** なので Inc-1 で作るのは 4 つ。`settings-groups-core.ts` の group は 5 つ (`safety` / `plan_price` / `generation` / `gates` / `media`) で、**`media` にタブが無いのは正常**。「運用」タブの `tdp_retire_mode` / `tdp_degrade_mode` は専用 Action が担当するので group を持たない。詳細は §7.3a。
  - 安全装置: R-1 (媒体別 BOOTH・Jinxxy + 合計。バー無し。「最大 12 (変更不可)」常時) / 禁止語 (現行維持) / 常時有効な判定の説明 (現行 6 種) / **共用アカウント注記を常時** (U-9/U-10 の欄は T-3DP-02-09)。
  - 企画と価格: 種別構成比 / 価格下限 / `ready` 在庫上限の倍率 / 手取りの早見表は SP-3DP-05 (値の保存と確認のみ)。生成: 再生成上限 (アセット・企画) / 歩留まり警告 / credit 警告 (Meshy 系は SP-3DP-05)。判定値: G-B/G-C/G-E の値 / 拒否率警告 / 滞留・不発の時間。
  - ページ先頭の注意書き (UR-7):「ここにある判定値・上限値・警告ラインは提案値であり、運営者は承認していません」。グループごとの「確認した」ボタンと `ProposedValueBadge` (`提案値 (未承認)` / `確認済` / `変更済 (未確認)`)。
  - 余白トークンは **tight / snug / relaxed / loose のみ** (`space-normal` は未定義で何も効かない)。文言は全て `messages.ts` へ。
- **受入基準**:
  1. 単体: `resolveTab('bogus')` と `resolveTab(undefined)` が `safety`。`ProposedValueBadge` が `proposalState` の 3 値を 3 つの**別の文言**に写す (色だけで区別しない: UR-6)。
  2. `grep -rn "space-normal" apps/3dp` が 0 件。`pnpm --filter @3dp/web typecheck` / `lint` / `test:unit` 緑。
  3. 既存の月間上限フォーム・禁止語フォームの動作が変わらない (既存テスト緑)。
  4. E2E (T-3DP-02-11) の「タブ遷移」「提案値バッジ」シナリオが通る。
- **依存**: T-3DP-02-07。OP-17 (PNG) があれば参照
- **参照**: F-3DP-11/38 / docs/12 §9.8 S-3DP-06, §9.10.3, §9.1 UR-6/7/10。`docs/wireframes/S-3DP-06-settings/prompt.md`

### T-3DP-02-09 U-9 / U-10 回答欄

- **目的**: 初回出品の**前に必須**の回答 (F-3DP-42) を記録できるようにする。回答が空だと SP-3DP-10 で出品が保留される。
- **対象ファイル**: `apps/3dp/app/actions/settings.ts` (`recordU9U10`) / `apps/3dp/app/(app)/settings/_tabs/safety-u9u10.tsx` / `apps/3dp/lib/settings-groups-core.ts` (検証)
- **やること**: U-9 =「同じ pixiv (BOOTH) アカウントを BOOTH 以外にも使っているか」(はい/いいえ + 用途メモ ≤ 500 字)、U-10 =「A2P の BOOTH 書籍売上が A2P 全体の何 % か」(0〜100)。`tdp_u9_json` / `tdp_u10_json` に `answered_at` つきで保存。欄の上に「**初回の出品の前に必須です**」。U-10 は数値を出すだけで、**「R-1 を下げることを検討してください」の文言のみ**を添える (上げる提案は出さない。閾値は設計にないので数値で分岐しない)。
- **受入基準**:
  1. 範囲外 (`booth_share_pct=101`、メモ 501 字) は拒否。保存で `answered_at` が入り、再回答は上書き。
  2. U-9/U-10 まわりの文言に「上げ」「増や」を含まない (テストで走査)。
  3. 未回答 / 回答済 の 2 状態が画面と `loadTdpSettings` の双方から読める (立ち上げチェック T-3DP-02-10 が使う)。
- **依存**: T-3DP-02-07
- **参照**: F-3DP-42 / docs/12 §9.8 S-3DP-06 安全装置 (U-9/U-10 回答欄), §14.6.2

### T-3DP-02-10 ホーム・商品一覧の Inc-1 差分

- **目的**: UR-1 (出品を促さない) と UR-8 (開発の都合を運営者向け文言に出さない) の違反を直し、Stage 0 のホームを「正常な空」に見せる。
- **対象ファイル**: `apps/3dp/app/(app)/page.tsx` / `apps/3dp/app/(app)/products/page.tsx` / `apps/3dp/lib/home-core.ts` / `apps/3dp/lib/messages.ts` / `apps/3dp/lib/__tests__/home-core.test.ts`
- **やること** (§9.10.1 / §9.10.2 の Inc-1 行):
  - ヒーローを「当月純利益」「1 商品あたりの売上」に差し替え。売上が無い間は **`—` + 理由**「売上の取得はまだ始まっていません」(UR-2。**「0 円」を出さない**)。出品枠は小さく「当月の出品 N 件 / 上限 M」(**バー無し、「残り N」を大きく出さない**、既存の `quotaNote`「上限は目標ではありません」は維持)。
  - 空状態文言を運営者向けの次の一手に (`messages.home.empty` / `messages.products.emptyHint` の「Inc-3 が入ると」等を削除)。**立ち上げチェック (Stage 0)**: §9.6.2 の項目 1 (提案値の確認) / 3 (試作) / 4 (U-9/U-10)。項目 2 (Meshy 接続テスト)・5 (BOOTH セッション) は該当機能の増分で足す。各項目は 済 / 未 / 確認できない の 3 値。
  - 状態別件数: `PRODUCT_STATUSES` を `@a2p/contracts/tdp/status` から取得 (`approved` / `withdrawn` を含む正準順)、各行を `/products?status=` へのリンクに。0 件の行は残す。
  - 商品一覧: 絞り込みピルに `approved` / `withdrawn`、「200 件まで表示」の注記 (常時)、空状態に次の一手 1 つ。
- **受入基準**:
  1. `home-core` のテスト: `buildStatusRows` が 11 状態を正準順で返し 0 件も残す。未知 status は末尾。
  2. `messages.ts` を走査するテスト: `/Inc-\d/` と `/Inc-/` を含む運営者向け文言が 0 件。
  3. Stage 判定の純関数 (商品 0 件 → `stage0`、1 件以上かつ `listed` 0 → `stage1`、`listed` あり → `stage2`) の単体テスト。
  4. ヒーローが売上なしのとき `—` と理由を返し、`0` を返さない。
- **依存**: T-3DP-02-01, T-3DP-02-06, T-3DP-02-09。OP-17 (PNG) があれば参照
- **参照**: F-3DP-12/35 / docs/12 §9.1 UR-1/2/8, §9.6, §9.10.1-2。`docs/wireframes/S-3DP-01-home/prompt.md`

### T-3DP-02-11 E2E 基盤 (`apps/3dp`)

- **目的**: 現在 `playwright.config.ts` は `apps/web` (3001) しか起動せず、3DP 用の E2E は存在しない (`tests/e2e/` に 3dp も anp も無い)。以降の承認・停止・設定のシナリオ (§17.13) の土台を作る。
- **対象ファイル**: `playwright.config.ts` / `tests/e2e/3dp/auth.setup.ts` / `tests/e2e/3dp/settings-ceiling.spec.ts` / `tests/e2e/3dp/home-empty.spec.ts` / `tests/e2e/tsconfig.json` (必要なら)
- **やること**: 環境変数 `E2E_TARGET=3dp` のとき `webServer` を `pnpm --filter @3dp/web dev` (ポート **3004**、`apps/3dp/package.json` の実設定) に切り替え、`baseURL` を 3004 に、プロジェクトを `3dp` にする (既定は従来どおり `apps/web`。**既存 E2E の挙動を変えない**)。認証は `packages/auth` の既存ログインを使い、テストユーザーは既存の E2E フィクスチャの作法に倣って DB に用意する。
- **シナリオ**:
  1. 設定の天井: R-1 に 13 → 「13 は保存されていません」と「最大 12」と「現在の値」が出て、DB の値が変わらない。12 は保存される。
  2. 空状態のホーム (商品 0 件): 「立ち上げチェック」が見え、`0 円` が無く、`—` と理由があり、`Inc-` の文字列が無い。
  3. `/settings` が「安全装置」を開き、`?tab=generation` でタブが切り替わる。提案値の注意書きが全タブにある。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` が緑。`pnpm typecheck:e2e` 緑。`E2E_TARGET` 未指定の `pnpm exec playwright test --list` の出力が変更前と同一 (既存 E2E の列挙が変わらない)。
- **現状 (2026-10-19 更新)**: T-3DP-02-04 は完了済みで、`packages/db/src/testing/pg.ts` (`withTestDb` / `applyMigrations` / `pgAvailability`)・`global-setup.ts`・CI の `test-integration` ジョブは存在する (旧記述の「未着手」は誤り)。本タスクで `playwright.config.ts` に `E2E_TARGET=3dp` を足した (apps/3dp 3004、projects `3dp-setup` / `3dp`、testDir は `tests/e2e/3dp` のみ、web サーバーの DATABASE_URL は `TDP_TEST_DATABASE_URL` から作り `.env.local` の本番 URL は使わない)。`E2E_TARGET` 未指定の既存 E2E は従来どおり (web 側の chromium に 3dp フォルダの除外 `testIgnore` を足しただけ)。
- **実行手順**: `E2E_TARGET=3dp TDP_TEST_DATABASE_URL=<使い捨て PG の URL> pnpm exec playwright test --project=3dp`。PG は testcontainers の URL でよい (localhost:5432 と本番は拒否される)。setup がスキーマ `e2e_3dp` を作り直す。既知の制約は `docs/12` §17.13 を参照。
- **持ち越し検証項目 (T-3DP-02-02 由来)**: `apps/3dp` にはコンポーネントテスト基盤 (testing-library) が無く、次の 2 点は現状どのテストでも覆われていない。E2E でしか取れない保証であり、`limit-form.tsx` に数値化 (`Number('')` 等) が戻っても検知できなくなるため、シナリオ 1 に必ず含める。
  1. 入力欄を**空にして保存**したとき、`0` などの数値化された値がサーバーに送られず、DB の値が変わらないこと (空を 0 として受けない)。
  2. 拒否時の文面 (「13 は保存されていません」「最大 12」「現在の値」) が画面に出ること。掴む先は `data-testid="tdp-limit-error"`。成功時は `tdp-limit-success`。値の確認は `tdp-limit-input` / `tdp-limit-jinxxy-input` (T-3DP-02-08 で 2 欄化) / `tdp-limit-save` / `tdp-limit-ceiling` / `tdp-limit-remaining`。
- **実施結果 (2026-10-19)**: 初回は 12 件中 11 件成功、「設定の天井 › 13 は拒否され…」だけが「最大 12」の欠落で失敗した (`formatRefusals` の文面しか出ていなかった)。programmer が媒体別枠の拒否に `limitCeilingHint` (「設定できるのは 0〜12 の整数で、最大 12 はコード側の固定値のため…」) を続ける修正を入れた後、**12 件すべて成功** (2 回目も同じ結果を確認、テスト用 PG は新規)。
  - 画面の拒否文 (実測): 「1 件の項目を拒否しました。何も保存していません」/「BOOTH の月間出品上限: 13 は保存されていません。範囲外のためサーバー側で拒否しました。現在の値: 8 設定できるのは 0〜12 の整数で、最大 12 はコード側の固定値のため、この画面からは変えられません。」。**「現在の値: 8」と次の文の間に句点が無く、一続きに読める** (読みやすさの課題。文面の修正は programmer 担当)。
- **既知の問題 (本タスクで回避)**: (1) `migrations` の再生だけでは `schema.prisma` と一致しない。`app_settings` に 24 列 (`kdp_session_alert_at` / `x_engage_enabled` … `autopass_kdp_enabled`) が無く、Prisma の `findUnique` が全列を読むため設定が degraded になる (本番には db push 等で存在する前提)。E2E の fixture で補う (`tests/e2e/fixtures/tdp-db.ts`)。根本対応は migration 化の別タスク。(2) `pnpm typecheck:e2e` は本タスク外の既存 spec の 40 件で赤のまま (sp08 / sp09 / uc06 / sales-auto-fetch 等)。本タスクの新規ファイルはエラーゼロ。
  - 成功: 空欄で保存しても DB 不変 (持ち越し 1) / 12 は保存される / 天井の注記 / タブ遷移 (4 タブ・`?tab=` 直指定・未知の値と media の安全装置への倒れ) / 全タブの提案値注意書き / 提案値バッジ「提案値 (未承認)」。ホームの空状態 (立ち上げチェック・`—` と理由・`0 円` と `Inc-` が本文に無い) も通る。
- **既知の問題 (本タスクで回避)**: (1) `migrations` の再生だけでは `schema.prisma` と一致しない。`app_settings` に 24 列 (`kdp_session_alert_at` / `x_engage_enabled` … `autopass_kdp_enabled`) が無く、Prisma の `findUnique` が全列を読むため設定が degraded になる (本番には db push 等で存在する前提)。E2E の fixture で補う (`tests/e2e/fixtures/tdp-db.ts`)。根本対応は migration 化の別タスク。(2) `pnpm typecheck:e2e` は本タスク外の既存 spec の 40 件で赤のまま (sp08 / sp09 / uc06 / sales-auto-fetch 等)。本タスクの新規ファイルはエラーゼロ。
- **依存**: T-3DP-02-08, T-3DP-02-10
- **参照**: docs/12 §17.13 (Playwright シナリオ「設定の天井」「空状態」), §9.6

### T-3DP-02-12 設計書の追従

- **目的**: 前段の設計書内の食い違いと、増分の再編 (申し送り 1・5) を**同じ変更で文書に反映**する (Rule #7/#8)。
- **対象ファイル**: `docs/12-3dp-design.md` / `docs/10-platform-portal.md` / `docs/03-tech-selection.md` (必要なら)
- **やること**:
  1. §10 の増分表: `tdp.prompter` (F-3DP-21) を Inc-2 へ、S-3DP-03 の「生成アセットと版履歴」節に `ModelViewer` を Inc-2 で (TBD-2/4 の確定)。§9.8 S-3DP-03 の節 3 に ModelViewer を明記。§15.1 の F-3DP-21 の増分を Inc-2 に。
  2. §16.5.2 の cron 表の `tdp.product.plan` を `0 21` → `30 21` (JST 06:30) に (§17.5.1 と一致させる)。
  3. §12 の末尾近くの「ポータルタイル 未着手」行を削除 (同表に「完了・コミット済 (fec85db)」の行があり矛盾している)。
  4. §17.15 の Inc-1 行の「CHECK (a)(d)(f)」を「(d)(f)」に、`approved_at` を Inc-1 の列に移す (T-3DP-02-03 の判断)。
  5. §17.9.4 の CORS オリジンの開発ポート `3010` を、`apps/3dp` の実設定 **3004** に訂正 (「3010 は仮置き」と書かれている)。
  6. `docs/10` のタイル節の `NEXT_PUBLIC_3DP_URL` を実装の **`NEXT_PUBLIC_TOOL_3DP_URL`** に訂正 (F-3DP-10 は訂正済み。docs/10 だけ古い)。
  7. docs/12 の冒頭に §1〜§17 の目次 (TBD-1 の判断: 分割しない代わりに探せるようにする。理由は dev-plan §11.11)。
- **受入基準**: 機械確認 (grep): ① `NEXT_PUBLIC_3DP_URL` が docs/10 に残っていない ② §16.5.2 の product.plan 行に `30 21` ③ §12 に `ポータルタイル | **未着手**` が無い ④ §10 の表で Inc-2 の行に `tdp.prompter` ⑤ `3010` が §17.9.4 に残っていない ⑥ 冒頭に目次。コードは触らない。
- **依存**: なし (他タスクの結果を待たない)
- **参照**: docs/12 §17.17-1/5, §17.16 TBD-1/2/4

---

## 6. テスト計画

- **Vitest (純ロジック)**: `settings.ts` / `status.ts` / `hold.ts` / `settings-core` / `settings-groups-core` / `home-core` / `tdp-migration` (静的)。
- **Vitest (実 PG, `test:integration`)**: `tdp-constraints` — CHECK (d)(f) と FK。
- **Playwright**: `tests/e2e/3dp/` に 2 本 (設定の天井 / 空状態) + タブ遷移。
- **手動確認 (自動化しない)**: 本番 DB への migration 適用前後で `app_settings` が読めること (OP-18)。

## 7. 完了判定

- T-3DP-02-01〜12 が `/iterate` で APPROVED + PASS。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` (PG あり、CI で `TDP_REQUIRE_PG=1`) / `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑。(E2E コマンドは T-3DP-02-11 完了までは存在しない。持ち越し項目は T-3DP-02-11 参照。)
- F-3DP-38 の受入「判定ロジック内に数値リテラルが残っていない」(`grep` で `apps/3dp/lib` と `packages/contracts/src/tdp` の判定コードを確認)。
- 申し送り: `docs/12` §12 に Inc-1 の完了を記録。`TDP_SETTINGS_DEFAULTS` を SP-3DP-03 (Meshy 系 4 列) が拡張する。実 PG 基盤の使い方 (`withTestDb`) は SP-3DP-03 以降の前提。
- migration は**本番未適用でもコード完了とする**が、OP-18 の適用が済むまで dev-plan の Inc-1 は「コード完了・本番未適用」と書く (適用済みと書かない)。
