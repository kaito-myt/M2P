# SP-3DP-04 inc2b-inspect-optimize-orchestrate — 検査・補正・最適化と生成の関所 (Inc-2 中盤)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-03 完了 (台帳・submit・poll が CI で緑)、SP-3DP-01 の D-0 が A。**

## 1. 目的

台帳の上に、**企画 1 件が `ready` (配布用 GLB が確定) になるまでのバックエンドの鎖**を作る: 生成の関所 (`tdp.asset.generate`) → 検査 → 補正・最適化。
併せて、`tdp.prompter` (TBD-2 により Inc-3 から前倒し)・英語の依拠性規則・寸法/原点の補正 (D-8) を入れる。
**このスプリントの終わりに、合成レスポンスで「企画 → ready」と「shape NG のとき refine を 1 度も呼ばない」を実 PG の統合テストで示す。** 画面と実キーでの実行は SP-3DP-05。

## 2. 対応機能 ID

F-3DP-13 (関所と 2 段生成), F-3DP-14 (検査・再生成ループ), F-3DP-15 (最適化・版), F-3DP-21 (`tdp.prompter` — Inc-2 へ前倒し), F-3DP-01 (英語規則: 回帰を含む), F-3DP-03/04 (実機適用), F-3DP-48 (直列化: 統合テスト), F-3DP-16 (U-4 の反映は SP-3DP-01 T-3DP-01-04)
対応する設計: §17.5.4 / §17.5.5 / §17.7.3 / §17.3 (T-3〜T-9) / §17.14 d-1・d-2

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| (PM-決定・拒否権あり) **TBD-7** | 寸法・原点・テクスチャ解像度を**補正で直す** (D-8)。F-3DP-14 の「NG → 再生成」の意味が変わり、補正で通過した分は歩留まりに別計上される。**推奨 = 採用**。却下する場合、Meshy の出力はスケールが保証されないため再生成が頻発し G-A の credit が膨らむ | T-3DP-04-02 の着手前 | **採用として進める** (T-3DP-04-02/-05/-08)。却下されたら該当部分を外して再計画 |
| OP-18 | 本番 DB 変更は無い (本スプリントに migration なし)。worker の再デプロイは SP-3DP-05 末にまとめる | — | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-04-01 | ⬜ | `@a2p/mesh` 検査の拡張 | `stage` オプション・`unsupported_*` コード・`thresholds_kind` | F-3DP-03, 15 | M |
| T-3DP-04-02 | ⬜ | `normalizeGlb` (寸法・原点・テクスチャの補正) | 等倍スケール・平行移動・縮小 | F-3DP-14 | M |
| T-3DP-04-03 | ⬜ | 依拠性ガードに英語規則 | 英語プロンプトを素通りさせない | F-3DP-01 | M |
| T-3DP-04-04 | ⬜ | `tdp.prompter` (契約・実装・seed) | I/O zod・DB プロンプト・モデル割当 | F-3DP-21 | L |
| T-3DP-04-05 | ⬜ | `decideAfterInspect` (純関数) | 検査 NG の 3 分類と次の一手 | F-3DP-13, 14 | S |
| T-3DP-04-06 | ⬜ | `tdp.asset.generate` (生成の関所) | 停止/キー/モデル/上限/依拠性 #2/予約/投入 | F-3DP-13, 14, 21 | L |
| T-3DP-04-07 | ⬜ | `tdp.asset.inspect` | 検査の実行と次工程の振り分け | F-3DP-13, 14 | M |
| T-3DP-04-08 | ⬜ | `tdp.asset.optimize` | 補正→最適化→再検査→配布版の確定 | F-3DP-15 | L |
| T-3DP-04-09 | ⬜ | 起動時回収 `recoverTdpOnBoot` と中断の配線 | 古いロック・`lost`・孤児 poll の回収 | F-3DP-14 | L |
| T-3DP-04-10 | ⬜ | パイプライン統合テスト (企画 → ready) とキュー直列の証明 | 合成 Meshy・実 PG・実 graphile | F-3DP-13, 48 | M |

合計 **10 タスク**。

---

## 5. タスク詳細

### T-3DP-04-01 `@a2p/mesh` 検査の拡張

- **目的**: 形だけの段階で「まだ無い物」を NG にしない / 配布に使えない形式を弾く (§17.14 d-1, §16.3.2)。
- **対象ファイル**: `packages/mesh/src/inspect.ts` / `packages/mesh/src/index.ts` / `packages/mesh/__tests__/inspect.test.ts`
- **やること**: ① `inspectGlb(glb, thresholds, { stage?: 'shape' | 'final', kind?: 'PROP' | 'ACCESSORY' })`。`shape` ではテクスチャ系 (`texture_*`)・`missing_uv` (U-29 が確定するまで)・補正可能群 (`scale_*` `origin_*` `file_too_large`) を**判定対象から外し**、`no_mesh` / `too_many_triangles` / `degenerate_bounds` だけで合否を決める。指定なしは従来どおり (`final` 相当)。② 新コード `unsupported_texture_format` (PNG/JPEG 以外) と `unsupported_extension` (`KHR_draco_mesh_compression` / `EXT_meshopt_compression` / `KHR_texture_basisu` / `EXT_texture_webp`)。③ `InspectResult.thresholds_kind`。④ SP-3DP-01 の D-0 で TBD-8 が「しきい値見直し」になった場合のみ、その変更を F-3DP-16 の手順 (差分を docs/12 §12) で入れる。
- **受入基準**:
  1. 既存 18 件が無変更で緑。
  2. 新規: UV 無し + 4K テクスチャ + 親ノード 40 倍の合成 GLB を `shape` で検査 → issues に `missing_uv` / `texture_too_large` / `scale_too_large` が**出ない**。`final` では出る。三角形過多は `shape` でも出る。
  3. WebP テクスチャ入りの合成 GLB → `unsupported_texture_format`、Draco 拡張入り → `unsupported_extension`。
  4. `inspectGlb` の戻りに `thresholds_kind` がある。`pnpm --filter @a2p/mesh test:unit` / `typecheck` 緑。
- **依存**: SP-3DP-01 T-3DP-01-05 (TBD-8 の結論)
- **参照**: F-3DP-03/15 / docs/12 §17.5.5 (1)(2), §17.14 d-1, §16.3.2, §11 U-29

### T-3DP-04-02 `normalizeGlb` (寸法・原点・テクスチャの補正)

- **目的**: Meshy は寸法を保証しない。**等倍スケールと平行移動は形状を変えない**ので、credit を使わず直す (D-8)。
- **対象ファイル**: `packages/mesh/src/normalize.ts` (新規) / `packages/mesh/src/index.ts` / `packages/mesh/package.json` (`sharp` は SP-3DP-01 で追加済みなら不要) / `packages/mesh/__tests__/normalize.test.ts`
- **やること**: `normalizeGlb(glb, { targetMaxSizeMeters, grounded, maxTextureSize })` → `{ glb, scale_factor, translate: [x,y,z], textures_resized }`。① 最大辺が `targetMaxSizeMeters` になる**等倍スケール** (ルートに掛けるのではなく頂点とノードを実寸化し、親ノードのスケールを畳み込む) ② `grounded` なら底面中央を原点へ、そうでなければ原点は触らない ③ `maxTextureSize` を超えるテクスチャを `sharp` で縮小 (形式は PNG/JPEG を維持) ④ **形を変える処理 (`simplify` 等) は行わない**。
- **受入基準**:
  1. 「椅子 40m」の合成 GLB が目標 0.9m (±1%) になり、`scale_factor` が返る。補正後に `inspectGlb` の `scale_too_large` が消える。
  2. 「原点が浮いている」GLB が `grounded=true` で `minY≈0`・水平中心≈0 になる。アクセサリ (`grounded=false`) では平行移動が 0。
  3. 4096px テクスチャが 1024px になり、形式が保たれる。
  4. **形が変わっていない**: 三角形数が一致し、補正前後の頂点間の相対距離比が一定 (スケール係数のみ)。UV が保持される。
  5. 冪等: 補正済みを再補正すると `scale_factor≈1`・`translate≈0`。
- **依存**: T-3DP-04-01。**TBD-7 (PM 決定・拒否権あり)**
- **参照**: docs/12 §17.5.5 (1) D-8, §17.14 d-1 (`normalize.ts`), §12 (prune の罠)

### T-3DP-04-03 依拠性ガードに英語規則

- **目的**: 現行の規則は日本語中心で、英語の生成プロンプトの "in the style of ◯◯" / "inspired by" / "fan art" を**素通りさせる** (§17.7.3, §17.14 d-2 ①)。試作登録 (SP-3DP-05) で英語プロンプトが入る前に必要。F-3DP-22 の許可規則は SP-3DP-06。
- **対象ファイル**: `packages/contracts/src/tdp/derivative-guard.ts` / 既存テストファイル (回帰を維持して追記)
- **やること**: `checkDerivativeRisk` に英語規則を追加 (既存の `DerivativeRiskKind` を再利用: `style_imitation` / `fan_work_wording` / `creator_reference`): `in the style of` / `inspired by` / `fan ?art` / `homage to` / `parody of` / `from the (anime|game|manga|movie|series|film)` / `official (art|design|merch)` / `like <固有名詞>` (小文字 `like` の直後に大文字始まりの語)。**決定論 (LLM 非使用)**・正規化は既存 (NFKC + 小文字 + 空白除去) と整合させる。一般名の様式 (`gothic`, `art deco`, `japanese style`, `in a minimalist style`) は**通す**。
- **受入基準**:
  1. 既存 20 件が**無変更で緑** (日本語の挙動は不変)。
  2. 新規: 英語の拒否 8 件以上 (上記パターンごと 1 件ずつ) が `allowed=false` で該当語つき。通る英語 6 件以上 (`"a small curved horn, matte black ceramic, gothic style"` 等) が `allowed=true`。
  3. 同じ入力 100 回で同じ結果 (決定論)。
  4. 運営者の禁止語 (`tdp_derivative_denylist`) に英語語を足した場合も NFKC・大文字小文字で一致する。
- **依存**: なし
- **参照**: F-3DP-01 / docs/12 §17.14 d-2 ①, §17.7.3 末尾, §12 (依拠性ガードの判定仕様)

### T-3DP-04-04 `tdp.prompter` (契約・実装・seed)

- **目的**: 企画から Meshy 向けの**英語プロンプト**を設計する (TBD-2: Inc-2 へ前倒し)。再生成のときは検査 NG と差戻し理由を読んで直す。
- **対象ファイル**: `packages/contracts/src/agents/tdp.ts` (新規。prompter の I/O zod のみ。他 role は各増分で追記) / `packages/contracts/package.json` (`./agents/tdp`) / `packages/agents/src/tdp/prompter.ts` / `packages/db/seed-tdp.ts` (新規。`seed-anp.ts` と同型・冪等) / テスト
- **やること**: 入出力は §17.7.3 の zod (`TdpPrompterInputSchema` / `TdpPrompterOutputSchema`)。呼び出しは `loadActivePrompt('tdp.prompter', null)` (ジャンルなし) + `withTokenLogging({ tool: '3dp', jobId })`。**所見・方針・上限は user メッセージへ実行時注入**し `prompts` 本文を書き換えない。`seed-tdp.ts` に `tdp.prompter` のプロンプト本文 (日本語の指示。要点: 実在の作品・作家・キャラクターに寄せない / 形状・材質・スケールを明示 / 台座・地面・背景・文字を入れない (定型はコードが付ける) / `feedback` の NG コードに応じて直す) と `model_assignments` (`claude-sonnet-5`、**`temperature` を渡さない** — 400 になる。各 role に active を 1 件)。`AgentRole` には既に `tdp.prompter` がある。
- **受入基準**:
  1. 単体 (LLM を fake): 正常 → zod 検証通過。不正 JSON → `AgentError` で同一タスク内最大 2 回再呼び出し → なお失敗なら `PipelineError`。`feedback` / `reject_reason` / `previous_prompt` が user メッセージに含まれる。呼び出し引数に `temperature` が無い。
  2. **`prompts` 本文が呼び出し前後でバイト一致**。`withTokenLogging` が `tool='3dp'`・`role='tdp.prompter'` で 1 行記録。
  3. `seed-tdp.ts` を 2 回実行しても `prompts` / `model_assignments` が重複しない (冪等)。実 PG かモックで確認。`tdp.prompter` に active が 1 件。
  4. `pnpm check:llm-client` 緑 (生クライアントを使っていない)。
  5. `prompt_en` の最大 600 字・`target_polycount` 範囲などの境界値テスト。
- **依存**: SP-3DP-02 T-3DP-02-07。依拠性の英語規則は T-3DP-04-03 が先に入っていると安全
- **参照**: F-3DP-21 / docs/12 §17.7.0, §17.7.3, §17.12, §8, CLAUDE.md Hard Rule #4/#5。プロンプト本文のレビューを運営者に依頼してもよい (必須ではない)

### T-3DP-04-05 `decideAfterInspect` (純関数)

- **目的**: 検査 NG を **ブロッキング / 補正可能 / shape で無視** の 3 種に分類し、次の一手を決める (§17.5.5-1)。
- **対象ファイル**: `packages/contracts/src/tdp/inspect-decision.ts` (新規) / `packages/contracts/package.json` / テスト
- **やること**: `decideAfterInspect({ stage, issues: {code}[], counters: {...} })` → `{ next: 'refine' | 'optimize' | 'regenerate' | 'give_up', blocking, correctable }`。分類表は §17.5.5-1 (`no_mesh` `too_many_triangles` `too_many_materials` `too_many_textures` `missing_uv` `missing_normals` `degenerate_bounds` `unsupported_*` = ブロッキング / `scale_*` `origin_*` `texture_too_large` `file_too_large` = 補正可能)。`shape` では §17.5.5-1 の 3 コードだけを見る。上限判定は引数で受ける (数値リテラルを持たない)。`yieldCategory(history)` — 1 発合格 / 再生成後合格 / 補正で通過 / 打ち切り (F-3DP-47 の集計用)。
- **受入基準**:
  1. `shape` で `too_many_triangles` → `regenerate`、**`refine` を返さない**。`shape` OK → `refine`。
  2. `final` で補正可能のみ → `optimize`、ブロッキングあり → `regenerate` (上限内) / `give_up` (上限到達)。
  3. 全コード (`InspectIssueCode` の全値) がどれかに分類される (網羅テスト。新コードが追加されて未分類なら赤)。
  4. 判定ロジックに数値リテラルが無い (カウンタ上限は引数)。
- **依存**: T-3DP-04-01 (コード一覧)
- **参照**: docs/12 §17.5.5 (1), F-3DP-13 の受入具体化, F-3DP-47

### T-3DP-04-06 `tdp.asset.generate` (生成の関所)

- **目的**: **credit を払う前の全ての確認**を 1 箇所に (CPU/LLM のみで credit は払わない)。台帳に `reserved` を 1 行書き、submit を投入する。
- **対象ファイル**: `apps/worker/src/tasks/tdp/asset-generate.ts` / `packages/mesh/src/request.ts` (新規。`buildMeshyRequest` 純関数) / `packages/mesh/src/index.ts` / テスト (単体 + 実 PG)
- **やること** (§17.5.4 の行どおり。商品行を `SELECT ... FOR UPDATE` で握る):
  1. 確認の順序 (**LLM を呼ぶ前に全て**): 停止中 (`tdp_kill_switch_on`) / 撤退 / 縮退 → 理由つきで `skipped`。Meshy キー無し・`tdp_meshy_model` が null → 商品は `planned` のまま `status_reason_json` に理由 (`meshy_key_missing` / `meshy_model_unset`)。
  2. **依拠性 #2**: title・concept・`plan_json.subject_en`・(`operator_prompt_en`) を `checkDerivativeRisk` に。NG なら商品を `rejected` (T-2b)、`derivative_rechecks_json` に追記、**prompter も台帳も呼ばない**。
  3. `preview` のとき `tdp.prompter` を呼ぶ (`feedback` = 前回の NG コード・実測・しきい値、`reject_reason`、`previous_prompt`)。`buildMeshyRequest(prompterOut, product, settings)`: `prompt = prompt_en + ', ' + buildPropPromptSuffix(...)` / `negative_prompt = PROP_NEGATIVE_PROMPT + extra` / `target_polycount = min(出力, しきい値の最大三角形)` / **`ai_model = settings.tdp_meshy_model` (`latest` を送らない)** / `enable_pbr` は SP-3DP-01 の結論に従う。定型制約を LLM に任せない。
  4. `reserveGeneration` (T-3DP-03-07)。`blocked` なら T-8: 商品を `failed` にし、打ち切り理由・消費 credit・回数を `status_reason_json` と `jobs` に。`existing` なら**投入せず**に戻る。
  5. 商品を `generating` に (T-3: `planned→generating` / T-7: `needs_fix→generating`)。`refine` は親 (preview) の台帳行を必須にし、`previewTaskId` を**親台帳の `meshy_task_id` から読む** (payload・引数から受け取らない)。
  6. `tdp.meshy.submit` を `{ queueName:'tdp-meshy', maxAttempts:1, jobKey:'tdp-submit:{generation_id}' }` で投入。
- **受入基準**:
  1. キー無し / モデル null / 停止中 / 撤退 / 縮退 → **prompter 呼び出し 0 回・台帳行 0 行**。
  2. 依拠性 NG → `rejected`・prompter 0 回・台帳 0 行・`derivative_rechecks_json` に追記。
  3. 同じ payload を 2 回実行 → 台帳 1 行・submit の投入 1 回 (2 回目は `existing`)。
  4. `request_json.ai_model` が設定値と一致し `latest` でない / `target_polycount ≤` しきい値 / `negative_prompt` に `PROP_NEGATIVE_PROMPT` を含む / refine の `preview_task_id` が親台帳の値。
  5. 系列上限 3 を超える再生成は予約されず商品が `failed`、`status_reason_json` に回数と credit。
  6. submit の `addJob` が `maxAttempts:1`・`queueName:'tdp-meshy'`。
  7. 全ての `token_usage` 記録が `tool='3dp'` (prompter 経由)。
- **依存**: T-3DP-03-05/-07/-08、T-3DP-04-03/-04/-05
- **参照**: F-3DP-13/14/21 / docs/12 §17.5.4 (`tdp.asset.generate`), §17.3 (T-2b/T-3/T-7/T-8), §17.7.3 (最終 `request_json`), §17.6.1 L6

### T-3DP-04-07 `tdp.asset.inspect`

- **目的**: 検査の実行と、次工程の振り分け。**shape が NG なら refine を 1 度も呼ばない** (F-3DP-13 の受入)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/asset-inspect.ts` / テスト
- **やること**: R2 から取得 → `inspectGlb(bytes, thresholds(kind), { stage, kind })` (kind `accessory` → `ACCESSORY_THRESHOLDS`、`prop`/`furniture` → `PROP_THRESHOLDS`。`texture` は SP-3DP-07) → `inspect_json` / `inspect_ok` / `poly_count` / `byte_size` / `inspected_at` / `sha256` を書く → `decideAfterInspect`:
  - `shape` OK → 商品 `inspecting→generating` (T-5) + `tdp.asset.generate` (`reason:'refine'`)。
  - `final` OK または補正可能のみ → `tdp.asset.optimize`。
  - ブロッキング → `needs_fix` (T-6)。上限内なら `tdp.asset.generate` (`reason:'regen_ng'`, `feedback` に NG の `{code, actual, expected}`)、上限超過なら `failed` (T-8)。**T-6 と T-7/T-8 の判定は同一トランザクション**。
  - `status_reason_json` に NG を日本語ラベル + 実測値 + しきい値の形 (例「三角形が多い 31,402 / 上限 7,500」) で**最大 3 件 + 「他 N 件」** (F-3DP-12)。`result_json.summary.ng_codes` を持つ。
- **受入基準**:
  1. **shape NG のとき `refine` 用の fetch が 0 回、`tdp.asset.generate` が `regen_ng` で投入される** (注入した fetch / 投入関数の呼出回数)。
  2. 検査 NG は `outcome='ok'` (正常系) で、`needs_fix` が通常フローとして記録される (異常アラートにしない)。
  3. 5 件の NG があるとき `status_reason_json` の表示用配列が 3 件 + `他 2 件`。
  4. 同じ `asset_id` で 2 回実行しても `inspect_json` が上書きされるだけで、次工程の投入が重複しない (`jobKey` と台帳 CAS)。
  5. `inspect_ok` が NG 0 件のとき true。
- **依存**: T-3DP-04-01/-05/-06、T-3DP-03-05/-06
- **参照**: F-3DP-12/13/14 / docs/12 §17.5.4 (`tdp.asset.inspect`), §17.3 (T-5/T-6/T-7/T-8), §15.2 F-3DP-12 の具体化

### T-3DP-04-08 `tdp.asset.optimize`

- **目的**: 補正 → 最適化 → **再検査**を通した版だけを配布版にする (F-3DP-15)。**最適化が壊した物を出荷しない。**
- **対象ファイル**: `apps/worker/src/tasks/tdp/asset-optimize.ts` / `apps/worker/src/tasks/tdp/lib/enqueue-if-registered.ts` / テスト (単体 + 実 PG)
- **やること**:
  1. `normalizeGlb` → `optimizeGlb` (`dedup` / `weld` / `prune(keepAttributes:true)` のみ。`simplify` は行わない。WebP / Draco / meshopt / KTX2 は使わない) → `inspectGlb(final)`。`normalized_json` に補正の記録、`applied` も残す。
  2. **NG 0 件**なら `stage='distribution'` の行 + R2 `distribution.glb` を作り、`is_distribution` を**同一トランザクション内で 2 文**(旧配布版 `false` → 新版 `true`。逆順は部分 UNIQUE 違反) で付け替える。商品を `inspecting→ready` (T-9)。
  3. NG が残るとき: 最適化前の版が NG 0 ならそれを配布版にする (`applied=[]`・理由を記録)。それも NG なら `needs_fix` → 再生成判定へ。**最適化が壊したケースは `inspect_json.cause='optimize_regressed'`** として歩留まりに別計上 (F-3DP-47)。
  4. `ready` になったら `tdp.preview.render` と `tdp.listing.compose` を並列投入するが、**まだ存在しないタスクは投入しない** (`enqueueIfRegistered(name, ...)`: `buildTaskList()` に無い名前は何もせず `jobs` にも行を作らない — 未登録のタスク名を投入すると graphile が失敗を繰り返す)。Inc-2 の間、商品は `ready` で止まる。
- **受入基準**:
  1. 実 PG: 配布版の付け替えで部分 UNIQUE 違反が起きない。2 回実行しても `(product_id, version, 'distribution', 'main')` が 1 行。
  2. UV を持つ入力で最適化後も `hasUv===true` (`prune` の事故の再発防止: `keepAttributes:true`)。
  3. 最適化が NG を作る fake を注入 → 最適化前の合格版が配布版になる。両方 NG → `needs_fix` かつ `cause='optimize_regressed'`。
  4. **`ready` は最適化後の再検査が NG 0 のときだけ**。WebP を含む入力は配布版にならない。
  5. 未登録タスクへの投入が 0 件 (`enqueueIfRegistered` の spy)。
- **依存**: T-3DP-04-01/-02/-05/-07、T-3DP-03-05
- **参照**: F-3DP-15 / docs/12 §17.5.4 (`tdp.asset.optimize`), §17.5.5 (2), §12 (prune の罠), §16.3.2 (形式制約), §17.3 (T-9)

### T-3DP-04-09 起動時回収 `recoverTdpOnBoot` と中断の配線

- **目的**: worker がクラッシュ / 強制終了したジョブは**最大 4 時間キューを塞ぐ** (§16.5.1 罠 1)。無言で止まらないための回収と、デプロイ時の中断を実装する (U-25 / U-30)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/recover.ts` / `apps/worker/src/runner.ts` (`startRunner` が `run()` の前に呼ぶ・`installGracefulShutdown` が `runner.stop()` の前に `tdpShutdown.abort()`) / テスト (実 PG)
- **やること**: ① **まず実 PG で `\d graphile_worker.*` を確認し、`graphile-worker@0.16.6` の内部表名・列名 (`_private_jobs` / `_private_job_queues` の `locked_at` `locked_by` 等) を `recover.ts` の冒頭コメントに記録する (U-25)**。② `tdp-*` キューを 15 分超ロックしている行を解放 (**保守側 = 15 分超のみ**。U-30 の「デプロイ中に旧新 worker が並走するか」が否定できるまで短くしない)。③ 台帳 `submitting` が 10 分超 → `lost` (`credit_confidence='unknown'`)。④ 台帳 `submitted` で pending な poll ジョブが無いもの → poll を再投入。⑤ `kind LIKE 'tdp.%'` で `running` が 15 分超 → `failed` / `interrupted_by_restart` (世代の `tdp.meshy.poll` 行は除外)。
- **受入基準 (実 PG)**:
  1. 20 分前にロックされた `tdp-meshy` キューが解放され、**5 分前のものは触られない**。`tdp-*` 以外のキュー (A2P/ANP) は触られない。
  2. `submitting` 11 分 → `lost`、9 分 → 変化なし。`submitted` + pending poll 無し → poll が 1 件投入、pending ありなら投入しない。
  3. `running` 16 分の `tdp.asset.inspect` 行が `failed`、世代の `tdp.meshy.poll` 行は `running` のまま。
  4. 順序: `startRunner` が `recover` → `run` の順 / `installGracefulShutdown` が `abort` → `stop` の順 (spy)。
  5. U-25 の実際の内部表名が `recover.ts` 冒頭と docs/12 §11 U-25 に記録されている。**確認できなかった項目は「未確認」と書く**。
- **依存**: T-3DP-03-06/-08/-09、SP-3DP-02 T-3DP-02-04
- **参照**: docs/12 §17.5.2 (グレースフルシャットダウンと起動時回収), §16.5.1 罠 1, §11 U-25/U-30, §17.6.3

### T-3DP-04-10 パイプライン統合テスト (企画 → ready) とキュー直列の証明

- **目的**: 個々のタスクが緑でも**鎖として**動くことと、**F-3DP-48 (同時実行 1) が実 PG で成立すること**を示す。**実キー投入前の最後のゲート。**
- **対象ファイル**: `apps/worker/src/tasks/tdp/__tests__/pipeline.int.test.ts` / `apps/worker/src/tasks/tdp/__tests__/queue-serial.int.test.ts` / 合成フィクスチャ `apps/worker/src/tasks/tdp/__fixtures__/meshy/` (ファイル名と先頭コメントに「合成」)
- **やること**: Meshy (`fetchImpl`)・R2・prompter は fake、DB は実 PG。`addJob` を捕捉する in-memory キューでハンドラを順に実行する。
  - **シナリオ A (正常)**: 試作の `planned` → generate → submit → poll (PENDING→SUCCEEDED) → inspect(shape OK) → generate(refine) → submit → poll → inspect(final) → optimize → `ready`。
  - **B (shape NG)**: preview の GLB が三角形過多 → refine の POST が 0 回、再生成。系列 3 回で打ち切り `failed`、理由に回数と credit。
  - **C (重複配送)**: 全ハンドラを 2 回ずつ実行しても POST・`tdp_assets`・`token_usage`・次工程の投入が増えない。
  - **D (直列)**: 実 graphile-worker を実 PG で起動し、`queueName:'tdp-meshy'` に 2 本投入 → 実行区間が**重ならない** (ハンドラに待ちを入れて区間を計測)。別名のキューは並走できる。
- **受入基準**:
  1. A: POST **ちょうど 2 回**・`token_usage` 2 行 (`provider='meshy'`, `tool='3dp'`)・台帳 2 行が `succeeded`・`tdp_assets` に `shape` / `textured` / `distribution` (配布版は 1 つ)・商品の `status_changed_at` が単調増加・最終 `ready`。
  2. B: refine の fetch 0 回・商品 `failed`・`status_reason_json` に「再生成の上限 (3 回)」と消費 credit。
  3. C: 全カウントが A と同一。
  4. D: 区間の重なり 0。
  5. CI で `TDP_REQUIRE_PG=1` により実行される (skip されない)。**この 4 本が CI で緑であることが、実キー投入 (SP-3DP-05 T-3DP-05-11) の前提**。
- **依存**: T-3DP-04-06/-07/-08/-09、T-3DP-03-10
- **参照**: docs/12 §17.13 (実 PG の統合テスト 1)、§16.5.1 罠 2、F-3DP-13/48、§17.17-4

---

## 6. テスト計画

- **Vitest (単体)**: inspect 拡張 / normalize / 英語規則 (回帰 20 + 新規) / prompter (fake LLM) / `decideAfterInspect` / generate / inspect / optimize の分岐。
- **Vitest (実 PG)**: generate の並走 / optimize の配布版付け替え / recover 4 種 / パイプライン A〜D。
- **Playwright**: なし (画面は SP-3DP-05)。
- **フィクスチャ**: 合成 GLB は `packages/mesh/__tests__` のビルダーを再利用 (椅子 40m・原点が浮いている・UV 無し・4K テクスチャ・WebP)。実ファイルを置かない。

## 7. 完了判定

- T-3DP-04-01〜10 が `/iterate` で APPROVED + PASS。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` (CI) / `pnpm check:llm-client` 緑。
- **鎖が合成データで通る**: パイプライン A〜D が CI で緑 (= 実キー投入の前提が揃った)。
- 申し送り: ① `ready` の商品に対し `tdp.preview.render` / `tdp.listing.compose` は未登録のため投入されない (Inc-4)。SP-3DP-08 で `enqueueIfRegistered` が自動的に有効になることを確認する ② U-25 の実測 (内部表名) を docs/12 に反映済み ③ 実キーの初回実行は SP-3DP-05 T-3DP-05-11。
