# SP-3DP-10 inc5a-package-and-publish-work — 配布 ZIP・出品の枠・出品作業と「公開を記録する」 (Inc-5 前半)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-09 完了 (承認が実商品で通る)。**
> **重要: 本スプリントのコードが完成しても、初回の実出品はまだしない。** 出品が始まった瞬間から P-1 のカウントと G-D の監視が始まる(§10 の追記)ので、**監視 (SP-3DP-11) が先に動いていること**が初回出品 (SP-3DP-12) の条件。

## 1. 目的

`approved` の商品から、運営者が BOOTH に手で UP できる**配布 ZIP** (FBX + GLB + テクスチャ PNG + README/規約/AI 開示) を作り、
**R-1 の枠を「出品作業の開始」で予約し「公開を記録」で確定する**仕組み (D-2) と、出品作業・取り下げの記録を作る。
BOOTH には出品 API が無く完全自動は不可(reCAPTCHA / ファイル追加モーダル)。**人間が 1 商品ずつ目で見る工程が残ること自体が R-1 / R-2 の安全弁**になる。

## 2. 対応機能 ID

F-3DP-29 (出品作業の前段: ZIP・枠・記録。下書き作成スクリプトは SP-3DP-12), F-3DP-30 (R-1 の強制), F-3DP-34 (媒体別の枠: 天井の合算), F-3DP-42 (保留理由 `hold_u9_u10`), F-3DP-43 (公開区間の測定), F-3DP-44 (取り下げの記録: 商品単位), F-3DP-15 (FBX の健全性検査)
解く未確認事項: **U-19** (FBX が Unity で開けるか)、U-24 の再確認

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-14** | **U-19**: 実際に作った FBX を **Unity で開き**、スケール単位 (cm/m)・軸・マテリアル / テクスチャ参照が正しいかを確認。併せて **ZIP の日本語ファイル名が Windows エクスプローラと macOS で文字化けしないか**を確認 | T-3DP-10-10 | 第 1 段の ZIP を確定できない。**初回出品 (SP-3DP-12) の前提** |
| OP-18 | 本番 DB の migration (T-3DP-10-01) 適用と worker の再デプロイ | T-3DP-10-10 の前 | 実機確認ができない |
| OP-06 (再) | U-22: Meshy の追加購入単価 (remesh は 5 credits) | 任意 | 原価は台帳の見積りで出る |
| (参考) | U-20 (`.unitypackage`) は **P1 で本計画に含めない**。売れ行き (G-B) が悪いときの最初の仮説として残る(§16.3.3) | G-B の判定時 | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-10-01 | ⬜ | DB migration (Inc-5): 出品・観測・売上・入金・規制・ゲート | 6 表 + 商品の package 列 + CHECK (e) | F-3DP-29〜45 | L |
| T-3DP-10-02 | ⬜ | Meshy `remesh` (FBX 変換) | クライアント・台帳 `stage='remesh'` | F-3DP-15 | M |
| T-3DP-10-03 | ⬜ | `tdp.package.build` (配布 ZIP) | 3 フォルダ構成・README・manifest | F-3DP-29 | M |
| T-3DP-10-04 | ⬜ | `tdp.package.verify` (FBX の健全性検査) | bbox・三角形数 ±1% | F-3DP-15 | M |
| T-3DP-10-05 | ⬜ | 保留理由 `deriveHoldReasons` と予約込みの枠 | 6 理由・優先順位・予約の失効 | F-3DP-30, 34, 42 | M |
| T-3DP-10-06 | ⬜ | 出品作業の Action 群 | 枠の予約・ZIP・公開記録・取り下げ記録 | F-3DP-29, 30, 43, 44 | L |
| T-3DP-10-07 | ⬜ | 商品詳細の「出品作業」「取り下げ」節 | 手順・保留理由・危険な操作 | F-3DP-29, 30, 42〜44 | L |
| T-3DP-10-08 | ⬜ | ホームの枠と要対応 (予約込み) | 「N 件 (うち作業中 K 件)」・保留の理由別件数 | F-3DP-30, 35 | M |
| T-3DP-10-09 | ⬜ | E2E: 出品作業と取り下げ | 保留・記録・URL 検証・ダイアログ | F-3DP-29, 30, 44 | M |
| T-3DP-10-10 | ⛔ | **U-19 の Unity 確認と ZIP の文字化け確認** | 実 FBX・実 ZIP | F-3DP-15 | S |
| T-3DP-10-11 | ⬜ | 設計書の追従と Inc-5 前半の記録 | docs/12・dev-plan | (Rule #7/#8) | S |

合計 **11 タスク**。

---

## 5. タスク詳細

### T-3DP-10-01 DB migration (Inc-5)

- **対象ファイル**: `packages/db/migrations/<ts>_tdp_inc5_listing/migration.sql` / `packages/db/schema.prisma` / `packages/db/__tests__/tdp-migration.test.ts` (拡張)
- **やること**: 新規 6 表 `tdp_listings` / `tdp_public_observations` / `tdp_sales` / `tdp_payouts` / `tdp_regulation_events` / `tdp_gate_snapshots` (§7.2。UNIQUE・index 名も)。`tdp_products` に `zip_first_downloaded_at` / `package_state` (既定 `'none'`) / `package_r2_key` / `package_json` / `package_built_at`。手書き CHECK **(e)** `tdp_listings_state_valid` と `tdp_listings_published_requires_url`。`app_settings` の Inc-1 で入れた列(kill switch ほか)は再追加しない。適用前の確認 SQL(`SELECT count(*) FROM tdp_products WHERE status='listed'` が 0 であること)を記録。
- **受入基準**: `prisma validate` / `generate`・typecheck 緑 / 静的テストに (e) の存在と `tdp_listings_item_url_key` を追加 / 実 PG: `state='published'` で `item_url` null が `23514`・`item_url` 重複が `23505`・`(product_id, medium)` 重複が `23505`・`(listing_id, year_month)` 重複が `23505` / 既存列の DROP・型変更なし / 本番未適用 (OP-18)。
- **依存**: SP-3DP-09 完了
- **参照**: docs/12 §7.2, §7.4 (e), §17.15 Inc-5

### T-3DP-10-02 Meshy `remesh` (FBX 変換)

- **対象ファイル**: `packages/mesh/src/meshy.ts` / `packages/mesh/__tests__/meshy.test.ts` / `apps/worker/src/tasks/tdp/meshy-submit.ts` (`stage='remesh'` 分岐) / `apps/worker/src/tasks/tdp/meshy-poll.ts` (remesh は FBX を保存) / 静的テストの許可リスト(変更なし: `createRemesh` も `meshy-submit.ts` のみ)
- **やること**: `createRemesh({ modelUrl, targetFormats: ['fbx'], convertFormatOnly: true })` / `getRemesh(id)` / `downloadModel(task, 'glb'|'fbx')` (§17.14 d-1。エンドポイント・パラメータは公式 docs で**実装時に再確認**し、食い違えば docs/12 §16.3.2 を直す)。台帳 `stage='remesh'` (親 = 最終 refine または最適化版の台帳行、credit 5)。入力 `model_url` = 配布版 GLB の署名付き URL。成果物は `tdp_assets` `stage='fbx'` (`format='fbx'`)。
- **受入基準**: fake fetch で ① remesh の POST がちょうど 1 回・親なしは DB の CHECK (c) で拒否 ② `convert_format_only: true` と `target_formats: ['fbx']` が body に載る ③ 4xx / 5xx / reject の扱いが `meshy-submit` の失敗系 10 ケースと同じ (`lost` は再投入しない) ④ FBX が R2 の `distribution.fbx` に保存され `tdp_assets` に 1 行(再実行で増えない) ⑤ `token_usage` が `provider='meshy'`・`credits=5` ⑥ SP-3DP-03 T-3DP-03-10 の静的テストが緑のまま。
- **依存**: SP-3DP-03 T-3DP-03-08/-09
- **参照**: F-3DP-15 / docs/12 §16.3.2, §17.14 d-1, §17.6, §17.5.4 (`tdp.package.build`)

### T-3DP-10-03 `tdp.package.build` (配布 ZIP)

- **対象ファイル**: `apps/worker/src/tasks/tdp/package-build.ts` / `apps/worker/src/tasks/tdp/lib/readme.ts` / `apps/worker/src/runner.ts` / テスト
- **やること**: 承認時に `enqueueIfRegistered` で自動投入される(SP-3DP-09)。`step:'start'`: `package_state='building'`。Meshy 由来の種別で FBX が無ければ `tdp.asset.generate` (`reason:'remesh'`)。テクスチャ種別は FBX 不要で `zip` へ。`step:'zip'`: **3 フォルダ構成** `01_導入` (README.txt・規約・AI 開示) / `02_モデルデータ` (FBX・GLB) / `03_テクスチャ` (GLB から取り出した PNG) を `jszip` (UTF-8 名) で組み、R2 `tdpPackage(...)` へ。`package_state='ready'`・`package_json = {files:[{path, sha256, bytes}], built_from_asset_version, fbx:{...}}`・`package_built_at`。失敗は `package_state='failed'` と理由 (保留理由 `hold_package_unavailable`)。README と開示は**決定論ブロック** (`buildLicenseBlock` / `buildAiDisclosureBlock`、使用 provider 名つき)。**テクスチャ形式は PNG / JPEG のみ**(WebP / KTX2 / Draco / meshopt を入れない)。
- **受入基準**: ① ZIP のエントリ名が 3 フォルダ構成と完全一致(テスト) ② manifest の sha256/bytes が実体と一致 ③ ZIP のエントリ日時を固定し、同じ入力で同じバイト列(再実行で別物にならない) ④ README にライセンスブロックと AI 開示(provider 名)が含まれ、標準文面が `proposed` のときは「案」であることが README に**書かれない**(出品は別途保留されるため。ただし `package_json` に `standard_text_status` を残す) ⑤ remesh 失敗で `package_state='failed'` かつ日本語の理由 ⑥ テクスチャ種別は FBX 無しで `ready` ⑦ 同じ版の再実行でキーが上書きされ孤児が増えない。
- **依存**: T-3DP-10-01/-02/-04, SP-3DP-09 T-3DP-09-02, SP-3DP-08 T-3DP-08-02
- **参照**: F-3DP-29 / docs/12 §17.5.4 (`tdp.package.build`), §16.3.3 (第 1 段), §17.9.1

### T-3DP-10-04 `tdp.package.verify` (FBX の健全性検査)

- **目的**: 単位違い (100 倍 / 0.01 倍) を**買い手に届く前に**機械で捕まえる。ただし最終判断は U-19 の Unity 実測であることを理由文に含める。
- **対象ファイル**: `apps/worker/src/tasks/tdp/package-verify.ts` / `apps/worker/src/tasks/tdp/render/page.ts` (`FBXLoader` で bbox と三角形数を返す関数を追加) / `apps/worker/src/runner.ts` / テスト
- **やること**: キュー `tdp-render`・`maxAttempts:2`・ハードタイムアウト 8 分。描画ページで `FBXLoader` により FBX を読み、**bbox と三角形数が元の GLB と ±1%** であることを検査。OK → `tdp.package.build` (`step:'zip'`)。NG → `package_state='failed'` (`fbx_scale_mismatch`)。
- **受入基準**: ブラウザポートを fake にして ① 一致 → `build` を投入 ② bbox が 100 倍 → `fbx_scale_mismatch`・`failed` ③ 三角形数が 2% ずれ → 同上、0.9% ずれ → OK ④ 理由文に「最終判断は Unity での確認 (U-19)」が含まれる ⑤ 実 FBX での検証は T-3DP-10-10 と同時に行う旨をコメントに。
- **依存**: T-3DP-10-02, SP-3DP-08 T-3DP-08-06/-07
- **参照**: F-3DP-15 / docs/12 §16.3.2 (健全性検査), §17.5.4 (`tdp.package.verify`)

### T-3DP-10-05 保留理由 `deriveHoldReasons` と予約込みの枠

- **対象ファイル**: `packages/contracts/src/tdp/hold.ts` (SP-3DP-02 のものを拡張) / `apps/worker/src/tasks/tdp/product-plan.ts` (残枠を予約込みに) / テスト
- **やること**: `deriveHoldReasons(input)` — **保存せず読むたびに算出**する純関数。コード: `hold_kill_switch` / `hold_retire_mode` / `hold_monthly_limit` (媒体別) / `hold_u9_u10` (booth で U-9・U-10 のどちらかが未回答) / `hold_media_incomplete` (5 項目欠け・Jinxxy 枠 0・`standard_text_unapproved`) / `hold_package_unavailable` (`package_state ≠ 'ready'`)。複数同時に返す。**`hold_kill_switch` が他のすべてに優先**(残枠があっても出さない: F-3DP-30 ②)。`computeSlots` の `activeReservations` = `state='working'` かつ `slot_reserved_at` が `slot_reserve_expire_days` 以内の件数。`tdp.product.plan` の「残枠」を予約込みに差し替える。
- **受入基準**: 6 理由それぞれと同時発生 / 停止中が先頭 / 予約が 14 日で数えられなくなる(境界 13 日 23 時間 → 数える、14 日 1 分 → 数えない) / 月境界 JST / 各枠 ≤ 12 かつ合計 ≤ 12 の天井 / 既存 `canListMore` のテスト緑 / 判定にリテラルが無い(許可リスト方式の静的テスト: `hold.ts` の数値リテラルは `0`/`1` 等の許可リストのみ)。
- **依存**: SP-3DP-02 T-3DP-02-06, SP-3DP-08 T-3DP-08-02, T-3DP-10-01
- **参照**: F-3DP-30/34/42 / docs/12 §17.10.2, §17.10.4, §15.2 F-3DP-30

### T-3DP-10-06 出品作業の Action 群

- **対象ファイル**: `apps/3dp/app/actions/publish.ts` / `apps/3dp/lib/publish-core.ts` / テスト (単体 + 実 PG)
- **やること** (§17.4):
  - `startPublishWork({product_id, medium})`: 1 トランザクションで `app_settings` の行を `SELECT ... FOR UPDATE` で握って当月の使用枠 (公開記録 + 有効な予約) を数え、`deriveHoldReasons` が空なら `tdp_listings(state='working', slot_reserved_at)` を作る(冪等)。保留なら `TdpHoldError` で理由の配列。**並走する 2 商品が最後の 1 枠を同時に取れない。**
  - `getDownloadUrl({product_id, medium})`: `startPublishWork` を内部実行 → `package_state='ready'` なら ZIP の署名付き URL (TTL 15 分、`Content-Disposition` に日本語名 `{商品名}_v{ver}.zip`)。**初回だけ** `zip_first_downloaded_at` を書く(G-E の公開区間の起点)。**副作用があるので GET にしない**(Server Action のみ)。未生成は `package_not_ready` + 理由。
  - `recordPublished({product_id, medium, item_url})`: `BOOTH_ITEM_URL_RE` で検証。重複は `url_duplicate`。T-15 `approved→listed`。**停止中・上限超過でも記録は受け付ける**(現実を記録する)が `recorded_while_held=true` と `hold_reasons_at_record` を残し、LINE で警告 (`isLineRelayConfigured` でなければ `jobs` に理由)。`published_recorded_at` / `expected_public=true` / 互換列 `listed_at` / `booth_item_url` を同一トランザクション。
  - `recordWithdrawal({product_id, medium, reason})`: listing を `withdrawn`・`expected_public=false`・`withdraw_reason`・`withdrawn_recorded_at`。商品は**全 listing が `withdrawn` になったとき** `listed→withdrawn` (T-16)。**BOOTH 上の商品は非公開にしない**(先に記録させるのは公開状態確認が自分の操作を異常と取り違えないため)。**1 商品・1 媒体ずつ。一括版を作らない。**
- **受入基準 (実 PG)**:
  1. 残枠 1 で 2 商品が `startPublishWork` を並走 → **成功は 1 件、もう 1 件は `hold_monthly_limit`**。
  2. 同じ商品の連打で予約が 1 件(枠を 2 消費しない)。保留中は予約が作られない。
  3. `getDownloadUrl` の 2 回目で `zip_first_downloaded_at` が変わらない。署名の TTL が 900 秒。ZIP 未生成は `package_not_ready`。
  4. `recordPublished`: `https://booth.pm/ja/items/6314083` と `https://<shop>.booth.pm/items/123` が通り、他ホスト・数字なし・`http://` が `url_invalid`。重複 URL は `url_duplicate`。停止中でも記録でき `recorded_while_held=true`。`approved` でない商品は `not_approved`。
  5. `recordWithdrawal`: 2 媒体のうち 1 つだけ取り下げでは商品は `listed` のまま。全て取り下げで `withdrawn`。`expected_public=false`。
  6. 全 Action が **配列の商品 ID を受け取らない**(一括操作が型として存在しない: シグネチャの走査テスト)。未認証は `auth`。
- **依存**: T-3DP-10-01/-03/-05, SP-3DP-02 T-3DP-02-07
- **参照**: F-3DP-29/30/43/44 / docs/12 §17.4, §17.10.4, §17.3 (T-15/T-16), §9.8 S-3DP-03 (出品作業・取り下げ)

### T-3DP-10-07 商品詳細の「出品作業」「取り下げ」節

- **対象ファイル**: `apps/3dp/app/(app)/products/[id]/_components/publish-work.tsx` / `withdraw-dialog.tsx` / `status-and-sales-section.tsx` / `apps/3dp/lib/publish-view-core.ts` / テスト
- **やること** (§9.8 S-3DP-03 節 7・8・9・11): **出品作業** — ① 保留中は先頭に**保留理由**(月上限 / 停止中 / U-9・U-10 未回答 / 撤退モード / 媒体定義不足(標準文面が案を含む) / ZIP 未生成)を出し、以降の手順を無効にする ② 手順 4 つ: BOOTH の下書きを開く(`draft_url` があれば。無ければ「下書きはまだ作られていません」) → **配布 ZIP をダウンロード**(`getDownloadUrl`。署名付き URL で 1 クリック) → BOOTH で作品ファイルを UP して公開 → **「公開を記録する」**(BOOTH の商品 URL 必須。確認ダイアログは出さない) ③ 共用アカウントの注記を**常時 1 行**「3DP の出品は A2P と同じ BOOTH アカウントを使います。処分されると A2P の BOOTH チャネルも同時に失います」④ 承認からの経過 (**「作業時間」と書かない**)。**公開状態**(8)は `expected_public` と観測履歴の表(観測が無いうちは「まだ確認されていません」)。**売上**(9)は `—` と理由。**危険な操作**(11。既定で畳む・最下部・出品済のみ): 「取り下げを記録する」ダイアログに ①「取り下げても損失は減りません。公開したまま放置しても費用は増えず、売上の可能性だけが消えます」②「この操作は BOOTH 上の商品を非公開にしません。先にここで記録してから、BOOTH の管理画面で非公開にしてください」③ 理由(必須)。撤退・停止の操作と**別の場所**に置く。
- **受入基準**: `publish-view-core` の単体 — 保留理由が全て文言化される / 保留中は手順 2〜4 が無効 / 取り下げダイアログに①②③が**全て**含まれる / 一括選択の部品が無い / 運営者向け文言に `Inc-` が無い / 「作業時間」という語が経過の表示に使われていない。
- **依存**: T-3DP-10-06。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-03-product-detail/prompt.md` の `desktop.png` `publish-held.png` `listed.png` `withdraw-dialog.png`)
- **参照**: F-3DP-29/30/42/43/44 / docs/12 §9.8 S-3DP-03 (出品作業の仕様・取り下げの仕様), §9.13-7

### T-3DP-10-08 ホームの枠と要対応 (予約込み)

- **対象ファイル**: `apps/3dp/app/(app)/page.tsx` / `apps/3dp/lib/home-core.ts` / `apps/3dp/lib/messages.ts` / テスト
- **やること**: 「今月の枠と稼働」の① を「**当月の出品 N 件 (うち作業中 K 件) / 上限 M**」(媒体別 + 合計。バー無し。「上限は目標ではありません」を維持)に (TBD-6)。要対応に **出品作業待ち N** (承認済・公開未記録)・**出品保留 N (理由別の件数)** を追加。
- **受入基準**: 予約を含む表示の単体テスト / 保留が理由別に数えられる / 進捗バー・「残り N」を大きく出す部品が無い / `computeSlots` の結果と表示が一致。
- **依存**: T-3DP-10-05/-06
- **参照**: F-3DP-30/35 / docs/12 §17.16 TBD-6, §9.8 S-3DP-01 (節 3・6)

### T-3DP-10-09 E2E: 出品作業と取り下げ

- **対象ファイル**: `tests/e2e/3dp/publish.spec.ts`
- **シナリオ** (§17.13): ① 保留中(U-9/U-10 未回答)は手順が無効で理由が出る ② 回答後に ZIP ダウンロード(署名 URL はスタブ)→「公開を記録する」で `listed`、URL 形式不正・重複を拒否 ③ 上限到達で保留の理由が「当月の上限」④ 取り下げのダイアログに 3 つの文言があり理由が空だと送れない・記録後に `withdrawn` ⑤ 一覧・詳細に一括選択が無い。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑。
- **依存**: T-3DP-10-07/-08
- **参照**: docs/12 §17.13 (Playwright 出品作業)

### T-3DP-10-10 U-19 の Unity 確認と ZIP の文字化け確認  ⛔ OP-14 待ち

- **対象ファイル**: `docs/12-3dp-design.md` (§11 U-19 / §12) / `docs/dev-plan.md` (§11)
- **やること**: 実キーで 1 商品を `approved` まで進め(または SP-3DP-05 の商品を承認し)、remesh → verify → ZIP を作る。運営者が ZIP を取得して ① Unity で FBX を開き**スケール単位 (cm/m)・軸・マテリアル / テクスチャ参照**を確認 ② Windows エクスプローラ / macOS で**日本語のファイル名**が文字化けしないか確認。結果を docs に記録。
- **受入基準**: U-19 の行が「Unity のバージョン / 単位 / 軸 / 参照の合否 / 実施日」で埋まる。合格 → ZIP 第 1 段を確定。**不合格 → 「Blender CLI に切り替える」を dev-plan に起票し、pm を計画モードで再起動**(新規タスク。本スプリントの範囲外)。文字化けの有無を記録。`package_json` の実物が manifest として妥当。
- **依存**: T-3DP-10-03/-04, OP-14, OP-18
- **参照**: docs/12 §11 U-19, §16.3.2, §17.13 (手動確認), §17.9.1

### T-3DP-10-11 設計書の追従と Inc-5 前半の記録

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md`
- **やること**: F-3DP-29 (ZIP・記録の範囲)・30・42 (`hold_u9_u10`)・43 (公開区間)・44 (取り下げ記録)・15 を実装範囲だけ更新。§12 に Inc-5 前半。TBD-6 の UI 文言を §9.8 に反映。「初回出品はまだしていない」を dev-plan に明記。
- **受入基準**: grep で F-3DP-30 が「未」でない / dev-plan に「初回出品は SP-3DP-11 完了後」。コードは触らない。
- **依存**: T-3DP-10-10
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `deriveHoldReasons` / `computeSlots` / `publish-core` / `publish-view-core` / README・manifest・ZIP 構造。
- **Vitest (実 PG)**: 出品作業の Action(最後の 1 枠の競合・冪等・記録の取りこぼし無し)、CHECK (e)、remesh の台帳。
- **Playwright**: 出品作業 1 本。
- **手動 (自動化しない)**: Unity で FBX が開く / ZIP の日本語名 (OP-14)。

## 7. 完了判定

- T-3DP-10-01〜11 が APPROVED + PASS (T-3DP-10-10 は OP-14 待ち ⛔)。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` / E2E 緑。
- ZIP が Unity で開けると確認できた(または不合格の次の手が起票された)。
- **まだ実出品しない。** 申し送り: SP-3DP-11 が公開状態確認・kill switch・ゲート・売上を作る。**SP-3DP-12 の初回出品の前提 = SP-3DP-11 完了 + OP-09 + OP-11 (U-9/U-10) + OP-14**。
