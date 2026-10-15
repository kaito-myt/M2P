# SP-3DP-08 inc4a-render-compose — プレビュー描画と商品ページ原稿 (Inc-4 前半)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: P-0 = A、SP-3DP-05 完了 (`ready` の商品が実キーで作れる)。** テクスチャ商材を扱う場合は SP-3DP-07 が先。

## 1. 目的

`ready` の商品から、承認に必要な**材料 2 つ**を自動で作る: **プレビュー 6 枚** (サーバーに GPU が無いので Playwright Chromium + three.js の SwiftShader 描画。白画像を成功にしない) と **商品ページ原稿** (散文は LLM、数値・仕様・ライセンス・AI 開示は**コードが差し込む**ので盛れない)。
両方がそろった側が商品を `review` に進める (T-10)。**承認画面そのものは SP-3DP-09。**

> **最大の未確認事項**: SwiftShader で当方の worker イメージ上に WebGL2 が動くか、所要・メモリ (U-15 / U-18) は**実機で測るまで分からない**。本スプリントの T-3DP-08-10 が実測。合格しなければ設計の逃げ道 (§16.2.4) に進む。

## 2. 対応機能 ID

F-3DP-25 (プレビュー), F-3DP-26 (原稿 + 禁止語・数値一致), F-3DP-27 (AI 開示の媒体別出力), F-3DP-50 (媒体定義: 型と文面の差し込み口), F-3DP-20 (手取り: 原稿の価格), F-3DP-46 (`jobs` 行)
解く未確認事項: **U-15, U-18** (実測)。TBD-3 (標準文面) は**案の作成まで**(承認は SP-3DP-09)

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-07** | U-18: Railway の worker サービスの割当 vCPU / RAM と、直近のメモリ使用ピーク (SP-3DP-05 で依頼済み) | T-3DP-08-10 の前 | 合格基準 (割当の 60% 以内) を判定できない。T-3DP-08-10 は ⛔ |
| **OP-09** | **標準文面の承認** (ライセンス・再配布条件 / AI 開示)。法務的な文面なので設計は差し込み口のみを持ち、**案は T-3DP-08-02 が `proposed` として作る**。承認は SP-3DP-09 の終わり | SP-3DP-09 T-3DP-09-08 まで | 承認前の商品は `hold_media_incomplete` に含まれ**出品が保留される** (承認画面で承認はできる) |
| OP-03 | 描画された 6 枚が**商品として見える**か、日本語ラベルが豆腐になっていないかの目視 | T-3DP-08-10 | 合格にならない |
| OP-17 | ワイヤーフレーム PNG は本スプリントでは不要 (画面なし) | — | — |
| OP-18 | 本番 DB の migration (T-3DP-08-01) と worker の再デプロイ (`three` の追加・Dockerfile の変更を含むイメージ) | T-3DP-08-10 の前 | 実機計測ができない |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-08-01 | ⬜ | DB migration (Inc-4 前半) | 原稿・差戻し履歴・プレビューの列・承認系の列 | F-3DP-25, 26, 43 | M |
| T-3DP-08-02 | ⬜ | 媒体定義の完成 (`media.ts`) と標準文面の案 | AI 開示・ライセンス・`missingMediaFields` | F-3DP-27, 50 | M |
| T-3DP-08-03 | ⬜ | 原稿の検査 `checkListing` と決定論ブロック | 禁止語・必須 6 項目・数値一致・開示箇所 | F-3DP-26, 27 | M |
| T-3DP-08-04 | ⬜ | `tdp.listing` (契約・実装・seed) | 散文のみを書く | F-3DP-26 | M |
| T-3DP-08-05 | ⬜ | `tdp.listing.compose` タスク | 媒体別・最大 3 回・版管理 | F-3DP-26, 27 | L |
| T-3DP-08-06 | ⬜ | 描画ページと自己検査 | three の束・固定カメラ・`selfcheck.ts` | F-3DP-25 | L |
| T-3DP-08-07 | ⬜ | `render.ts` (Playwright) | SwiftShader 起動・6 枚・fail-closed | F-3DP-25 | L |
| T-3DP-08-08 | ⬜ | `tdp.preview.render` と `rerenderPreview` | キュー `tdp-render`・中断の再開・保存 | F-3DP-25, 46 | M |
| T-3DP-08-09 | ⬜ | `advanceToReview` | `ready → review` の両側からの遷移 | F-3DP-25, 28 | M |
| T-3DP-08-10 | ⛔ | **U-15 / U-18 の実機計測** | 所要・メモリ・描画の正しさ・日本語ラベル | F-3DP-25 | M |
| T-3DP-08-11 | ⬜ | 設計書の追従 | docs/12・docs/03・dev-plan | (Rule #7/#8) | S |

合計 **11 タスク**。

---

## 5. タスク詳細

### T-3DP-08-01 DB migration (Inc-4 前半)

- **対象ファイル**: `packages/db/migrations/<ts>_tdp_inc4_review/migration.sql` / `packages/db/schema.prisma` / `packages/db/__tests__/tdp-migration.test.ts` (拡張)
- **やること**: `tdp_manuscripts` (UNIQUE `(product_id, medium, version)` と最新引き用 index)・`tdp_review_events`。`tdp_previews` に `name` / `asset_version` / `width` / `height` / `selfcheck_json` と UNIQUE `tdp_previews_slot_key (product_id, asset_version, name)` (NULL は一意制約の対象外なので既存行に影響しない)。`tdp_products` に `approved_by` / `approved_asset_version` / `review_round` / `review_opened_at` (`approved_at` は Inc-1 済み)。CHECK (d) は Inc-1 で入っているので**ここでは足さない**。
- **受入基準**: `prisma validate` / `generate`・typecheck 緑。静的テストに追加列・UNIQUE を追加。実 PG で `(product_id, medium, version)` と `tdp_previews_slot_key` の重複が `23505`。既存行を壊す DROP / 型変更が無い。本番未適用 (OP-18)。適用前に `SELECT count(*) FROM tdp_previews;` を記録。
- **依存**: SP-3DP-05 完了
- **参照**: docs/12 §7.2, §17.15 Inc-4

### T-3DP-08-02 媒体定義の完成 (`media.ts`) と標準文面の案

- **対象ファイル**: `packages/contracts/src/tdp/media.ts` (SP-3DP-06 のものを拡張) / テスト
- **やること**: `TDP_MEDIA.booth` と `.jinxxy` に `ai_disclosure: { required, targets: ('description'|'metadata')[] }` を持たせる (**BOOTH = 当方の方針 (required=false、targets=['description'])**、**Jinxxy = 規約義務 (required=true、targets=['description','metadata'])**。この区別を型とコメントに残す: R-3 は BOOTH の規約上の義務ではなく運営者の方針)。`buildAiDisclosureBlock(medium, providers)` (使用した provider 名 = Meshy / OpenAI 等を文に入れる) と `buildLicenseBlock(kind)`。**標準文面は `STANDARD_TEXTS = { status: 'proposed', license_ja, ai_disclosure_ja }` として「案・未承認」と明示**(運営者承認は OP-09 = SP-3DP-09)。`missingMediaFields(medium)`: 5 項目の欠け + 標準文面が `proposed` のとき `standard_text_unapproved` を返す。
- **受入基準**: ① 5 項目のどれかを欠いた媒体定義が型エラー ② `buildAiDisclosureBlock('booth', ['meshy'])` に provider 名が含まれる ③ `targets` に `metadata` を含む媒体で、メタデータ項目の定義が無ければ `missingMediaFields` に出る ④ 標準文面が `proposed` の間 `missingMediaFields` が `standard_text_unapproved` を含む ⑤ 文面に「規約上の義務」とは書かない (BOOTH の開示文)。判定にリテラルが無い。
- **依存**: SP-3DP-06 T-3DP-06-03
- **参照**: F-3DP-27/50 / docs/12 §2.1 R-3, §15.2 F-3DP-27, §17.7.4, §17.16 TBD-3

### T-3DP-08-03 原稿の検査 `checkListing` と決定論ブロック

- **対象ファイル**: `packages/contracts/src/tdp/listing-check.ts` / `packages/contracts/package.json` / テスト
- **やること**: `buildDeterministicBlocks({medium, metrics, providers, kind})` → `spec_block` (三角形・テクスチャ解像度と枚数・マテリアル数 = `inspect_json` の実測)・`env_block` (対応環境: 配布形式と動作確認の範囲)・`license_block`・`ai_disclosure_block`。`checkListing(manuscript, {metrics, medium, forbiddenExtra})` → `checks_json = {forbidden_hits[], items_present{6}, numbers_match, disclosure_targets_ok, passed}`: ① 禁止語 8 語 (`最高` `世界初` `完全` `必ず` `絶対` `激安` `No.1` `業界初`) + `tdp_tuning_json.listing_extra_forbidden`、**NFKC 正規化して比較** ② 必須 6 項目 (三角形 / テクスチャ / マテリアル / 対応環境 / ライセンス / AI 開示) の存在 ③ **散文中の数値表現** (`\d[\d,]*\s*(三角形|ポリゴン|枚|マテリアル|px)` 等) を `metrics` と照合し不一致なら不合格 ④ 開示文が媒体定義の `targets` の**全箇所**にある。
- **受入基準**: 純関数の単体テスト — 8 語それぞれが検出される / 全角「Ｎｏ．１」も検出 (NFKC) / 散文に「8,000 三角形」と書かれ実測 7,432 → `numbers_match=false` で不合格 / 散文に数値が無ければ合格 / `metadata` が `targets` にある媒体でメタデータ側に開示が無い → `disclosure_targets_ok=false` / 全て満たす原稿が `passed=true` / 決定論ブロックの数値が `inspect_json` と完全一致。判定にリテラルが無い (禁止語の既定 8 語は contracts の定数、追加は設定)。
- **依存**: T-3DP-08-02
- **参照**: F-3DP-26/27 / docs/12 §15.2 F-3DP-26 ①②, §17.7.4, §17.13 (`checkListing`)

### T-3DP-08-04 `tdp.listing` (契約・実装・seed)

- **対象ファイル**: `packages/contracts/src/agents/tdp.ts` (追記) / `packages/agents/src/tdp/listing.ts` / `packages/db/seed-tdp.ts` (追記) / テスト
- **やること**: §17.7.4 の `TdpListingInputSchema` / `TdpListingOutputSchema`。**LLM が書くのは散文 (`title` `lead` `appeal_points` `usage_notes` `tags`) だけ**。仕様・環境・ライセンス・AI 開示は書かせない (入力に `metrics` を渡すのは「散文に数値を書くなら、この値だけ」の参照用)。`forbidden_words` と `feedback` を user メッセージに実行時注入 (`prompts` 本文は不変)。モデル `claude-sonnet-5` (temperature 無し)。
- **受入基準**: fake LLM で zod 通過・不正 JSON の再呼び出し。`prompts` 本文のバイト一致。`token_usage` が `3dp` / `tdp.listing`。`title` 60 字・`tags` 3〜10 個の境界。seed の冪等・active 1 件。`check:llm-client` 緑。
- **依存**: SP-3DP-06 T-3DP-06-02 (`agents/tdp.ts`)
- **参照**: F-3DP-26 / docs/12 §17.7.4, §17.7.0

### T-3DP-08-05 `tdp.listing.compose` タスク

- **対象ファイル**: `apps/worker/src/tasks/tdp/listing-compose.ts` / `apps/worker/src/runner.ts` / テスト (単体 + 実 PG)
- **やること**: §17.5.4 の行どおり。`target_media` ごとに ① `tdp.listing` で散文 ② `buildDeterministicBlocks` で決定論ブロックを**コードが**差し込み ③ `checkListing` ④ 不合格は失敗項目を `feedback` に入れて**最大 3 回**再生成 ⑤ 3 回で通らなければ `passed=false` の版を残し、商品は `ready` のまま (`manuscript_failed` と失敗項目を `status_reason_json` に) ⑥ 各回を `tdp_manuscripts` に版として保存 (`for_asset_version` = 現在の配布版。`sections_json` / `checks_json` / `feedback_in`)。⑦ 終了時に `advanceToReview()` (T-3DP-08-09)。再実行で `for_asset_version` と媒体が同じ合格済み原稿があれば LLM を呼ばない。差戻し (`rewrite`) の `feedback` を受けられる payload にする。`enqueueIfRegistered` により `tdp.asset.optimize` から自動で投入されるようになることを確認。
- **受入基準**: ① 不合格が続くと LLM 呼び出しがちょうど 3 回で止まる ② 2 回目の入力に 1 回目の失敗項目 (禁止語・数値不一致) が入っている ③ **LLM の出力に開示文が含まれていても、媒体定義の `targets` への差し込みは常にコードが行い、検査は決定論ブロックで判定する** ④ 同じ入力の再実行で LLM 呼び出し 0 回・版が増えない ⑤ 版番号が単調増加で UNIQUE 違反なし ⑥ `token_usage` が試行回数ぶん ⑦ 標準文面が `proposed` でも原稿は作る (出品の保留は別: SP-3DP-10)。
- **依存**: T-3DP-08-01/-03/-04, SP-3DP-04 T-3DP-04-08
- **参照**: F-3DP-26/27 / docs/12 §17.5.4 (`tdp.listing.compose`), §17.3 (T-10, T-13)

### T-3DP-08-06 描画ページと自己検査

- **対象ファイル**: `apps/worker/src/tasks/tdp/render/page.html` / `render/page.ts` / `render/selfcheck.ts` / `render/constants.ts` / `apps/worker/package.json` (`three` を**最新安定で固定**。r163 以降は WebGL2 前提) / `pnpm-lock.yaml` / 束ねる手順 (esbuild 等。既存の worker のビルド手順に合わせ、新ツールを足すなら理由を完了報告に)
- **やること**: three + `GLTFLoader` + `RoomEnvironment` (PMREM 用のプロシージャル環境。HDRI ファイル不要) を束ね、**外部ネットワークを使わない** (`page.route` で配る前提)。カメラ・ライトは `constants.ts` の**固定値で乱数なし** (同じ GLB は同じ画像)。1,200×1,200・`antialias`・トーンマッピング固定・背景は単色。6 枚の定義: サムネ (斜め 35°、1:1) / 正面 / 側面 / 背面 / 斜め / **寸法参照** (側面 + 目盛り + 幅×高さ×奥行 cm のラベル。寸法は `@a2p/mesh` の `inspectDocument` の `metrics.sizeMeters` を引数で受け、**二重定義しない**)。`selfcheck.ts` (純関数): 背景色以外の画素割合 `min_non_bg_ratio` 未満 → `render_blank`、標準偏差 `min_stddev` 未満 → `render_white`、WebGL2 コンテキスト無し → `render_webgl_unavailable`。しきい値は `tdp_tuning_json.render_selfcheck` (暫定 0.02 / 6、U-15 の実測で決める)。
- **受入基準**: ① `selfcheck`: 単色白 → `render_white`、背景のみ → `render_blank`、模様あり → 通過 (合成 PNG) ② 束に外部 URL が無い (束の文字列に `https://` の取得先が無いことを走査) ③ 同じ入力で 2 回の `constants` から導かれるカメラ行列が同一 ④ 日本語ラベルのフォントは `sans-serif` 指定のみで、豆腐の判定は T-3DP-08-10。⑤ `pnpm --filter @a2p/worker typecheck` と束ね手順が通り、`pnpm install --frozen-lockfile` が通る。
- **依存**: SP-3DP-03 T-3DP-03-11 (worker 配線)
- **参照**: F-3DP-25 / docs/12 §16.2.2〜§16.2.3, §17.5.5 (3), §17.1 (`render/`)

### T-3DP-08-07 `render.ts` (Playwright)

- **対象ファイル**: `apps/worker/src/tasks/tdp/render/render.ts` / `render/browser-port.ts` (Playwright を包む注入可能なポート。`note-*` のポートに倣う) / テスト
- **やること**: 起動引数 `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --no-sandbox --disable-dev-shm-usage` (**`--disable-gpu` は付けない**: WebGL を殺す事例がある)。`page.route` で束と GLB を配る (巨大な data URI にしない)。1 タスクにつき 1 起動・**必ず close**。`webglcontextlost` は**1 回だけ**再描画。`UNMASKED_RENDERER` を記録し SwiftShader / llvmpipe 以外なら `renderer_unexpected` を警告に併記。1 枚描くごとに中断シグナルを見て、立っていれば描いた枚数を返して中断。Chromium が落ちたらタスク内で 1 回だけ再起動。失敗時はデバッグ画像を `tdpDebug` に。
- **受入基準**: ① ブラウザポートを fake にした単体: 1 起動で 6 枚、例外が起きても `close` が呼ばれる、`webglcontextlost` が 2 回起きたら `render_context_lost`、中断で描画済み枚数を返す ② **実 Chromium の煙テスト** (`render.smoke.test.ts`。合成の立方体 GLB を描いて `selfcheck` が通る): CI の Playwright 環境で実行し、結果 (レンダラ名・所要) をログに出す。実行できない環境では skip ではなく `TDP_REQUIRE_RENDER=1` で失敗にできる ③ 起動引数に `--disable-gpu` が含まれない (テスト)。
- **依存**: T-3DP-08-06
- **参照**: F-3DP-25 / docs/12 §16.2.3 (起動引数・ブラウザ運用・fail-closed), §17.5.5 (3), §17.11 (描画)

### T-3DP-08-08 `tdp.preview.render` と `rerenderPreview`

- **対象ファイル**: `apps/worker/src/tasks/tdp/preview-render.ts` / `apps/worker/src/runner.ts` / `apps/3dp/app/actions/product.ts` (`rerenderPreview`) / `packages/contracts/src/tdp/cron-registry.ts` (変更なし。cron ではない) / テスト
- **やること**: payload `{job_id?, product_id, asset_version, rerender?}`・キュー `tdp-render`・`maxAttempts:2`・ハードタイムアウト 8 分。**現在の配布版でなければ何もしない** (古い版の再投入を無視)。6 枚を R2 `tdpPreview(...)` に、`tdp_previews` に行 (`name` `asset_version` `width` `height` `selfcheck_json`)。**1 枚でも自己検査に失敗したら `ready` のまま止め**、失敗種別を `status_reason_json` と `jobs` に日本語で (例「プレビューが白画像だったため失敗にしました。GPU の無い環境では描画が白く返ることがあります。『再描画』で作り直せます (credit は消費しません)」)。中断されたら `outcome='interrupted'` を書き**自分を `runAt: now+5s` で再投入して成功終了**(ロックを残さない)。終了時に `advanceToReview()`。`rerenderPreview({product_id})`: 描画ジョブを再投入。進行中なら `render_in_progress`。`kind='texture'` は SP-3DP-07 で定めた 6 枠の定義があるときだけ描く。**無い間は `ready` に留め理由を出す**(未定義のまま `review` に進めない)。
- **受入基準**: ① 白画像を返す fake → 商品が `ready` のまま・理由が日本語・`review` に進まない ② 同じ版の再実行で `tdp_previews` が増えない (UPSERT) ③ 中断 → 自分の再投入が `runAt` つきで 1 件・タスクは成功終了 ④ 古い `asset_version` の payload は何もしない ⑤ `scale_reference` が無い/失敗の商品は `review` に進めない ⑥ `rerenderPreview` の連打が `render_in_progress` になる ⑦ キューが `tdp-render`、`maxAttempts:2`。
- **依存**: T-3DP-08-07, T-3DP-08-01, SP-3DP-03 T-3DP-03-06
- **参照**: F-3DP-25/46 / docs/12 §17.5.2 (中断), §17.5.4 (`tdp.preview.render`), §17.5.5 (3), §17.4 (`rerenderPreview`)

### T-3DP-08-09 `advanceToReview`

- **目的**: プレビューと原稿の**遅い方**が `ready → review` を進める (T-10)。どちらが先に終わっても、同時に終わっても、**1 回だけ**遷移する。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/advance-to-review.ts` / テスト (実 PG)
- **やること**: 条件 — ① 現在の配布版の 6 枚 (`scale_reference` を含む) が揃い `selfcheck_json.passed` が全部真 ② 全対象媒体で**最新の原稿が `passed`** かつ `for_asset_version` が現在の配布版。満たせば `transitionProduct` で `ready→review` (T-10)、`review_round` を +1。満たさないとき**何が足りないか**を `status_reason_json` に (「プレビュー 5/6」「原稿(Jinxxy)が不合格」など)。
- **受入基準**: 実 PG — ① プレビュー先 → 原稿後、原稿先 → プレビュー後、の両順で最終的に `review` ② 2 本を並走させても遷移は 1 回で `review_round` は +1 のみ ③ 古い版のプレビュー・原稿は数えない ④ 足りない物が理由に出る ⑤ 原稿が不合格 (`passed=false`) のままなら `review` に進まない。
- **依存**: T-3DP-08-05, T-3DP-08-08
- **参照**: docs/12 §17.3 (T-10), §17.8.1

### T-3DP-08-10 U-15 / U-18 の実機計測  ⛔ OP-07 待ち

- **目的**: 描画方式 (SwiftShader) が**当方の本番イメージで動くか**を測って U-15 を閉じる。測らずに「5 分以内」を主張しない。
- **対象ファイル**: `scripts/3dp/render-bench.ts` / `docs/12-3dp-design.md` (§11 U-15 / U-18 / §12) / (必要時) `apps/worker/Dockerfile` (`fonts-noto-cjk`)
- **やること**: 合成 GLB を 2 種作り (① `ACCESSORY` 上限: 7,500 三角形・1024px×2 ② `PROP` 上限: 20,000 三角形・2048px×4)、各 **10 回**、6 枚の壁時計・ピーク RSS (子プロセス込み)・レンダラ名・自己検査の合否を記録。**本番 worker と同じ Docker イメージ**で、メモリ上限を OP-07 の値に合わせて実行する(第一候補 = ローカルで同イメージを `docker run`。本番を触らない。A2P の Playwright ジョブとの**同時負荷**が必要なら本番で一時的に)。運営者が 6 枚を目視 (OP-03) し、日本語ラベルが豆腐かを確認。
- **合格基準 (§16.2.4)**: 6 枚の p95 ≤ 5 分 (p50 が 1 分を大きく超えるなら描画サイズ / MSAA を落とす)・ピーク RSS ≤ 割当の 60%・A2P ジョブと同時でも OOM なし・自己検査が全部通る・6 枚が商品として見える・日本語ラベルが豆腐でない。
- **不合格のときの逃げ道 (この順)**: ① 解像度・MSAA を下げる ② 描画だけ別 Railway サービス (同イメージ、`tdp-render` 専用、メモリ増) ③ 運営者のローカル PC で動かす (承認前に 1 操作増え G-E に響く) ④ Blender。**どれを採るかは運営者に判断を仰ぐ**(pm を計画モードで再起動)。豆腐なら Dockerfile に `fonts-noto-cjk` を足す。
- **受入基準**: docs/12 の U-15 / U-18 の行が「実測値・実施日・結論」か「未確認 (理由)」。合格/不合格の判定が上の 6 項目それぞれについて書かれている。`render_selfcheck` のしきい値 (暫定 0.02 / 6) を実測で更新するか据え置きの根拠を記録。
- **依存**: T-3DP-08-08, OP-07, OP-03, OP-18
- **参照**: docs/12 §16.2.4, §11 U-15/U-18, §15.4.1 (描画 5 分以内)

### T-3DP-08-11 設計書の追従

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/03-tech-selection.md` / `docs/dev-plan.md`
- **やること**: F-3DP-25〜27・50 の状態を実装範囲だけ更新。§12 に Inc-4 前半の実装状況と U-15/U-18 の結果。docs/03 §4 の `three` の固定バージョンを実装に合わせる。標準文面が `proposed` であることを記載。
- **受入基準**: grep で docs/03 の `three` 行がバージョン固定。F-3DP-26 の状態が更新。コードは触らない。
- **依存**: T-3DP-08-10
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `media` / `listing-check` / `selfcheck` / listing agent (fake LLM) / `render.ts` (fake ブラウザ) / compose の分岐。
- **Vitest (実 PG)**: compose の版管理・preview の UPSERT・`advanceToReview` の両順と並走。
- **実 Chromium**: 煙テスト 1 本(CI の Playwright 環境)。**描画の自己検査自体を単体テスト**(空画像を渡して失敗することを確認)。
- **手動 (自動化しない)**: 6 枚が商品として見えること、日本語ラベル (OP-03)。

## 7. 完了判定

- T-3DP-08-01〜11 が APPROVED + PASS。T-3DP-08-10 は OP-07 / OP-03 の完了込み (⛔)。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` 緑。
- **U-15 の判定が出ている** (合格 or 逃げ道の選択が運営者によって決まっている)。不合格のまま SP-3DP-09 に進まない。
- `ready` の商品が実際に `review` へ進む (実キー・実描画で 1 件)。
- 申し送り: 標準文面は `proposed` のまま (OP-09 は SP-3DP-09)。描画が別サービス/ローカルになった場合は SP-3DP-09 以降の運営手順が変わる。
