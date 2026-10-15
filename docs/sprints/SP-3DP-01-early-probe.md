# SP-3DP-01 early-probe — 実キーでの最小実測と「やめる判断」(D-0)

> 3DP 系列 (M2P 第3ツール)。A2P の `SP-01`〜`SP-17` とは**別系列**。全体計画は `docs/dev-plan.md` §11。
> 設計の正本は `docs/12-3dp-design.md`。タスクの「参照」は同書の § を指す。
> 状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち

## 1. 目的

台帳・キュー・画面の作り込み (SP-3DP-03 以降の約 100 タスク) に入る**前**に、実キーで Meshy の出力とテクスチャ代替経路を最小コスト (約 150 credits ≒ ¥450 + 画像数枚) で測り、
**「3D 生成は販売水準に届くか」(G-A) の予備判定 D-0 を出す**。届かなければ SP-3DP-03〜05 に投資する前に軸足を移せる (§10 の撤退分岐を最も早い位置に置く)。

> **このスプリントが存在する理由 (順序の根拠)。** 設計の G-A / P-0 は Inc-2 の完了時 (= 台帳・poll・検査・最適化・画面が全部できた後) に初めて判定される。
> そこまでに約 40 タスクを使う。**品質が届かないという結論が出るのに必要な情報は、台帳なしの 6 回の POST で得られる。**
> 先に測れば、悪い結論でも失うのは本スプリントの 4 タスクだけで済む。

## 2. 対応機能 ID

- F-3DP-05 (Meshy クライアントの安全化: 一部), F-3DP-16 (しきい値の出典), F-3DP-03 (検査の実機適用)
- 閉じる/前進させる未確認事項: **U-2, U-13 (暫定), U-17, U-24 (一覧 API の有無), U-26, U-29, U-23 (前段), U-4**、TBD-8 の判断材料
- 判定: **D-0** (G-A の予備判定。正式な G-A / P-0 は SP-3DP-05)

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-01** | Meshy Pro ($20/月) を契約し API キーを発行。**ローカルの `.env.local` の `MESHY_API_KEY` にだけ入れる** (ポータル API 管理への登録は SP-3DP-03) | T-3DP-01-01/02 の完了後、probe を実行する前 | T-3DP-01-05 が着手できない (D-0 が出ない)。他のスプリントは進められるが**投資判断は D-0 待ち**と明記 |
| **OP-02** | ① **台帳整備前に実キーで probe を回すことの承認** (下記「例外の範囲」) ② **D-0 の判定基準 (下記 §6) の承認** | OP-01 と同時 | 承認なし = probe は回さない。SP-3DP-03 で台帳完成後の初回実行 (P-0) が最初の実測になり、判断が約 8 週遅れる |
| **OP-03** | 生成された GLB / 画像を目視し、**「これを ¥500 で売れる」か**を 1 件ずつ記録 (`result.json` の `operator_verdict`) | probe 実行後 | D-0 が出ない |

### 例外の範囲 (OP-02 ①)

申し送り 4 は「実キーを入れる前に二重課金の静的テストと統合テストが緑」を前提にしている。本スプリントはその**前**に実キーを使うので、次の理由と制限つきの**例外**として運営者に承認を求める。

- 理由: 台帳が防ぐのは**自動再試行・並走・再起動による二重 POST**。probe は運営者が手で 1 回ずつ起動する CLI で、worker / graphile / 再試行を一切通らない。
- 制限: ① 1 起動 = preview 1 回 + (任意) refine 1 回の **POST 上限を `runProbe` が構造的に守る** (テストで固定) ② `--max-credits` を超える見積りは POST 前に拒否 ③ タイムアウトでも**再 POST しない** (task_id を出して `--resume`) ④ `--confirm` が無ければ dry-run ⑤ キーは env のみ、出力に含めない ⑥ 総使用量は **150 credits まで** (超える追加ラウンドは再承認)。
- 記録の例外: Hard Rule #5 (全呼び出しを `token_usage` に記録) の**例外**として、probe の Meshy 費用は `token_usage` に入れず `result.json` と docs/12 §12 に手で残す (台帳以前の実測であり、`tool='3dp'` の月次原価に混ぜない)。**テクスチャ probe の画像生成は `withImageLogging` 経由で記録する** (こちらは例外にしない)。
- 静的テスト (SP-3DP-03 T-3DP-03-10) は `createTextTo3d` / `createRemesh` の呼び出しを `meshy-submit.ts` に限る。probe は `packages/mesh/src/probe.ts` から呼ぶため、**そのテストの許可リストに `probe.ts` を明記する** (許可リストに載せる行為自体が例外の記録になる)。

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-01-01 | ⬜ | MeshyClient の安全化 (最小) | `definitelyNotCreated` / POST タイムアウト / `aiModel` 必須 / `lowpoly` 禁止 / `getBalance` | F-3DP-05 | M |
| T-3DP-01-02 | ⬜ | probe ロジックと CLI | 1 起動 1 POST の構造保証・残高差分・所要記録・`--resume`・`--list-recent` | F-3DP-05, U-2/13/17/24/26/29 | M |
| T-3DP-01-03 | ⬜ | テクスチャ probe (代替経路の検証) | 継ぎ目スコア・法線導出・画像生成 CLI (`token_usage` に記録) | U-23 | M |
| T-3DP-01-04 | ⬜ | しきい値の出典 (U-4) | `THRESHOLD_SOURCES` を項目 1:1 で持つ | F-3DP-16 | S |
| T-3DP-01-05 | ⛔ | 実測の記録と D-0 判定 | docs/12 §11/§12 への記録・D-0 を A/B/C で確定 | — | S |

合計 **5 タスク**。T-3DP-01-05 は OP-01〜03 の完了まで着手できない。

---

## 5. タスク詳細

### T-3DP-01-01 MeshyClient の安全化 (最小)

- **目的**: probe (と後続の submit) が「POST されたか不明」と「確実に作られていない」を区別でき、`latest` モデルに落ちず、廃止予定の `lowpoly` を送れないようにする。
- **対象ファイル**: `packages/mesh/src/meshy.ts` / `packages/mesh/src/index.ts` / `packages/mesh/__tests__/meshy.test.ts`
- **やること**:
  - `MeshyError` に `definitelyNotCreated: boolean` と `rateLimitKind?: 'NoMorePendingTasks' | 'NoMoreConcurrentTasks'` を追加。**HTTP 応答を受け取った 4xx のみ true** (429 も応答を受け取っているので `definitelyNotCreated=true`、ただし `retryable` は従来どおり)。`fetchImpl` が reject (ネットワーク断・タイムアウト) した例外は **`MeshyError` に包み直し** `definitelyNotCreated=false` (現状は素の `TypeError` が漏れる)。5xx も false。
  - POST 系に `AbortSignal.timeout(timeoutMs ?? 30_000)` (`MeshyClientOptions.timeoutMs` で注入可)。
  - `MeshyTextTo3dArgs` に `aiModel: string` を**必須**で追加し body の `ai_model` に送る。`modelType?: 'standard' | 'smart-topology'` (**`'lowpoly'` は型で不可**)、`enablePbr?: boolean` (body `enable_pbr`)。refine は `aiModel` を省略すると preview を継承 (設計 §16.4.1) なので refine 側は任意。
  - `getBalance(): Promise<unknown>` — `GET /openapi/v1/balance` の**生 JSON** を返す (フィールド名が未確認なので取り出しは呼び出し側が防御的に行う)。
  - `waitForTask` は残す。コメントに「worker は呼ばない (poll ステップが 1 回 1 GET の `getTask` を使う)。スクリプト・ローカル検証用」と明記。
- **受入基準 (機械判定)**:
  1. `pnpm --filter @a2p/mesh test:unit` が緑。既存 19 件は**削除せず**、`aiModel` 必須化に伴う引数の追加だけで通す。
  2. 新規 10 件以上: 4xx 応答 → `definitelyNotCreated===true` / 5xx → false / `fetchImpl` reject → `MeshyError` かつ false (素の `TypeError` が漏れない) / 429 本文の 2 種を `rateLimitKind` に / `aiModel` が body に載る / `getBalance` が生 JSON を返す。
  3. 型テスト: `aiModel` 省略と `modelType: 'lowpoly'` が `// @ts-expect-error` で**コンパイルエラーになる**こと (`pnpm --filter @a2p/mesh typecheck` が緑のまま)。
  4. `createRemesh` / `getRemesh` は**このタスクでは足さない** (SP-3DP-10)。
- **依存**: なし
- **参照**: F-3DP-05 / docs/12 §17.14 d-1, §16.4.1, §17.6.2 末尾, §17.13 の「失敗系」

### T-3DP-01-02 probe ロジックと CLI

- **目的**: 運営者が 1 コマンドで「1 題材 × 1 モデル」を測り、**所要・残高差・検査結果・UV の有無・一覧 API の有無**を `result.json` に残せるようにする。
- **対象ファイル**: `packages/mesh/src/probe.ts` / `packages/mesh/src/index.ts` (export) / `packages/mesh/__tests__/probe.test.ts` / `scripts/3dp/meshy-probe.ts` / `.gitignore` (`.probe-out/` を追加)
- **やること**: `runProbe(deps, opts)` (`fetchImpl` / `now` / `sleep` / 出力書込み関数を注入) を `probe.ts` に。手順:
  1. `getBalance()` を before として記録 (失敗は記録して続行)。
  2. 見積り (preview 20 / `meshy-6-lite` は 5 / refine 10) が `maxCredits` を超えたら**POST 0 回で拒否**。`dryRun` も POST 0 回。
  3. 題材文字列を `checkDerivativeRisk` (`@a2p/contracts/tdp/derivative-guard`) に通し、`allowed=false` なら POST 0 回で拒否 (R-2。日本語中心の規則なので英語は SP-3DP-04 T-03 まで素通りしうる点を result に注記)。
  4. preview を**1 回だけ** POST。**task_id を受け取った直後・待機の前に** stdout と `result.json` へ書く。
  5. `getTask` を間隔 `pollIntervalSec` で回し、`progress` の推移と経過秒・poll 回数 (U-13) を記録。上限 (`maxWaitMin`) でタイムアウトしても**再 POST しない**。task_id と `--resume <task_id>` の案内を出して非 0 終了。
  6. SUCCEEDED なら GLB を取得して `inspectGlb(glb, ACCESSORY_THRESHOLDS)` (kind=accessory) / `PROP_THRESHOLDS` (kind=prop)。**NG コードの全件・実測値・`missing_uv` の有無 (U-29)・テクスチャ枚数と各解像度 (TBD-8)** を記録。
  7. `refine` オプション指定かつ preview 検査にブロッキング NG が無い (`no_mesh` / `too_many_triangles` のみで shape を判定: 設計 §17.5.5) ときだけ refine を**1 回** POST → 同様に取得・検査。
  8. `getBalance()` を after として記録し `credit_observed = before - after` を算出。**FAILED / CANCELED のとき差分が出るか (U-26)** をそのまま記録 (推測で埋めない)。
  9. `--list-recent`: タスク一覧 API (`GET /openapi/v2/text-to-3d?...` など公式 docs に記載のもの) を 1 回だけ試み、**存在した / 404 / 形**を記録 (U-24)。存在しなくても失敗扱いにしない。
  10. 出力: `.probe-out/<ISO>/result.json` と `*.glb`。`result.json` に `operator_verdict: null` を持たせ、運営者が追記する (OP-03)。
  - CLI `scripts/3dp/meshy-probe.ts` は薄く: `pnpm tsx scripts/3dp/meshy-probe.ts --subject "<英語の名詞句>" --kind accessory --model meshy-6 --max-credits 40 [--refine] [--confirm] [--resume <id>] [--list-recent]`。`--confirm` が無ければ dry-run。**キーは `MESHY_API_KEY` から読むのみ (引数に取らない)**。
- **受入基準 (機械判定。fake fetch で)**:
  1. 正常系: preview の POST がちょうど 1 回。`--refine` なしなら refine の POST は 0 回。あり + shape 合格なら refine の POST が 1 回 (合計 2)。
  2. `maxCredits` 超過・`dryRun`・R-2 拒否のとき `fetch` 呼び出し **0 回**。
  3. poll がタイムアウトしても POST 合計は 1 のまま、`result.json` に task_id が残り、再実行しても (同一プロセス内で) 再 POST しない。
  4. POST が reject (ネットワーク) のとき再 POST なし、`outcome: 'post_outcome_unknown'` を記録。
  5. `result.json` と stdout に API キー文字列が**含まれない** (キーを `sk-test-SECRET` にして全出力を走査)。
  6. `balance_before / after / credit_observed` と `elapsed_sec` / `poll_count` / `progress[]` が出力に存在。
  7. `pnpm --filter @a2p/mesh test:unit` / `typecheck` 緑、`pnpm check:llm-client` 緑。
- **依存**: T-3DP-01-01
- **参照**: docs/12 §17.6.2 (POST の作法), §17.5.5, §16.4.1, §11 U-2/U-13/U-17/U-24/U-26/U-29

### T-3DP-01-03 テクスチャ probe (代替経路の検証)

- **目的**: 「3D が届かなければテクスチャ集に軸足を移す」の**移し先が実在するか**を同時に確かめる。移し先が未検証のまま撤退分岐を置くのは危うい (U-23 は設計時点で未検証)。
- **対象ファイル**: `packages/mesh/src/texture-seam.ts` / `packages/mesh/src/index.ts` (export) / `packages/mesh/package.json` (`sharp` を追加) / `packages/mesh/__tests__/texture-seam.test.ts` / `scripts/3dp/texture-probe.ts`
- **やること**:
  - `seamScore(png): {horizontal:number, vertical:number, flat:boolean, passed:boolean, reason?:string}` — 左右端・上下端の 1px 列の平均絶対差を、画像内部の隣接列差の平均で正規化した値 (しきい値は引数。既定は暫定で、結果は運営者の目視が最終)。**単色画像は `flat:true` で `passed=false` (reason `flat`)** にする (空画像を合格にしない: UR-2 と同じ思想)。
  - `tile2x2(png): Buffer` — 2×2 に並べた確認用画像。
  - `deriveNormalMap(png, strength)` / `deriveRoughness(png)` — 輝度からの Sobel 法線と反転輝度の粗さ。**品質の合否は決めない** (U-23 の問いは「画像から作る法線が使い物になるか」で、運営者が見て判断する)。
  - CLI: `pnpm tsx scripts/3dp/texture-probe.ts --kind tile|eye --prompt "<英語>" --n 3 --confirm`。画像生成は既存の `generateImage` を `withImageLogging({ tool: '3dp', role: 'tdp.texture' })` で包む (`AgentRole` への追加は SP-3DP-07。`role` は string で渡せる)。**`DATABASE_URL` が無ければ実行を拒否** (記録できない呼び出しをしない: Hard Rule #5)。`--n` は 6 まで。
  - `--kind eye` は §13.2 の需要の中心 (アイ・メイク・肌) を想定した**非タイル題材**。継ぎ目判定は適用せず、運営者の目視のみ。
- **受入基準**:
  1. `seamScore`: 周期的パターン (sin) → `passed` / 左右端で明るさが跳ぶ → `!passed` / 単色 → `flat===true && !passed`。
  2. `deriveNormalMap`: 平坦入力で全画素が (128,128,255) から ±2 以内、出力寸法が入力と同じ。
  3. CLI は `DATABASE_URL` 未設定で OpenAI を**呼ばずに**エラー終了 (注入した fake で呼び出し 0 回)。`--n 7` は拒否。
  4. `pnpm --filter @a2p/mesh test:unit` / `typecheck` 緑。
- **依存**: なし (T-3DP-01-01 と並行可)
- **参照**: docs/12 §16.8 行 11, §11 U-23, §13.2, §7 末尾 (画像ロギング)

### T-3DP-01-04 しきい値の出典 (U-4)

- **目的**: `PROP_THRESHOLDS` / `ACCESSORY_THRESHOLDS` の各値が**誰がいつ決めた値か**を残す (`prune()` の事故で「値の由来が消える」害を避ける)。D-0 の「検査が厳しすぎるのか」を切り分ける前提でもある。
- **対象ファイル**: `packages/mesh/src/inspect.ts` / `packages/mesh/__tests__/inspect.test.ts` / `docs/12-3dp-design.md` (§12 に差分記録)
- **やること**: 2 種 × 5 項目 (三角形 / テクスチャ解像度 / 枚数 / マテリアル / 寸法) に対し `THRESHOLD_SOURCES: Record<'PROP'|'ACCESSORY', Record<item, {url:string|null, confirmed_on:string|null, note:string}>>` を export。VRChat / Quest の公式ドキュメント (Performance Ranks 等) を確認して URL と確認日 (YYYY-MM-DD) を入れる。**確認できなかった項目は `url:null` + `note:'未確認 (当方の設定値)'`** にして嘘の出典を書かない。公式値と食い違う場合は**値を変えず**、差分と「なぜ当方が厳しく/緩くするか」を docs/12 §12 に書く。
- **受入基準**:
  1. テスト: 2 種 × 5 項目の**全キー**が `THRESHOLD_SOURCES` に存在し、`url` が非 null なら `confirmed_on` が日付形式、null なら `note` が「未確認」を含む。
  2. `PROP_THRESHOLDS` / `ACCESSORY_THRESHOLDS` の**値は不変** (スナップショットテスト)。既存 inspect テスト 18 件が緑。
  3. docs/12 §12 に「確認日 / 食い違い 0 件 or 一覧 / 未確認項目一覧」。
- **依存**: なし
- **参照**: F-3DP-16 / docs/12 §15.2 F-3DP-16 の具体化 ①②, §11 U-4

### T-3DP-01-05 実測の記録と D-0 判定  ⛔ 運営者待ち

- **目的**: probe の結果を設計書に反映し、**D-0 を事前登録した基準 (§6) に照らして A / B / C で確定**する。
- **対象ファイル**: `docs/12-3dp-design.md` (§11 の U-2/U-13/U-17/U-24/U-26/U-29 の行、§12 に実測記録の節、TBD-8 の決定) / `docs/dev-plan.md` (§11 の決定ログに D-0 の結果)
- **やること**:
  - 各 U について `実測値 / 実施日 / 結果ファイル名 (.probe-out/<ts>) / 結論`、または**「未確認のまま (理由)」**を書く。推測で埋めない。
  - U-13 は「この 1 回の所要」であり**確定値ではない** (確定は SP-3DP-05 T-3DP-05-11 の台帳経由の実行) と明記。`meshy_poll_interval_sec` / `meshy_poll_max_minutes` の暫定値の根拠にだけ使う。
  - U-17: どのモデルが通り、品質・credit がどう違ったか → `tdp_meshy_model` の初期値の候補を 1 つ。
  - TBD-8 (`maxTextureCount: 2` と PBR): 実測のテクスチャ枚数に基づき「`enablePbr:false` で足りる / しきい値見直しが要る / 要追加計測」のどれかを書く。しきい値を変える場合は F-3DP-16 の手順で差分を §12 に残す。
  - D-0 の結論を A / B / C で確定し、B / C の場合は**凍結するタスク ID を列挙**する (§7)。
  - 使った credit 合計・残高差・画像生成の円を記録 (probe の費用の手書き記録: §3 の例外)。
- **受入基準**:
  1. 上記 6 つの U の行すべてに「実測 or 未確認 (理由)」が入っている (空欄 0)。
  2. D-0 の結論が A/B/C のいずれかで、根拠として §6 の条件 (技術面 / 運営者面 / 費用面) の成否が 3 行で書かれている。
  3. 実キー・署名付き URL・Meshy の応答本文全体が docs に**含まれない** (task_id は可)。
- **依存**: T-3DP-01-02, T-3DP-01-03, OP-01, OP-02, OP-03
- **参照**: docs/12 §10, §14.5.2 G-A, §17.17-4

---

## 6. D-0 の判定基準 (事前登録・運営者承認 = OP-02 ②)

> **結果を見てから基準を決めない**ために、実行前にここへ固定する。値はすべて【提案値】。

**実験計画** (合計 ≤ 150 credits):

| ラウンド | 内容 | credit 目安 |
|---|---|---|
| 1 | 題材 2 種 (例: 小さな湾曲した角 / 細身のドロップ型ピアス。実在作品に寄せない) × モデル `meshy-6`・`meshy-6-lite`・(entitlement があれば) `latest` の preview。計 4〜6 回 | 5〜20 / 回 → 約 60〜100 |
| 2 | ラウンド 1 で shape 合格のうち上位 2 件を refine | 10 / 回 → 約 20 |
| 3 | テクスチャ probe: タイル柄 3 枚 + アイ/肌 3 枚 | 画像のみ (数円) |

**判定**:

| 面 | 成功の条件 |
|---|---|
| 技術面 (3D) | refine 済み GLB のうち**ブロッキング NG が 0** (補正可能な `scale_*` / `origin_*` / `texture_too_large` は許容) のものが **1 件以上** |
| 運営者面 (3D) | その GLB を運営者が「**¥500 で売れる**」と判定 (OP-03) したものが **1 件以上** |
| 費用面 | 合計 credit ≤ 150 |
| 代替 (テクスチャ) | タイル柄 3 枚のうち `seamScore.passed` ≥ 2 かつ運営者が「¥500 で売れる」1 件以上、**または** アイ/肌 3 枚のうち運営者が「売れる」1 件以上 |

**分岐**:

| 結果 | 判定 | 次の行動 |
|---|---|---|
| 技術 ✓ かつ 運営者 ✓ | **A: 続行** | SP-3DP-02 以降を予定どおり。D-0 は予備判定で、正式な G-A / P-0 は SP-3DP-05 で台帳経由に測り直す |
| 技術 ✓ だが運営者 ✗ | 追加 1 ラウンド (≤ 100 credits、題材・プロンプトを変える) | なお ✗ なら B へ |
| 技術 ✗ の原因が構成上のもの (テクスチャ枚数・PBR) | TBD-8 の見直し 1 ラウンド (≤ 100 credits) | なお ✗ なら B へ |
| 3D ✗ かつ 代替 ✓ | **B: 軸足移動** | §7 の凍結と前倒しを実施し、pm を計画モードで再起動して SP-3DP-03〜05 を再編する |
| 3D ✗ かつ 代替 ✗ | **C: 縮退 / 撤退の協議** | 以降の投資を止める。SP-3DP-02 で作る安全装置は残るが新規スプリントは起こさない。運営者が撤退モードの扱い (§14.5.3) を決める |

## 7. B / C のときに凍結するもの

| 結果 | 凍結 | 前倒し / 変更 |
|---|---|---|
| **B** | SP-3DP-03 の T-3DP-03-03 (credentials meshy)・T-3DP-03-08 (meshy-submit)・T-3DP-03-09 (meshy-poll)、SP-3DP-04 T-3DP-04-02 (normalize)・T-3DP-04-08 の 3D 向け分岐 | **SP-3DP-07 (テクスチャ経路) を SP-3DP-03 の前へ**。台帳 (`reserve-generation`) は `stage='image'` で再利用する |
| **C** | SP-3DP-03 以降の全タスク | なし。運営者に判断を仰ぐ |

## 8. テスト計画

- **Vitest**: `packages/mesh` (meshy / probe / texture-seam / inspect)。fetch・時計・出力は全て注入。実キーは使わない。
- **Playwright**: なし (UI なし)。
- **手動 (運営者)**: probe の実行と GLB / 画像の目視 (OP-01〜03)。

## 9. 完了判定

- T-3DP-01-01〜04 が `/iterate` で APPROVED + PASS。`pnpm typecheck` / `pnpm test:unit` / `pnpm check:llm-client` 緑。
- T-3DP-01-05 が完了し、**D-0 が A / B / C で記録**されている。
- **T-3DP-01-05 が未完了の間は `PHASE_INCOMPLETE`** (D-0 が出ていないことを隠さない)。SP-3DP-02 はコード上 D-0 に依存しないので並行着手してよいが、**SP-3DP-03 以降の着手は D-0 が A であること**を前提にする。
- 次スプリントへの申し送り: 実測した `ai_model` の候補 → SP-3DP-03 T-3DP-03-01 の `tdp_meshy_model` 既定 (null のまま運営者が設定でも可)。TBD-8 の結論 → SP-3DP-04 T-3DP-04-01。
