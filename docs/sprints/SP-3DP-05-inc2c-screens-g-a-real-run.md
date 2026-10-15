# SP-3DP-05 inc2c-screens-g-a-real-run — 画面・実行状況・G-A の運営者判定と実キーでの初回実行 (Inc-2 完了 = P-0)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-04 完了 (パイプライン A〜D が CI で緑)、SP-3DP-01 の D-0 が A。**

## 1. 目的

運営者が**試作 1 点を登録し、検査と版履歴を読み、GLB を自分の目で回して、「これを ¥500 で売る」と言えるか**を判定できる状態にする (G-A)。
併せて「止まっている理由」を読める画面 (商品詳細・実行状況・ホームの要対応・原価と歩留まり) を作り、**実キーで初回実行して U-13/14/17/24/25/26/29 を実測する** (申し送り 4)。
**Inc-2 の完了 = P-0 (G-A の正式判定)。** ここで届かなければ軸足をテクスチャに移す (SP-3DP-07 を前倒し)。

## 2. 対応機能 ID

F-3DP-12 (一覧・詳細: 理由), F-3DP-13/14/15 (画面から見える部分), F-3DP-16 (しきい値の出典を画面に), F-3DP-17 (credit の記録を原価に), F-3DP-36 (G-A のみ: ライブ算出), F-3DP-38, F-3DP-46 (定期タスク一覧・`jobs` 行), F-3DP-47 (歩留まりと原価), F-3DP-49 (R2 使用量の表示), F-3DP-11 (Meshy 接続テストと残高)
対応画面: S-3DP-01 (要対応・判定パネル G-A・資源・定期タスク), S-3DP-02 (理由列・試作登録), S-3DP-03 (節 1〜4・10), S-3DP-06 (生成タブ), S-3DP-07 (原価・歩留まり), S-3DP-08

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-05** | **R2 バケットの CORS 設定** (署名付き URL を `<model-viewer>` が別オリジンから読むため。TBD-4 により ModelViewer が Inc-2 になったので、**運営作業も Inc-2 に前倒し**)。許可オリジン = 本番 `https://3dp.m2p.tools` と開発 **`http://localhost:3004`** (設計 §17.9.4 の `3010` は仮置きで、`apps/3dp` の実ポートは 3004)。`GET`/`HEAD`・`Range`・`ExposeHeaders: Content-Length, Content-Range, ETag`。A2P/ANP の既存利用に影響しない読み取り許可のみ | T-3DP-05-04 の手動確認前、遅くとも T-3DP-05-11 前 | ModelViewer が「読み込めません」になる。G-A の目視判定ができない = P-0 が出ない |
| **OP-01** | Meshy キーを**ポータル API 管理に登録** (本スプリント冒頭 = SP-3DP-03/04 の CI が緑になってから) | T-3DP-05-11 前 | 実キーでの実行ができない |
| **OP-06** | U-21 (R2 の現使用量) と U-22 (Meshy クレジットの繰越の有無・追加購入単価) を確認 | T-3DP-05-11 前。不明でも進行可 (仮置きは安全側) | 資源欄の警告値の根拠が弱いまま。`meshy_monthly_credit_cap` 900 は据え置き |
| **OP-03** | 生成物を目視し **G-A の判定を画面で入力** (`recordGateAJudgement`) | T-3DP-05-11 の最中 | P-0 が出ない |
| **OP-17** | ワイヤーフレーム PNG (S-3DP-01 / -03 / -08 の `prompt.md`)。**S-3DP-02・-05・-07 は `prompt.md` がまだ無い** (§9.8 の文章から実装する) | T-3DP-05-03/-05/-06/-08 の着手前が望ましい | `prompt.md` と §9.8 から実装 |
| **OP-07** | U-18: Railway の worker サービスの割当 vCPU / RAM と直近のメモリピークを Railway ダッシュボードで確認 (SP-3DP-08 の描画計測に必要。**ここで聞いておく**) | SP-3DP-08 前 | 描画計測の合格基準 (割当の 60% 以内) を判定できない |
| **OP-18** | 本番 DB への migration 適用 (SP-3DP-02 T-3DP-02-03 / SP-3DP-03 T-3DP-03-01)・コードと worker のデプロイ (`railway up --service <svc> --detach`)。**migration を先に適用してからコードをデプロイする** | T-3DP-05-11 前 | 本番で実行できない |
| (任意・承認制) | U-25 / U-30 の本番確認: 生成の進行中に worker を 1 回再デプロイし、`recoverTdpOnBoot` と SIGTERM の猶予をログで確認する | T-3DP-05-11 | 実機確認なしで「保守側の仮置き」のまま進む |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-05-01 | ⬜ | cron 登録一覧・G-A のライブ算出・`tdp.gates.snapshot` (Inc-2 分) | `TDP_CRON_TASKS`・`computeGates` (G-A)・資源の観測 | F-3DP-36, 46, 49 | L |
| T-3DP-05-02 | ⬜ | `apps/3dp` から graphile へ投入する基盤と試作登録 Action | `graphile-client`・`registerTrialProduct`・`confirmTrialGeneration` | F-3DP-13, 20 (一部) | M |
| T-3DP-05-03 | ⬜ | 商品一覧: 理由・次の一手の列と試作登録ダイアログ | 状態別の理由・注意ピル・ダイアログ | F-3DP-12, 14 | M |
| T-3DP-05-04 | ⬜ | 商品詳細の Action と ModelViewer | `getViewerUrl`・`recordGateAJudgement`・対話ビューア | F-3DP-28 (部品), G-A | M |
| T-3DP-05-05 | ⬜ | 商品詳細 S-3DP-03 (節 1〜4・10) | 止まっている理由・企画・版履歴・検査・履歴・G-A 判定 | F-3DP-12〜16, 47 | L |
| T-3DP-05-06 | ⬜ | 実行状況 S-3DP-08 と定期タスクの Action | 登録一覧 × `jobs` の左結合・フラグ・今すぐ実行 | F-3DP-46 | L |
| T-3DP-05-07 | ⬜ | 商品別原価 `cost.ts` と損益と原価 S-3DP-07 (原価・歩留まり) | 原価集計・歩留まり 4 指標 | F-3DP-17, 47 | M |
| T-3DP-05-08 | ⬜ | ホーム Inc-2 の節 (要対応・判定パネル G-A・資源・定期タスク) | 4 値バッジ・節ごとの独立描画 | F-3DP-35, 36, 37, 46 | L |
| T-3DP-05-09 | ⬜ | 設定「生成」タブと Meshy 接続テスト | 接続テスト・残高・モデル・暫定値の表示 | F-3DP-11, 16, 38, 49 | M |
| T-3DP-05-10 | ⬜ | E2E: 試作登録・商品詳細・G-A 判定・実行状況 | 画面の主要シナリオ | F-3DP-12, 14, 46 | M |
| T-3DP-05-11 | ⛔ | **実キーでの初回実行と実測 (P-0)** | U-13/14/17/24/25/26/29/30/31 の実測・台帳レポート | (申し送り 4) | M |
| T-3DP-05-12 | ⬜ | 設計書の追従と Inc-2 完了の記録 | docs/12 §11/§12/§15.1・docs/10・docs/03・dev-plan | (Rule #7/#8) | S |

合計 **12 タスク**。

---

## 5. タスク詳細

### T-3DP-05-01 cron 登録一覧・G-A のライブ算出・`tdp.gates.snapshot` (Inc-2 分)

- **目的**: 画面が「定期タスクを履歴からでなく**コード側の一覧**から作る」(§9.6.3)・G-A を 4 値で出す・外部値の取得失敗を理由つきで残す、ための土台。
- **対象ファイル**: `packages/contracts/src/tdp/cron-registry.ts` / `packages/contracts/src/tdp/gates.ts` / `packages/contracts/package.json` / `apps/worker/src/tasks/tdp/gates-snapshot.ts` / `apps/worker/src/crontab.ts` / `apps/worker/src/runner.ts`
- **やること**:
  - `cron-registry.ts`: §17.5.1 の `TdpCronTask` と `TDP_CRON_TASKS` **5 本すべて** (`tdp.product.plan` は **`30 21 * * *`**)。`nextCronRun(cron, from)` (`m h * * d` 形式に限定した純関数。外部 cron パーサを足さない)。各行に `implemented` (その増分でタスク本体が存在するか) を持たせ、**未実装の行は画面に「準備中 (まだ実行されません)」と出す** (「Inc-3」等の開発用語は出さない: UR-8)。
  - `crontab.ts`: `CRON_ITEMS` に **`implemented` なものだけ**展開 (`...TDP_CRON_TASKS.filter(implemented).map(...)`)。`buildCronItemsWithSettings` には載せない (条件付き cron は worker 起動時にしか組まれず、フラグ変更が効かない実害が 2 件)。識別子は `tdp-` で始める。Inc-2 で実装済みなのは `tdp.gates.snapshot` のみ。
  - `gates.ts`: `TdpGateRow` 型と `computeGates(inputs)` — **本スプリントでは G-A の実体のみ**。他のゲート (G-B〜G-E) は `unevaluated` と「評価が始まる条件」の文言を返す (実体は SP-3DP-11)。G-A の規則 (§17.10.1): 配布版を持つ試作 0 件 or 運営者判定なし → `unevaluated` / 最新判定 `sellable` → `ok`、`not_sellable` → `fail` / 企画の打ち切りで配布版が 1 つも無い → `fail`。`value = ok_products / trial_products`。判定に数値リテラルを持たない。
  - `gates-snapshot.ts` (Inc-2 分): `runTdpTask` で包み、① `recoverTdpOnBoot` の軽量版 ② 資源の観測: **Meshy 残高と R2 `3dp/` の使用量**を取得し `tdp_resource_snapshots` に記録。**失敗は `ok=false` + `error` で残し、他を続行**し `outcome='partial'` (台帳 #16)。`tdp_gate_snapshots` は SP-3DP-11 まで無い。
- **受入基準**:
  1. `TDP_CRON_TASKS` が 5 本、識別子が全て `tdp-` で始まる、`tdp.product.plan` の cron が `30 21 * * *`、`label_ja` / `schedule_ja` が JST。`nextCronRun('30 21 * * *', 2026-10-15T20:00Z)` が 2026-10-15T21:30Z。
  2. **静的テスト (再発防止)**: `CRON_ITEMS` の全 identifier が `TDP_CRON_TASKS` にあり、`implemented` な全 task が `buildTaskList()` にある (2026-10-09 の `locks.sweep` 登録漏れの再発防止)。`implemented=false` の task は `CRON_ITEMS` に**入らない**。
  3. `computeGates` の G-A: 6 ケース (試作 0 / 判定なし / sellable / not_sellable / 打ち切りで配布版なし / 複数判定で最新が有効) が上記のとおり。他ゲートは必ず `unevaluated` で、`ok` を返さない。設定値を変えても結果が変わる箇所にリテラルが無い。
  4. `gates-snapshot`: Meshy 残高の取得が失敗しても R2 の観測は続き、`tdp_resource_snapshots` に `ok=false` 行と `ok=true` 行が両方できる。cron 起点でも `jobs` 行が 1 本できる。
  5. `pnpm test:unit` / `typecheck` 緑。
- **依存**: SP-3DP-03 (runTdpTask), SP-3DP-04 T-3DP-04-09 (recover)
- **参照**: F-3DP-36/46/49 / docs/12 §17.5.1, §17.10.1 (G-A), §9.6.3, §9.7 台帳 #16, §17.13 (静的テスト)

### T-3DP-05-02 graphile への投入基盤と試作登録 Action

- **目的**: 運営者が試作 1 点を登録する入口 (§9.12-4)。**R-2 ガードを通し、拒否も `rejected` で残し、credit の見積りを見せてから生成を始める。**
- **対象ファイル**: `apps/3dp/lib/graphile-client.ts` (`apps/anp/lib/graphile-client.ts` に倣う) / `apps/3dp/next.config.ts` / `apps/3dp/package.json` (`graphile-worker`) / `pnpm-lock.yaml` / `apps/3dp/app/actions/trial.ts` / `apps/3dp/lib/trial-core.ts` / テスト
- **やること**: `registerTrialProduct` / `confirmTrialGeneration` を §17.4 のとおり。
  - `registerTrialProduct({kind, subject, note?, price_jpy, media, prompt_en?})`: `checkDerivativeRisk` を subject + note + prompt_en に。**拒否なら `rejected` で行を保存し `ok:true` の `data.rejected={risks}` を返す** (情報であってエラーではない)。価格が `tdp_min_price_jpy` 未満 → `price_below_min` (行を作らない)。Meshy キー無し → `meshy_key_missing`、`tdp_meshy_model` null → `meshy_model_unset`、撤退モード → `retire_mode`。許可なら `planned` / `origin='trial'` で保存し、**credit の見積り** (`estimateCredits`: 1 発合格 35・最悪 75 と円換算) を返す。**生成はまだ始めない。**
  - `confirmTrialGeneration({product_id})`: `UPDATE ... SET status_reason_json = {code:'generation_requested'} WHERE id=$1 AND origin='trial' AND status='planned' AND status_reason_json->>'code' IS DISTINCT FROM 'generation_requested'` の更新件数 1 の者だけが `jobs` 行 (`tdp_product_id`) を作り `tdp.asset.generate` (`reason:'initial'`, `maxAttempts:3`) を投入。二重クリックは `not_planned`。
- **受入基準**:
  1. 英語・日本語の「◯◯風」「in the style of ◯◯」が `rejected` として保存され、`data.rejected.risks` に種別と該当語。許可の入力は `planned` で、見積り 35 / 75 が円つきで返る。
  2. `registerTrialProduct` が `addJob` を**呼ばない** (spy)。499 円 → `price_below_min` かつ行が増えない。
  3. `confirmTrialGeneration` を 2 回 → 1 回目のみ投入、2 回目 `not_planned`。`origin='planner'` の商品には効かない。
  4. 未認証は `code:'auth'`。`apps/3dp` が `pnpm build` で通る (graphile を Next にバンドルしない設定: ANP の `next.config.ts` に倣う)。
- **依存**: SP-3DP-04 T-3DP-04-03 (英語規則), SP-3DP-03 T-3DP-03-07 (`estimateCredits`), SP-3DP-02 T-3DP-02-07
- **参照**: docs/12 §17.4, §9.8 S-3DP-02 (試作登録), §17.6.4, §9.12-4

### T-3DP-05-03 商品一覧: 理由・次の一手の列と試作登録ダイアログ

- **対象ファイル**: `apps/3dp/app/(app)/products/page.tsx` / `apps/3dp/app/(app)/products/_components/trial-dialog.tsx` / `apps/3dp/lib/product-reason-core.ts` (新規) / `apps/3dp/lib/messages.ts` / テスト
- **やること** (§9.8 S-3DP-02 の表どおり): 列に **理由・次の一手** と **販売本数** (売上が無い間は `—`) を追加。商品名の遷移先を `/products/[id]` に、BOOTH は別の小さな外部リンク。ピルに**注意** (滞留) を 2 行目で、件数つき。ヘッダーに「試作を登録」ダイアログ (入力 → `registerTrialProduct` → 結果を同じダイアログに表示 → 「生成を開始」で `confirmTrialGeneration` → 詳細へ遷移)。Meshy キー未設定ならボタンは無効 + 理由 (ポータル API 管理へ)。
  - `product-reason-core.ts`: 状態別の文言を純関数で。**要修正**: NG を「日本語ラベル + 実測値 + しきい値」で最大 3 件 + 「他 N 件」(例「三角形が多い 31,402 / 上限 7,500」)、再生成 n/3 / **失敗**: 打ち切り理由・消費 credit・回数 / **却下**: 拒否種別 (例「『〜風』表現」) / **生成完了**: 配布用データが確定した旨 / **承認待ち以降**: 後続増分で足すので本タスクでは「承認の準備はこれからです」 / **滞留**: 「N 時間動いていません」(`stall_hours` は設定から)。
- **受入基準**:
  1. `product-reason-core` の単体: 各状態の文言、NG 5 件で「3 件 + 他 2 件」、`failed` に credit と回数、滞留判定が `status_changed_at` と設定の `stall_hours` から決まる。運営者向け文言に `Inc-` が含まれない。
  2. 一覧に行選択・一括操作の部品が**無い** (UR-4。`checkbox` を一覧に使っていないことをテストで走査)。
  3. 商品名リンクが詳細へ、BOOTH リンクは `listed_at` がある場合のみ。
  4. 絞り込み結果 0 件の文言が商品 0 件の文言と**異なる** (§9.6.3)。
- **依存**: T-3DP-05-02。OP-17 (PNG) があれば参照
- **参照**: F-3DP-12/14 / docs/12 §9.8 S-3DP-02, §9.7 台帳 #4/#6/#7, §9.10.2

### T-3DP-05-04 商品詳細の Action と ModelViewer

- **目的**: 運営者が **GLB を自分の GPU で回して**見て、G-A の判定を残せるようにする (TBD-4: G-A の運営者判定は GLB を見ないとできないが、設計は承認画面 (Inc-4) にしか置いていなかった)。
- **対象ファイル**: `apps/3dp/app/actions/product.ts` (`getViewerUrl` / `recordGateAJudgement`) / `apps/3dp/components/model-viewer.tsx` (クライアント) / `apps/3dp/package.json` (`@google/model-viewer ^4`) / `pnpm-lock.yaml` / テスト
- **やること**: `getViewerUrl({product_id})` — **`is_distribution=true` の GLB だけ**に署名付き URL (TTL 15 分、副作用なし、GET にしない)。中間版は出さない。無ければ `no_distribution`。`recordGateAJudgement({product_id, verdict, reason})` — 配布版を持つ商品のみ、`reason` 必須 (`reject_reason_min_chars` を設定から)、`judged_by` はセッションの email、**追記のみ** (最新が有効)。`ModelViewer`: 読み込み中 / 失敗 / 成功の 3 状態、失敗時は「ビューアを読み込めません: 〈理由〉」+ R2 の CORS 設定の確認を促す文言。`next/dynamic` で `ssr:false`。
- **受入基準**:
  1. `getViewerUrl`: 署名関数に渡されるキーが `is_distribution` の行のものだけ (中間版のキーで呼ばれたら失敗するテスト)。配布版なし → `no_distribution`。TTL が 900 秒。
  2. `recordGateAJudgement`: 理由が空 / 空白のみ → `reason_required`。配布版なし → `no_distribution`。2 回入れると 2 行になり、`latestJudgement()` が新しい方を返す。未認証 → `auth`。
  3. `pnpm --filter @3dp/web build` が通る (ModelViewer をバンドルしても SSR で落ちない)。
  4. 手動 (OP-05 後): 本番/開発オリジンで GLB が回る。失敗時の文言が出る。
- **依存**: SP-3DP-04 T-3DP-04-08 (配布版), T-3DP-05-01 (`latestJudgement` の置き場は `gates.ts`)
- **参照**: docs/12 §17.4 (`getViewerUrl` `recordGateAJudgement`), §16.8 行 2, §9.9 (`ModelViewer`), §17.9.2, §17.16 TBD-4, §9.12-2

### T-3DP-05-05 商品詳細 S-3DP-03 (節 1〜4・10)

- **対象ファイル**: `apps/3dp/app/(app)/products/[id]/page.tsx` / `apps/3dp/app/(app)/products/[id]/_components/*.tsx` / `apps/3dp/lib/product-detail-core.ts` (新規) / `apps/3dp/lib/messages.ts` / テスト
- **やること** (§9.8 S-3DP-03 の表): ヘッダー (商品名・種別・状態・価格・**工程バー** = 企画→生成→検査→最適化→プレビュー→原稿→承認→出品作業→公開の現在地。失敗した工程は文言つき)。節: **1 いま止まっている理由 / 次にやること** (進行中は「処理中: 〈工程〉(開始 〈JST〉)」、滞留は「N 時間動いていません」+ 実行状況へのリンク) / **2 企画** (種別・題材・概念・想定価格・依拠性判定: 許可・拒否種別・該当語・判定時刻・禁止語の件数) / **3 生成アセットと版履歴** (版・生成元の provider とモデル・プロンプト (折りたたみ)・三角形・検査結果・作成時刻・**R2 保持状態** (中間版として削除済み — 行は残る)・配布版の印・再生成 n/3 と n/10・**消費 credit と円**) / **4 検査結果** (最新版の全項目: 項目・実測・しきい値・OK/NG。NG は**全部まとめて**。最適化後の再検査。しきい値種別 `PROP`/`ACCESSORY`) + **ModelViewer** (配布版) + **G-A 判定** (「届く / 届かない」+ 理由。判定履歴) / **10 履歴** (この商品の `jobs`: 開始・結果・理由。S-3DP-08 へのリンク)。未到達の節 (5〜9・11) は**節見出しを残し**「まだここまで進んでいません (現在: 〈工程〉)」の 1 行 (空の表・空のプレビュー枠は出さない)。各節は `Suspense` で独立描画。存在しない ID は「商品が見つかりません」+ 一覧へ。
- **受入基準**:
  1. `product-detail-core` の単体: 工程バーが全 11 状態で現在地を示す / 版履歴の credit 合計 = `credits_charged ?? credits_estimated` の和 / `r2_state='purged'` の行に「中間版として削除済み」/ 検査表が `inspect_json` の**全 issues** を行にする (3 件で切らない)。
  2. 判定の入力は理由が空だと送信できない (フォームの検証 + Action の双方)。判定後に G-A 表示が更新される。
  3. 未到達の節が空の表や空の枠を出さない (走査テスト)。運営者向け文言に `Inc-` が含まれない。
  4. 節の 1 つで取得が失敗しても他の節は描画され、失敗した節は「取得できません: 〈理由〉」で見出しが残る。
- **依存**: T-3DP-05-04, SP-3DP-04。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-03-product-detail/prompt.md`)
- **参照**: F-3DP-12〜16, 47 / docs/12 §9.8 S-3DP-03, §9.5, §9.6.3, §9.7

### T-3DP-05-06 実行状況 S-3DP-08 と定期タスクの Action

- **対象ファイル**: `apps/3dp/app/(app)/runs/page.tsx` / `apps/3dp/app/actions/tasks.ts` (`setTaskFlag` / `runTaskNow`) / `apps/3dp/lib/runs-core.ts` / `apps/3dp/components/layout/nav-items.ts` (「実行状況」を有効化) / テスト
- **やること**: **定期タスク表は `TDP_CRON_TASKS` から作り、`jobs` の履歴を左結合**する (履歴 0 件でも 5 行すべて出す = 「一度も実行されていません」が見える唯一の画面)。列: 名称 / スケジュール (JST) / 次回予定 / 最終実行 (JST) / 結果 (**実行中 / 成功 / 一部失敗 / スキップ (フラグ OFF) / 再開待ち / 失敗 / 一度も実行されていません / 準備中**。§17.5.3 の写像) / フラグ。次回予定を `overdue_after_hours` 過ぎても実行が無ければ「予定を過ぎています」。展開で `result_json.reasons[]` を項目単位 (種別・URL・商品) で表示。コードは展開の奥。その下に **滞留** (`generating` / `inspecting` のまま `stall_hours` 以上動かない商品。商品へのリンク) と **実行履歴** (直近 100 件。ピル: すべて / 失敗 / 一部失敗 / 実行中。列: 開始 JST / タスク / 商品 / 所要 / 結果 / 理由。商品の列から S-3DP-03 へ)。
  - `setTaskFlag({task, enabled})`: `tdp_research_enabled` / `tdp_planner_enabled` / `tdp_sales_fetch_enabled` のみ (`toggle_in_runs_screen`)。**公開状態確認はこの Action で変更できない** (`not_toggleable`)。再起動は不要。`runTaskNow({task})`: `manual_run` なもののみ (**`tdp.product.plan` は不可**: credit に流れる)。`jobs` 行 + `addJob` (`jobKey` に JST の分を含め連打を弾く)。
  - `jobs` は **Prisma 経由で読む** (`public.jobs` を生 `pg` で読むと node-pg が JST と解釈し 9 時間前に見える罠)。表示は JST + 「取得時刻」(UR-9)。
- **受入基準**:
  1. `runs-core` の単体 (時刻を注入): 履歴 0 件で 5 行が全て「一度も実行されていません」(`implemented=false` は「準備中」)。`done`+`ok`→成功 / `done`+`partial`→一部失敗 / `done`+`skipped`→スキップ / `done`+`interrupted`→再開待ち / `failed`→失敗 / `running`→実行中。次回予定を過ぎて実行なし → 「予定を過ぎています」。
  2. `setTaskFlag('tdp.listing.status.check', …)` → `not_toggleable`。`runTaskNow('tdp.product.plan')` → `not_runnable`。同じ分の連打で 2 本目が弾かれる。未認証 → `auth`。
  3. UTC `2026-10-15T20:00:00Z` の最終実行が「10/16 05:00 JST」と表示される (9 時間のずれ無し)。
  4. 失敗の理由が項目単位で読める (`reasons` が 3 件ならば 3 行)。
- **依存**: T-3DP-05-01, SP-3DP-03 T-3DP-03-04/-06。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-08-runs/prompt.md`)
- **参照**: F-3DP-46 / docs/12 §9.8 S-3DP-08, §9.6.3, §17.5.1, §17.5.3, §17.4 (`setTaskFlag` `runTaskNow`)

### T-3DP-05-07 商品別原価 `cost.ts` と損益と原価 S-3DP-07 (原価・歩留まり)

- **目的**: G-A の失敗を「生成が悪い」と「検査が厳しい」に切り分ける材料 (F-3DP-47)。**コストは出品前から発生するので、売上が無くてもコストだけは出す** (§9.6.3)。
- **対象ファイル**: `apps/worker/src/tasks/tdp/lib/cost.ts` / `apps/worker/src/tasks/tdp/lib/run-tdp-task.ts` (各タスク末尾で呼ぶフック) / `apps/3dp/app/(app)/profit/page.tsx` / `apps/3dp/lib/profit-core.ts` / `nav-items.ts` / テスト
- **やること**: `cost.ts` — `jobs.tdp_product_id` で結んだ `token_usage` の合計を `tdp_products.cost_jpy_total` に反映 (ANP の `applyNoteArticleCostFromJob` と同型。**失敗は warn のみで本体を止めない**)。企画前の LLM 呼び出し (planner) は商品が無いので商品原価に入らず月次合計にだけ入る。`/profit?view=cost` (既定) と `?view=yield`: **歩留まり 4 指標** — ① 検査通過率 (1 発合格 / 再生成後 / **補正で通過** / 打ち切り: `yieldCategory`) ② NG コード別件数 ③ 1 商品あたり credit と円 (`tdp_generations` + `token_usage`) ④ 依拠性ガードの拒否率。加えて月の credit 消費 vs `meshy_monthly_credit_cap`、機械工程のリードタイム (企画→`ready`。A-8 の実測)。警告は設定のライン (`tdp_yield_warn_pct` 等) を**下回ったときだけ**警告色 + 文言。損益・商品別の view は SP-3DP-11 まで出さない。
- **受入基準**:
  1. `cost.ts` (実 PG): 同じ商品の `token_usage` 3 行 → `cost_jpy_total` が合計と一致。planner の行 (商品なし) は含まれない。DB エラー時に例外を投げない。
  2. `profit-core` の単体: 分母 0 のとき `—` と理由で、**`0%` を出さない** (UR-2)。通過率がラインを割ると警告、超えると警告なし。補正で通過した分が別行で数えられる。
  3. 月の集計は `jstMonthRange` (Prisma の日付範囲) を使い、生 SQL の `AT TIME ZONE` を使わない。
  4. 売上が無いとき「売上はまだありません」を出し、売上 0 円・手取り 0 円を出さない。
- **依存**: SP-3DP-04, T-3DP-05-01
- **参照**: F-3DP-17/47 / docs/12 §9.8 S-3DP-07, §17.12 (商品ごとの原価 `cost.ts`), §15.2 F-3DP-47, §9.6.3

### T-3DP-05-08 ホーム Inc-2 の節 (要対応・判定パネル G-A・資源・定期タスク)

- **対象ファイル**: `apps/3dp/app/(app)/page.tsx` / `apps/3dp/components/home/*.tsx` (`GateRow` `GateStateBadge` `ActionList` `ResourceRow` `CronRow`) / `apps/3dp/lib/home-core.ts` / `apps/3dp/lib/messages.ts` / テスト
- **やること** (§9.8 S-3DP-01 の節 3・5・7・8、§9.10.1-5):
  - **要対応**: 滞留 N / 失敗 N / 定期タスクの異常 N の行 (件数 + 一番古いものの経過 + 遷移先)。0 件は「いま対応が必要なものはありません」の 1 行で**節は残す**。
  - **判定パネル**: 1 ゲート 1 行 (問い / 今の値 / 続行ライン / 判定日 / 残り日数 / 判定 / 一言の理由)。G-A はライブ算出 (T-3DP-05-01)、G-B〜G-E は `未評価` + 「評価が始まる条件」。**4 値のバッジは文言 + 形が違う** (`未評価` は点線・淡色・数値欄 `—`、`ok` は塗り + チェック。UR-6)。総合点を作らない。G-A 行から「判定する」へ (商品詳細)。
  - **資源**: Meshy の月間 credit 消費 vs 上限と残高 (最新の観測 + 取得時刻、失敗は「取得できません: 〈理由〉(最終成功 〈JST〉)」。空欄・`0` にしない)、R2 `3dp/` 使用量 (警告値超で警告)、歩留まり 1 行 (ライン割れのときだけ)。
  - **定期タスク**: 5 本 1 行ずつ (名称 / 最終実行 JST / 結果 / 一度も実行されていません)。詳細は S-3DP-08。
  - 各節は `Suspense` で独立。外部値が遅くても他を止めない。ナビに「リサーチ」「承認」は**まだ出さない** (中身が入る増分で)。
- **受入基準**:
  1. `GateStateBadge` の 4 値が互いに**別の文言と別の形のクラス**を持つ (スナップショットで 4 値が全て異なる)。`unevaluated` のとき数値欄が `—` で、`ok` を出さない。
  2. Meshy 残高 / R2 の取得失敗行があるとき、資源欄に「取得できません」が出て `0` が出ない。
  3. 要対応 0 件のとき 1 行の文言が出て節が消えない。
  4. ヒーローは SP-3DP-02 のまま (出品数を最大の数字にしない)。判定パネルに「予測月商」が無い。
  5. 運営者向け文言に `Inc-` が無い。`space-normal` が無い。
- **依存**: T-3DP-05-01/-04/-06/-07。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-01-home/prompt.md`)
- **参照**: F-3DP-35/36/37/46 / docs/12 §9.8 S-3DP-01, §9.1 UR-1/2/6, §9.9, §9.10.1

### T-3DP-05-09 設定「生成」タブと Meshy 接続テスト

- **対象ファイル**: `apps/3dp/app/(app)/settings/_tabs/generation.tsx` / `apps/3dp/app/actions/meshy.ts` (`testMeshyConnection`) / `apps/3dp/lib/settings-groups-core.ts` (generation グループに Meshy 系を追加) / テスト
- **やること**: 生成タブ (§9.8 S-3DP-06): **接続テスト**ボタン (`testMeshyConnection`: `resolveMeshyCredentials()` → credit を消費しない `GET /openapi/v1/balance`。`200` →「接続できました」+ 残高 (取れなければ成功のみ) / `401`・`403` →「キーが違います」/ それ以外 →「原因不明 (HTTP 〇〇)」。`tdp_resource_snapshots` に記録。**キーは常にマスク。登録・変更はポータル API 管理**へのリンク) / 既定モデル (`tdp_meshy_model`。**`latest` を選べない**。null の間は「生成を始めません」と明示) / 円 per credit (`tdp_meshy_usd_per_credit` × 為替の導出値を読み取り専用で) / クレジット表 / ポーリング間隔・上限 (**未実測の間は「暫定」と表示**。上限は 90 分以下) / 再生成上限・警告ライン / R2 の保持方針と使用量 / 注意書き「Meshy の Web UI を使うとキュー枠を食う」/ しきい値の出典と確認日 (`THRESHOLD_SOURCES`)。
- **受入基準**:
  1. 接続テストの写像 (fetch 注入): 200 / 401 / 403 / 500 / ネットワーク断 / キー未設定 (fetch 0 回) がそれぞれ日本語の 3 区分 + 未設定。文面にキーが含まれない。
  2. `tdp_meshy_model='latest'` と `meshy_poll_max_minutes=91` が `ok:false` で拒否される。null は許容 (null = 生成しない)。
  3. 残高の取得失敗が「取得できません: 〈理由〉」で、接続テスト自体は押せる。
  4. グループ単位の「確認した」が Meshy 系の値を含めて動く (`proposalState`)。
- **依存**: SP-3DP-03 T-3DP-03-03, SP-3DP-02 T-3DP-02-07/-08
- **参照**: F-3DP-11/16/38/49 / docs/12 §9.8 S-3DP-06 (生成タブ・接続テスト), §16.4.1, §16.4.4, §17.4 (`testMeshyConnection`)

### T-3DP-05-10 E2E: 試作登録・商品詳細・G-A 判定・実行状況

- **対象ファイル**: `tests/e2e/3dp/trial.spec.ts` / `tests/e2e/3dp/product-detail.spec.ts` / `tests/e2e/3dp/runs.spec.ts` / `tests/e2e/3dp/fixtures/seed-product.ts`
- **シナリオ** (DB に商品・アセット・検査結果を直接用意。Meshy には接続しない):
  1. **試作登録**: 「◯◯風の角」→ 却下として記録・理由が日本語で出る・一覧に `rejected` の行。許可の入力 → credit の見積りが出る →「生成を開始」で詳細へ。Meshy キー未設定の環境ではボタンが**無効 + 理由**。
  2. **商品詳細**: 版履歴・検査の全 NG・再生成 n/3・消費 credit/円・ModelViewer の領域が出る。G-A: 理由が空だと送れない → 入力で判定が保存され、ホームの G-A 行が `ok` / `fail` に変わる。
  3. **実行状況**: 履歴 0 件で 5 行が出て、`tdp.product.plan` 以外が「一度も実行されていません」、未実装は「準備中」。公開状態確認のフラグ切替が無い。
  4. **空状態のホーム**: G-A が `未評価`・`ok` が出ない・「0 円」が出ない・Meshy 残高が `0` でなく「取得できません」か未取得の文言。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑、`pnpm typecheck:e2e` 緑。ModelViewer の GLB 取得は `page.route` で署名付き URL をスタブし、失敗時の文言も 1 本で確認。
- **依存**: T-3DP-05-03/-05/-06/-08/-09, SP-3DP-02 T-3DP-02-11
- **参照**: docs/12 §17.13 (Playwright「空状態」)、§9.6.3

### T-3DP-05-11 実キーでの初回実行と実測 (P-0)  ⛔ 運営者待ち

- **目的**: 台帳経由で実キーを使い、**U-13 / U-14 / U-17 / U-24 / U-25 / U-26 / U-29 / U-30 / U-31 の実測記録を残して P-0 (G-A の正式判定) を出す**。測らずに数字を確定しない。
- **着手条件 (機械的に確認する。1 つでも欠けたら実行しない)**:
  1. CI で緑: SP-3DP-03 T-3DP-03-02 / -07 / -08 / -09 / -10 と SP-3DP-04 T-3DP-04-10 (パイプライン A〜D)。完了報告に CI の実行 URL / 日時を書く。
  2. OP-01 (ポータルの API 管理に Meshy キー)・OP-05 (R2 CORS)・OP-18 (migration → コードの順で本番適用済み・worker デプロイ済み)。
  3. `tdp_meshy_model` が SP-3DP-01 の結論で設定済み。`meshy_monthly_credit_cap` 900 / `credit_cap_per_product` 250 を確認 (設定画面で「確認済」)。
- **対象ファイル**: `scripts/3dp/ledger-report.ts` (読み取り専用の台帳レポート) / `apps/worker/src/tasks/tdp/__fixtures__/meshy/` (合成 → 実応答に差し替え。キー・署名付き URL を除く) / `docs/12-3dp-design.md` (§11 / §12) / 設定値 (`meshy_poll_interval_sec` / `meshy_poll_max_minutes`)
- **やること**:
  - **運営者**: 設定画面から試作を登録し (アクセサリを中心に、少なくとも **preview ≥ 10 回・refine ≥ 6 回**を目標。時間帯を 2 つ以上)、商品詳細で GLB を回して G-A の判定を入力 (OP-03)。生成中に Meshy の Web UI を使わない (キュー枠を食う)。
  - **`ledger-report.ts`** (DB を読むだけ): ① `submitted_at → finished_at` の p50 / p95 / max (stage 別) ② `progress` の推移 ③ FAILED / CANCELED の率と `task_error` ④ 429 の種別 ⑤ 検査通過率 (1 発 / 再生成後 / 補正 / 打ち切り) と NG コード別 ⑥ 台帳の credit 合計と `tdp_resource_snapshots` の残高の減りの差 (**10% 超なら警告**: §17.6.4) ⑦ **重複検査**: `purpose_key` 重複 0、`lost` の件数、`token_usage` の `provider='meshy'` 行数 = `meshy_task_id` を持つ台帳行数 ⑧ preview の GLB の UV の有無 (U-29)。
  - 確定させる値: ポーリング間隔 = `max(5 秒, p50 ÷ 20)`、上限 = `p99 × 1.5`、切れたら**同じ task_id で再開** (§16.4.3 の決め方)。A-8 (1 商品 2 時間以内) は実測合計が超えるなら**数字を実測に合わせる** (逆はしない)。
  - U-24: 一覧 API の有無 / `lost` を回収できるか。U-26: FAILED の credit の返却と課金タイミング (残高の前後比較)。U-30: Railway の SIGTERM → SIGKILL の猶予とデプロイ中の並走 (デプロイログ)。U-31: 承認画面相当 (商品詳細) から GLB を読める最小の CORS (Range / ETag の要否)。U-25: 任意の本番確認 (§3)。
- **受入基準**:
  1. `ledger-report.ts` が実行でき、上記 ①〜⑧ を出力する (単体テストはフィクスチャの台帳で各集計が期待値と一致)。
  2. docs/12 §11 の U-13/14/17/24/25/26/29/30/31 の各行が「実測値 / 実施日 / 結論」か**「未確認のまま (理由)」**で埋まっている (空欄 0)。
  3. `purpose_key` の重複が 0。`lost` の件数と、各 `lost` の原価扱い (`credit_confidence='unknown'`) が記録されている。
  4. 台帳の credit 合計と Meshy 残高の減りの差が記録されている (10% 超なら原因の仮説も)。
  5. **P-0 の判定**: `recordGateAJudgement` が入力済みで、ホームの G-A 行が `ok` か `fail` (`未評価` でない)。結果を **A (続行) / B (軸足移動) / C (縮退・撤退協議)** で dev-plan に記録 (SP-3DP-01 の §6 と同じ基準で再判定)。
  6. フィクスチャの実応答化: 合成ファイルを実応答 (キー・URL 除去) に置き換え、ファイル名・先頭コメントから「合成」を外す。
- **依存**: 上記着手条件、T-3DP-05-01〜-10、OP-01/03/05/06/18
- **参照**: docs/12 §16.4.3, §17.6.4, §17.17-4, §11 U-13/14/17/24/25/26/29/30/31, §14.5.2 G-A

### T-3DP-05-12 設計書の追従と Inc-2 完了の記録

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/10-platform-portal.md` / `docs/03-tech-selection.md` / `docs/dev-plan.md` (§11)
- **やること**: ① docs/12 §15.1 の F-3DP-13〜17・46〜49 の状態を「実装済」に (Inc-2 で実装した範囲のみ。未実装の部分は書かない) ② §12 に Inc-2 の実装状況 ③ §11 の U 行 (T-3DP-05-11 の結果) ④ **docs/10 §10.4b の対象サービス一覧に Meshy を追加** ⑤ docs/03 §4/§5 を実装と照合 (`three` は SP-3DP-08、`@google/model-viewer` と `MESHY_API_KEY` は既記載のため追記不要なら「確認済」) ⑥ dev-plan §11 の Inc-2 を「完了 / P-0 = A|B|C」に。
- **受入基準**: grep で ① F-3DP-13 の行が「未」でない ② docs/10 §10.4b に `meshy` ③ dev-plan §11 に P-0 の結果が A/B/C のいずれかで書かれている。コードは触らない。
- **依存**: T-3DP-05-11
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: cron-registry / gates (G-A) / trial-core / product-reason-core / product-detail-core / runs-core / profit-core / settings-groups-core / ledger-report の集計。
- **Vitest (実 PG)**: `cost.ts` / gates-snapshot の観測 / `recordGateAJudgement`。
- **Playwright**: `tests/e2e/3dp/` に 3 本 + 空状態。
- **手動 (自動化しない)**: ModelViewer で GLB が回ること (OP-05 後)、実キーでの初回実行 (T-3DP-05-11)。

## 7. 完了判定

- T-3DP-05-01〜12 が `/iterate` で APPROVED + PASS。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` / `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑。
- **Inc-2 の完了条件 (§10)**: アクセサリ 1 点を生成し、`ACCESSORY_THRESHOLDS` の検査を通し、配布用 GLB を R2 に置ける — を**実キーで**確認し、運営者が G-A を判定した (= P-0)。
- **Inc-2 の完了条件に含まれる実測記録 (§17.17-4)**: U-13/14/17/24/25/26/29 (+30/31) が docs/12 に記録されている。
- 分岐: P-0 が **A** → SP-3DP-06 (Inc-3) へ。**B** → SP-3DP-07 (テクスチャ経路) を SP-3DP-06 の前に (pm 再起動で再編)。**C** → 縮退・撤退の協議 (§14.5.3)。
- 申し送り: 確定したポーリング値・歩留まり実績 (U-14) を SP-3DP-06 の企画 (credit 見積り) に渡す。本番の worker デプロイ状況を dev-plan に記録。
