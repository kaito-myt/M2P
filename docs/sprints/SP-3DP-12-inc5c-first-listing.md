# SP-3DP-12 inc5c-first-listing — BOOTH への初回出品と Jinxxy 手動 1 件 (Inc-5 完了)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-11 の §7「初回出品の前提チェック」が全て満たされていること。** 満たされていない状態で本スプリントの T-3DP-12-05 を実行しない。

## 1. 目的

**1 商品を実際に BOOTH に出品し、公開を記録し、監視が回り、売上を入力できる**(§10 の Inc-5 完了条件)。併せて Jinxxy に**手動で 1 件**出品し、書き込み API の有無 (U-5) と日本への着金 (U-6) を実測の入口に載せる。
**この完了はゴールではない。** 初回出品の日から P-1 (90 日) / P-2 (180 日) のカウントが始まる(§10 の追記、§14.5.4)。以後は G-B (市場)・G-C (採算) を**実績で**判定し、推測の月商で続行も撤退も決めない(U-7)。

## 2. 対応機能 ID

F-3DP-29 (BOOTH 半自動出品: カテゴリ 4 種・下書き作成), F-3DP-30 (R-1 の強制: 実運用), F-3DP-33 (Jinxxy 併売: 手動 1 件 → API 確認), F-3DP-42 (U-9/U-10 の事前条件: 実運用), F-3DP-43 (稼働の公開区間の実測), F-3DP-31/32 (売上入力の実運用)
解く未確認事項: **U-1' (カテゴリ選択のセレクタ), U-5, U-6 (初回売上後), U-3 (閾値は非開示のまま少なく出す)**

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-21-a** | **U-1'**: `scripts/booth/booth-cat-recon.mjs` を 4 カテゴリ分実行し、出品フォームのカテゴリ選択の**操作手順・セレクタ**を採取 | T-3DP-12-02 | T-3DP-12-03 のカテゴリ選択が実装できない(他の 6 項目は A2P の `booth-submit.mjs` と同じ) |
| **OP-21-b** | **初回出品の商品を 1 つ選ぶ**(承認済みのもの。構成比どおりアクセサリを推奨)。ZIP を取得し、BOOTH で**作品ファイルを UP して公開**し、商品 URL を記録する(運営者の操作は 2 つ + 記録) | T-3DP-12-05 | 初回出品が始まらない |
| **OP-22** | **Jinxxy**: アカウント作成・Creator API キーの発行・手動で 1 件出品(説明文と**メタデータの両方**に AI 開示)。**日本在住者の着金(PayPal または Stripe)は初回の売上が立つまで確認できない**(U-6) | T-3DP-12-07。P1 なので初回 BOOTH 出品の後でよい | Jinxxy は出品しない(`tdp_jinxxy_monthly_limit=0` のまま) |
| (継続) | OP-09 / OP-11 / OP-14 / OP-10 / OP-12 / OP-19 の記録(SP-3DP-11 §7 の前提) | T-3DP-12-04 の preflight が機械的に確認 | preflight が NG を返し T-3DP-12-05 に進めない |
| (継続) | 運営者は**出品作業の所要を自己申告**(目安 15 分)。G-E の公開区間 (ZIP 取得 → 公開記録) はツールが測る | T-3DP-12-05 | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-12-01 | ⬜ | BOOTH カテゴリ対応表 (定数) | 種別 → カテゴリ 4 種 | F-3DP-29 | S |
| T-3DP-12-02 | ⛔ | U-1' セレクタの採取と記録 | `booth-cat-recon.mjs` の結果を固定 | F-3DP-29 | S |
| T-3DP-12-03 | ⬜ | BOOTH 下書き作成スクリプト | 7 項目の自動入力・共用セッションは読むだけ | F-3DP-29 | L |
| T-3DP-12-04 | ⬜ | 初回出品の preflight (前提の機械チェック) | 5 前提 + 商品の出品条件 | F-3DP-30, 40, 42 | M |
| T-3DP-12-05 | ⛔ | **初回 BOOTH 出品** | 1 商品の出品・公開記録・監視の確認 | F-3DP-29〜32, 39, 43 | M |
| T-3DP-12-06 | ⬜ | Jinxxy の記録と API 確認の下準備 | 媒体別 URL 検証・`jinxxy-probe` | F-3DP-33 | M |
| T-3DP-12-07 | ⛔ | Jinxxy に手動で 1 件出品 | U-5 の実測・記録 | F-3DP-33 | S |
| T-3DP-12-08 | ⬜ | Inc-5 完了の記録と 90 日観測の運用 | docs/12・dev-plan | (Rule #7/#8) | S |

合計 **8 タスク**。

---

## 5. タスク詳細

### T-3DP-12-01 BOOTH カテゴリ対応表 (定数)

- **対象ファイル**: `packages/contracts/src/tdp/booth-category.ts` / `packages/contracts/package.json` / テスト
- **やること**: 種別 → BOOTH カテゴリ名の対応表(§5.1・§13.2): `accessory` → **3D装飾品** / `texture` → **3Dテクスチャ** / `prop` → **3D小道具** / `furniture` → **3D環境・ワールド**。**セレクタ階層は T-3DP-12-02 の採取結果で別途持つ**(カテゴリ名とフォーム上の操作手順は別問題)。
- **受入基準**: 4 種別すべてに対応があり、`TdpKind` の全値を網羅する(新種別が増えて未対応ならコンパイルエラー / 網羅テストが赤)/ カテゴリ名の表記が §13.2 と一致 / 単体テストで対応表を固定。
- **依存**: なし
- **参照**: F-3DP-29 ③ / docs/12 §5.1, §13.2, §15.2 F-3DP-29

### T-3DP-12-02 U-1' セレクタの採取と記録  ⛔ OP-21-a 待ち

- **対象ファイル**: `packages/contracts/src/tdp/booth-category.ts` (セレクタ手順の定数を追記) / `docs/12-3dp-design.md` (§11 U-1')
- **やること**: 運営者が `booth-cat-recon.mjs` を実行(ローカル PC・`DBURL` / `KDP_CRED_KEY`・**共用セッションを読むだけ**。A2P の既存の作法)。得られた階層の開き方・各カテゴリのセレクタ(または選択手順)を定数として固定し、取得日と BOOTH のフォームの版(画面の特徴)を記録。
- **受入基準**: 4 カテゴリそれぞれの手順が定数にあり、取得日つき / U-1' の行に結論 / スクリプトがセッションを**書き換えていない**ことを確認(`booth_session_state_enc` の更新時刻が変わっていない)。
- **依存**: T-3DP-12-01, OP-21-a
- **参照**: docs/12 §11 U-1', §5.1

### T-3DP-12-03 BOOTH 下書き作成スクリプト

- **目的**: 運営者の操作を**「ファイル UP + 公開で保存」の 2 つ**に留める(F-3DP-29)。BOOTH には出品 API が無く、reCAPTCHA enterprise とファイル追加モーダル(file input 無し)があるため完全自動は不可。
- **対象ファイル**: `scripts/booth/booth-3dp-submit.mjs` (A2P の `booth-submit.mjs` と同じ作法。`tsx` 経由で TS を import する) / `packages/contracts/src/tdp/booth-draft.ts` (純関数 `buildDraftPlan`) / `packages/contracts/package.json` / テスト
- **やること**:
  - `buildDraftPlan({product, manuscript, listing, settings})` → `{category(T-3DP-12-01), title(60 字以内に切る。切った事実を返す), description(最新の合格原稿の `description` = 散文 + 決定論ブロック), tags, price, errors[]}`。**前提の検査はスクリプトに複製しない**: `tdp_listings` に `state='working'` かつ `slot_reserved_at` ありの行が**無ければ**「先に商品詳細で ZIP を取得(= 出品作業を開始)してください」と出して終了する。保留理由の判定は Web 側 `startPublishWork` の 1 箇所に置く(二重実装は食い違う)。
  - スクリプト: `pnpm tsx scripts/booth/booth-3dp-submit.mjs <productId> [--dry-run]`。運営者の PC・`DBURL` / `KDP_CRED_KEY` で共用セッションを復号し、**メモリ上でのみ** `newContext({ storageState })` に渡す。**`storageState()` の保存・ログインページの操作・`booth_session_state_enc` の UPDATE を一切含めない**。セッションが無効なら再ログインせず「A2P 側の既存手順でログインしてください」と出して終了。7 項目(カテゴリ・タイトル・説明・タグ・価格・年齢制限ほか A2P と同じ項目)を入力して**「下書きで保存」まで**。商品画像は DataTransfer ドロップが登録されないため自動化しない(既知の制約)。
  - 成功時: `tdp_listings.draft_url` / `draft_created_at` を更新し、`jobs` 行 (`kind='tdp.listing.submit'`, `tdp_product_id`) を書く(F-3DP-29 ⑤)。
- **受入基準**:
  1. `buildDraftPlan` の単体: 61 字のタイトルが 60 字に切られ `title_truncated=true` / 4 種別が正しいカテゴリへ / `working` でない listing → `errors` に「出品作業を開始してください」/ 合格原稿が無い → `errors` / 説明に決定論ブロック(AI 開示・ライセンス)が含まれる。
  2. `--dry-run` は BOOTH にも DB 更新にも触れず、計画を表示するだけ(ネットワーク 0 回)。
  3. **静的テスト**: スクリプトに `booth_session_state_enc` への UPDATE / `storageState({ path` / `.storageState()` の呼び出し / ログインページの URL への `goto` が**含まれない**。
  4. 実 BOOTH での動作確認は T-3DP-12-05 で行う(CI では実行しない)。
- **依存**: T-3DP-12-02, SP-3DP-10 T-3DP-10-06, SP-3DP-08 T-3DP-08-05
- **参照**: F-3DP-29 / docs/12 §5.1, §17.5.7, §15.4.5 (セッションは読み取りのみ), §14.6.2

### T-3DP-12-04 初回出品の preflight (前提の機械チェック)

- **目的**: SP-3DP-11 §7 の「初回出品の前提」を**人の記憶でなく機械で**確認する。1 つでも NG なら実出品に進まない。
- **対象ファイル**: `scripts/3dp/preflight.ts` / `packages/contracts/src/tdp/preflight.ts` (純関数 `evaluatePreflight`) / テスト
- **やること**: DB を**読むだけ**で次を確認し、OK / NG の一覧と終了コードを返す: ① `tdp.listing.status.check` が過去 48 時間以内に実行成功している ② kill switch の `kill_engage` と `kill_release` のイベントが各 1 件以上(手順を一度通した証拠) ③ `tdp_gate_snapshots` の最新が 36 時間以内で `ok=true` ④ `tdp_u9_json` / `tdp_u10_json` が回答済み・標準文面が `approved` ⑤ 必要なテーブル・制約が存在 ⑥ 指定した商品が `approved`・`package_state='ready'`・`deriveHoldReasons` が空・`tdp_monthly_publish_limit ≤ 12`。⑦ 運営者の記録(OP-12 / OP-19 / OP-14)は dev-plan の記録欄ではなく**設定の `tdp_settings_confirmed_json` の確認済みグループ**で代替できないものは「手動確認」と表示(機械で確認できない項目を OK にしない)。
- **受入基準**: `evaluatePreflight` の単体 — 各前提を 1 つずつ崩すと該当項目だけが NG / 全部満たすと OK / 機械で確認できない項目が「手動確認」として別枠で出て、**OK に数えられない** / DB を書き換えない(読み取りのみ。テストで確認)。
- **依存**: SP-3DP-11 完了、T-3DP-12-03
- **参照**: docs/12 §14.8 申し送り 4, F-3DP-42, SP-3DP-11 §7

### T-3DP-12-05 初回 BOOTH 出品  ⛔ OP-21-b 待ち

- **着手条件**: `pnpm tsx scripts/3dp/preflight.ts --product <id>` が NG 0(手動確認の項目は運営者が記録)。
- **やること** (運営者 + 記録を取る programmer):
  1. 商品詳細で「配布 ZIP をダウンロード」(= 出品作業の開始・枠の予約・`zip_first_downloaded_at`)。
  2. `booth-3dp-submit.mjs` で下書きを作る → BOOTH で作品ファイルを UP して**公開**。
  3. 商品詳細の「公開を記録する」に商品 URL を入力 → `listed`。
  4. 翌日の `tdp.listing.status.check` が観測を残す(`confirmed_public`)ことを確認。
  5. 初回売上が立ったら `upsertManualSales` で手入力。
- **受入基準 (全て機械的に確認できる)**:
  1. `tdp_listings` に `medium='booth'`・`state='published'`・`item_url`・`published_recorded_at`・`slot_reserved_at`・`draft_url` が全て非 null。`tdp_products.status='listed'`。
  2. `zip_first_downloaded_at` と `published_recorded_at` の差(公開区間)と、`review_opened_at` と `approved_at` の差(承認区間)が記録され、ホームの稼働に出る。**合計が目安 15 分に収まったか**を完了報告に書く(超過の原因も)。
  3. 公開記録の翌日までに `tdp_public_observations` に当該 listing の行が 1 件以上できている(`confirmed_public` が望ましい。`unreachable` 続きなら原因を記録)。
  4. ホームの判定パネルの G-B / G-C が「**初回出品から始まる**」旨の起点つきで `未評価` → 評価対象に変わり、**P-1 (+90 日) と P-2 (+180 日) の日付**が表示される。
  5. **A2P 側の BOOTH セッションが無効になっていない**(本スクリプトが共用セッションを壊していない)ことを運営者が A2P の入稿動線で確認し記録。
  6. 当月の枠が「当月の出品 1 件」と表示され、`recorded_while_held=false`。
  7. 運営者の所要の自己申告と、ツールが測った区間の差を記録(G-E の妥当性)。
- **依存**: T-3DP-12-03/-04, OP-21-b, OP-18
- **参照**: F-3DP-29〜32/39/43 / docs/12 §10 (Inc-5 完了条件), §14.5.4, §17.8.2

### T-3DP-12-06 Jinxxy の記録と API 確認の下準備

- **対象ファイル**: `packages/contracts/src/tdp/media.ts` (媒体別の商品 URL 検証) / `apps/3dp/app/actions/publish.ts` (`recordPublished` が媒体別に検証) / `scripts/3dp/jinxxy-probe.ts` / テスト
- **やること**: `recordPublished` の URL 検証を**媒体定義から**読む(BOOTH は `BOOTH_ITEM_URL_RE`、Jinxxy は `https://` かつ jinxxy のホスト。**実際の URL 形式は T-3DP-12-07 の実物で確定**し、確定までは「ホスト + https」のみの緩い検証と明記)。`jinxxy-probe.ts`: `JINXXY_API_KEY` (env のみ・出力に含めない)で **`products_*` の書き込みスコープが実在するか**を公式の OpenAPI (`api.creators.jinxxy.com/v1/docs`) と `GET` で確かめ、結果を出力する(**書き込みは試さない**)。U-5 は「API があるはずだ」で決めず、キーを入れて叩くまで未確認として扱う。
- **受入基準**: Jinxxy の URL が通り、別ホストが `url_invalid` / BOOTH の URL 検証は不変 / `jinxxy-probe` が `fetch` 注入で書き込みメソッドを 1 度も呼ばない(テスト)/ キーが出力・ログに含まれない / Jinxxy の枠 (`tdp_jinxxy_monthly_limit`) が 0 の間は `startPublishWork('jinxxy')` が `hold_media_incomplete`。
- **依存**: SP-3DP-10 T-3DP-10-06
- **参照**: F-3DP-33/34 / docs/12 §5.2, §11 U-5/U-6, §13.5

### T-3DP-12-07 Jinxxy に手動で 1 件出品  ⛔ OP-22 待ち

- **やること**: 運営者がアカウントと Creator API キーを用意し、商品を**手動で 1 件**出品する(説明文と**メタデータの両方**に AI 開示: 規約 §6.7)。ツールの `recordPublished('jinxxy')` で記録(`counts_toward_gate=false` の既定のまま)。`jinxxy-probe.ts` で書き込みスコープの有無を確認。初回の売上が立ったら着金を確認して記録(U-6)。
- **受入基準**: U-5 の行に「スコープの有無 / 実施日」(あれば自動化は**別タスクとして起票**。無ければ BOOTH と同じ半自動 = 手動出品に倒す)/ Jinxxy の `tdp_listings` 行 / 開示が説明文・メタデータの両方にあることを運営者が確認 / **U-6 は初回売上まで「未確認」のまま**と明記し、算入切替 (`tdp_jinxxy_counts_toward_gate`) は着金記録後に限る。
- **依存**: T-3DP-12-06, T-3DP-12-05, OP-22
- **参照**: F-3DP-33/45 / docs/12 §5.2, §13.5, §11 U-5/U-6

### T-3DP-12-08 Inc-5 完了の記録と 90 日観測の運用

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md` (§11)
- **やること**: F-3DP-29〜35・39〜45・50 の状態を実装範囲だけ「実装済」に。§12 に Inc-5 の実装状況。U-1' / U-5 / U-6 の行を更新。dev-plan §11 に **観測カレンダー**を記録: 初回出品日 / P-1 (+90 日) / P-2 (+180 日) / R-1 見直し(カタログ 100 商品)/ 半年ごとの P-3。**「Inc-5 の完了 = ゴールではない」**と明記し、以後の運営者の月次作業(売上の手入力・入金の記録・判定パネルの確認・提案値の見直し)を 5 行以内で記す。U-7 は「実績で置き換える」まで月商の数字を根拠に意思決定しない旨。
- **受入基準**: grep で F-3DP-29 が「未」でない / dev-plan に初回出品日と P-1 / P-2 の日付 / U-7 の注意書き。コードは触らない。
- **依存**: T-3DP-12-05
- **参照**: docs/12 §14.5.4, §11 U-7, CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `booth-category` / `buildDraftPlan` / `evaluatePreflight` / media の URL 検証 / `jinxxy-probe` (fetch 注入)。静的テスト(下書きスクリプトがセッションを書き換えない)。
- **Vitest (実 PG)**: なし(新規テーブル無し)。
- **Playwright**: なし(出品の E2E は SP-3DP-10 で済み。実 BOOTH は自動化しない)。
- **手動 (自動化しない)**: 実 BOOTH での下書き作成・UP・公開、Jinxxy の手動出品。

## 7. 完了判定

- T-3DP-12-01・03・04・06・08 が APPROVED + PASS。T-3DP-12-02・05・07 は運営者待ち ⛔ だが、**T-3DP-12-05 の完了が Inc-5 の完了条件**(§10: 1 商品を実際に BOOTH に出品し、売上が取れる)。「売上が取れる」= 売上の手入力ができる状態(自動取得は実装しない: D-11)。
- Jinxxy は **P1**: T-3DP-12-07 が未了でも Inc-5 は完了とし、dev-plan に「Jinxxy 未了」と書く(F-3DP-33 は P1)。
- pm `MODE: REVIEW TARGET: Inc-5` / `TARGET: Phase 3DP-1` の対象は、T-3DP-12-05 の受入 1〜7 が満たされていること。
- **以後の判定点**: P-1 (初回出品 + 90 日)・P-2 (+180 日) は `tdp.gates.snapshot` が日次で算出する。判定は運営者が行い、AI 組織による自動停止・自動撤退は行わない(G-D の機械的停止を除く)。
