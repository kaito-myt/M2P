# SP-3DP-07 inc3b-texture-path — テクスチャ商材の生成経路 (Inc-3 後半・条件付き)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **このスプリントは「撤退分岐の移し先」であり、実施順が D-0 / P-0 の結果で変わる。**
> - **D-0 / P-0 が A (3D が届く)**: SP-3DP-06 の後、SP-3DP-08 (Inc-4) の前に実施。優先度は 3D の次 (§3.1 の優先 2)。
> - **D-0 / P-0 が B (3D が届かない・テクスチャは届く)**: **SP-3DP-03 の前**に実施し、Meshy 関連タスクを凍結する (`SP-3DP-01` §7)。pm を計画モードで再起動して SP-3DP-03〜06 を再編する。
> - **C**: 実施しない。
> 設計 §17.5.4 は「テクスチャ種別の task 分解は Inc-3 の前に 1 セット試作してから確定」と定めている。本スプリントの T-3DP-07-01 がその確定。

## 1. 目的

3D 生成を使わず、**画像生成 → `sharp` による継ぎ目判定と派生マップ → 検査 → 以降は 3D と同じ**という経路を作る (§6)。
BOOTH の 3Dテクスチャは 29,100 件あり、**人気上位はアイテクスチャ / メイク / 肌マテリアルで、汎用タイリング布地ではない** (§13.2) — つまり「テクスチャ集に軸足を移す」といっても移し先の品質は未検証 (U-23) であり、本スプリントの入口で必ず 1 セット作って確かめる。

## 2. 対応機能 ID

F-3DP-13 (テクスチャ経路), F-3DP-14/15 (検査・版), F-3DP-19 (企画にテクスチャを含める), F-3DP-17 (画像生成の費用記録), F-3DP-47 (歩留まり)
解く未確認事項: **U-23**

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-03** | 1 セット (albedo + 法線 + 粗さ + 2×2 タイル確認画像) を目視し、**「これを ¥500 で売れる」か**を記録 | T-3DP-07-01 | 経路を確定できない (U-23 が閉じない) |
| (PM-決定) | **`is_distribution` の扱い**: DB の部分 UNIQUE (b) は「商品ごとに配布版 1 行」。テクスチャ商品は複数マップを持つため、**配布版 = (product, version) とし、`is_distribution` は代表行 (`name='albedo'`) に付け、同じ `version` の `texture_map` 全行を配布対象とする** | T-3DP-07-01 | 採用として進める (設計書に明記が無かった論点。docs/12 §7.2 `TdpAsset` と §17.5.5-2 への追記は T-3DP-07-06) |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-07-01 | ⛔ | 1 セット試作と経路の確定 | U-23 の判定・テクスチャ商品の定義 | U-23 | S |
| T-3DP-07-02 | ⬜ | テクスチャ検査 `inspectTextureSet` | 解像度・継ぎ目・単色・形式・枚数 | F-3DP-03 (拡張), 14 | M |
| T-3DP-07-03 | ⬜ | `tdp.texture` (画像生成の呼び出し) | role 追加・画像ロギング・プロンプト | F-3DP-13, 17 | M |
| T-3DP-07-04 | ⬜ | `tdp.image.generate` と鎖への接続 | 台帳 `stage='image'`・マップ保存・検査・最適化 | F-3DP-13, 14, 15 | L |
| T-3DP-07-05 | ⬜ | 企画にテクスチャを含める | `TDP_IMPLEMENTED_KINDS` と統合テスト | F-3DP-19 | M |
| T-3DP-07-06 | ⬜ | 設計書の追従 | `is_distribution` の扱い・経路の task 分解 | (Rule #7/#8) | S |

合計 **6 タスク**。

---

## 5. タスク詳細

### T-3DP-07-01 1 セット試作と経路の確定  ⛔ 運営者待ち

- **目的**: 設計が未確定とした 3 点 — ① 法線・粗さを画像から作る品質 ② タイリング継ぎ目の合否基準 ③ 「アイ / メイク / 肌」系の需要中心を画像生成で満たせるか — を 1 セットで確かめ、後続タスクの仕様を固定する。
- **対象ファイル**: `docs/12-3dp-design.md` (§6 テクスチャ経路・§17.5.4・§11 U-23) / `docs/dev-plan.md` (§11)
- **やること**: SP-3DP-01 の `scripts/3dp/texture-probe.ts` で作った画像 (または追加の 1 セット) を運営者が評価 (OP-03)。次を**決めて文書に固定**する: ① テクスチャ商品の構成 (マップの名前 `albedo` / `normal` / `roughness` / (`ao`) と各解像度。出力サイズの上限) ② 継ぎ目判定のしきい値 (`seamScore` の合格値。タイル系のみ。アイ・肌系は判定しない) ③ 画像生成のプロンプトの作り方 (`tdp.prompter` を流用するか、日本語企画から直接作るか。**Meshy 向けの英語・定型接尾辞は使えない**) ④ 1 商品の画像生成回数の上限 (再生成上限と整合) ⑤ `is_distribution` の扱い (§3)。**結論が「テクスチャも届かない」なら本スプリントを中止**し C の協議へ。
- **受入基準**: docs/12 に ①〜⑤ が書かれ、各項目に根拠 (試作の結果 or 「未確認 (理由)」)。U-23 の行に結論。運営者の判定 (OP-03) が記録されている。
- **依存**: SP-3DP-01 T-3DP-01-03, OP-03
- **参照**: docs/12 §16.8 行 11, §11 U-23, §17.5.4, §13.2

### T-3DP-07-02 テクスチャ検査 `inspectTextureSet`

- **対象ファイル**: `packages/mesh/src/texture.ts` (SP-3DP-01 の `texture-seam.ts` を土台に拡張) / `packages/mesh/src/index.ts` / テスト
- **やること**: `inspectTextureSet(maps, thresholds)` — 形式は PNG / JPEG のみ・各辺 ≤ 上限・マップの枚数・**単色 (flat) 検出**・タイル系の継ぎ目 (`seamScore`)・ファイルサイズ上限・マップ間の寸法一致。問題は**全部まとめて**返す (credit ではなく画像代を無駄にしないため)。しきい値は T-3DP-07-01 で固定した値を引数で受ける。第 3 のしきい値種別 `TEXTURE` を `PROP`/`ACCESSORY` と並べる (§15.4.7)。
- **受入基準**: 単色・継ぎ目あり・WebP・サイズ超過・寸法不一致の合成画像がそれぞれ別のコードで検出され、1 回の呼び出しで**全部**返る。合格セットは issues 0。判定にリテラルが無い (しきい値は引数)。`pnpm --filter @a2p/mesh test:unit` 緑。
- **依存**: T-3DP-07-01
- **参照**: F-3DP-03/14 / docs/12 §15.4.7, §17.5.5

### T-3DP-07-03 `tdp.texture` (画像生成の呼び出し)

- **対象ファイル**: `packages/contracts/src/agents/llm-client.ts` (`AgentRole` に `'tdp.texture'`) / `packages/contracts/src/cost-attribution.ts` のテスト / `packages/agents/src/tdp/texture.ts` / `packages/db/seed-tdp.ts` / テスト
- **やること**: `AgentRole` に `tdp.texture` を追加し、`defaultToolForRole('tdp.texture') === '3dp'` と `'tdp.meshy'` (LLM でないので `AgentRole` に入れないが `token_usage.role` の文字列としては使う) のテストを足す。画像生成は既存の `generateImage` を `withImageLogging({ tool: '3dp', role: 'tdp.texture', jobId })` で包む (**記録しない呼び出しを作らない**)。プロンプトは T-3DP-07-01 の決定に従う。画像モデルの解決は既存の画像 role の作法に合わせる。
- **受入基準**: `withImageLogging` 経由でしか `generateImage` を呼ばない (`pnpm check:llm-client` 緑)。`token_usage` に `tool='3dp'`・`role='tdp.texture'` の 1 行 (fake)。seed が冪等。`prompts` 本文が不変。
- **依存**: T-3DP-07-01
- **参照**: F-3DP-17 / docs/12 §7 末尾 (記録の形), §17.12, §17.14 d-2

### T-3DP-07-04 `tdp.image.generate` と鎖への接続

- **目的**: テクスチャ商品を `planned` から `ready` まで進める。3D と同じ**台帳 (`tdp_generations`)・CAS・上限**を通す。
- **対象ファイル**: `apps/worker/src/tasks/tdp/asset-generate.ts` (テクスチャ分岐) / `apps/worker/src/tasks/tdp/image-generate.ts` / `apps/worker/src/tasks/tdp/asset-inspect.ts` / `asset-optimize.ts` (テクスチャ分岐) / `apps/worker/src/runner.ts` / テスト
- **やること**: ① `kind='texture'` の関所は `stage='image'`・`provider='openai-image'` で `reserveGeneration` (purpose_key `{product}:{ver}:image:{n}`。親は不要: DB の CHECK (c) は `image` を除外済み)。Meshy 系の確認 (キー・`tdp_meshy_model`・月 credit) は**スキップ**し、縮退モード (Meshy を使わない) でも動く。② `tdp.image.generate`: 同期の HTTP なので poll は不要。台帳 `reserved→submitting→succeeded/failed/lost` の CAS を 3D と同じ作法で。**画像 API が結果不明のとき `lost` にして再投入しない**(課金される可能性。3D と同じ L7)。生成した画像を `sharp` で派生マップ (法線・粗さ) に → R2 `tdpAsset(...,'texture','png',name)` → `tdp_assets` (`stage='texture_map'`, `name`)。③ `tdp.asset.inspect` が `kind='texture'` で `inspectTextureSet`。NG → `needs_fix` → 再生成 (上限内)。OK → `tdp.asset.optimize` (PNG の無損失再圧縮のみ) → 代表行を `is_distribution` に → `ready`。④ 日本語の理由 (`texture_seam` 等) を `toTdpReason` に追加。
- **受入基準**: ① 注入した画像生成の呼び出し回数が、同じ `generation_id` の再実行で増えない (台帳 CAS) ② 画像 API が reject → `lost`・再投入なし ③ 継ぎ目 NG のセットが `needs_fix` → 再生成 → 上限 (系列 3・企画 10) で `failed`・理由に回数 ④ 合格で `ready`・配布版の代表行が 1 つ(部分 UNIQUE に違反しない)・同 version の全マップ行が存在 ⑤ Meshy キー未設定でもテクスチャ商品は進む ⑥ 縮退/撤退/停止中は関所で止まる ⑦ `token_usage` が画像 1 回につき 1 行。実 PG で検証。
- **依存**: T-3DP-07-02/-03, SP-3DP-03, SP-3DP-04
- **参照**: docs/12 §6 (テクスチャ経路), §17.5.4, §17.6.1 L1〜L9 (画像にも同じ考え方), §7.4 (c)

### T-3DP-07-05 企画にテクスチャを含める

- **対象ファイル**: `packages/contracts/src/tdp/kinds.ts` (`TDP_IMPLEMENTED_KINDS` に `texture`) / `apps/worker/src/tasks/tdp/product-plan.ts` / `apps/worker/src/tasks/tdp/__tests__/pipeline.int.test.ts` (テクスチャ版を追加) / `apps/3dp/app/(app)/settings/_tabs/plan-price.tsx` (「準備中」の文言を外す)
- **やること**: `texture` を実装済み種別に。企画の按分で再配分が解ける。試作登録 (`registerTrialProduct`) の `kind` に `texture` を許可し、見積りを「画像 N 枚 ≒ ¥X」に (credit でなく円)。パイプライン統合テストに「テクスチャ: planned → ready」(シナリオ A') と「重複配送」(C') を追加。
- **受入基準**: ① 構成比 50/30/20 が 3 区分で按分される ② テクスチャの企画で Meshy の fetch が 0 回 ③ パイプライン A' / C' が CI で緑 ④ 設定画面から「準備中のため企画されません」が消える。
- **依存**: T-3DP-07-04
- **参照**: F-3DP-19 / docs/12 §3.1, §17.7.2

### T-3DP-07-06 設計書の追従

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md`
- **やること**: §7.2 `TdpAsset` と §17.5.5-2 に「テクスチャ商品の配布版は (product, version)。`is_distribution` は代表行」を追記。§17.5.4 にテクスチャ経路の task 分解を確定版として記載。U-23 の行を更新。F-3DP-13 の状態注記。
- **受入基準**: grep で `代表行` が §7.2 にある。U-23 の行が「結論 or 未確認 (理由)」。コードは触らない。
- **依存**: T-3DP-07-05
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `inspectTextureSet` / `tdp.texture` (fake 画像生成) / 按分。
- **Vitest (実 PG)**: テクスチャの台帳・配布版の代表行・パイプライン A' / C'。
- **Playwright**: 既存シナリオにテクスチャ種別を足す程度 (専用の E2E は作らない)。

## 7. 完了判定

- T-3DP-07-01〜06 が APPROVED + PASS (T-3DP-07-01 は運営者の判定込み)。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` 緑。
- テクスチャ商品 1 点が実キー (画像生成) で `ready` まで進み、運営者が「¥500 で売れる」と判定済み。
- 申し送り: SP-3DP-08 の描画は `kind='texture'` を**平面 + タイル表示**で描く必要がある (3D の 6 枚構成と異なる)。SP-3DP-10 の ZIP は FBX を含まない (§17.5.4 `tdp.package.build`: texture は FBX 不要)。
