# SP-3DP-09 inc4b-approval-gate — 承認画面 (外せない人間のゲート) と稼働の実測 (Inc-4 後半)

> 3DP 系列。全体計画は `docs/dev-plan.md` §11。設計の正本は `docs/12-3dp-design.md`。状態凡例: ⬜ 未着手 / 🔶 着手中 / ✅ 完了 / ⛔ 運営者待ち
> **前提: SP-3DP-08 完了 (U-15 が合格 or 逃げ道が決定済み、`ready → review` が実際に起きる)。**

## 1. 目的

**承認画面 (S-3DP-04) を作る。** 運営者が**見ずに押せない**よう、プレビュー 6 枚・GLB の対話ビューア・検査・依拠性・想定手取り・原稿・出品の前提を **1 画面に並べる** (UR-5)。
承認なしでは `listed` に進めない (DB の CHECK と `transitionProduct` が構造として担保)。**自動パス設定は作らない。**
併せて、承認時刻を記録して G-E (運営者の稼働) の測定を始め (F-3DP-43)、標準文面の運営者承認を取り込む (TBD-3 = Inc-4 のブロッカー)。

## 2. 対応機能 ID

F-3DP-28 (承認画面), F-3DP-43 (稼働の実測: 承認区間), F-3DP-50 (媒体定義の表示), F-3DP-25/26/27 (承認画面での表示), F-3DP-20 (想定手取り), F-3DP-01 (承認時の再判定), F-3DP-42 (出品の前提の表示)
対応画面: S-3DP-04 (新規), S-3DP-03 (節 5・6), S-3DP-01 (承認待ち・稼働), S-3DP-06 (媒体タブ)

## 3. 運営者の手が要るもの (このスプリント)

| ID | 内容 | いつ | 未対応のときの挙動 |
|---|---|---|---|
| **OP-09** | **標準文面の承認**: ① ライセンス・再配布条件 ② AI 開示 (使用したプロバイダ名を含む)。案は `STANDARD_TEXTS` (`proposed`、SP-3DP-08 T-3DP-08-02)。法務的な文面なので設計は案までしか持たない。**Inc-4 のブロッカー**(完了条件ではなく、初回出品のブロッカー) | T-3DP-09-09 の前 | 承認画面で承認はできるが、**出品は `hold_media_incomplete` で保留**される (SP-3DP-10)。初回出品 (SP-3DP-12) の前に必須 |
| **OP-08** | **U-12: 3DP に割ける月間作業時間** (既定 240 分 = 月 4 時間は当方の提案値で未承認) の承認/変更と、判定値グループの「確認した」 | G-E が効き始める前 (SP-3DP-11 まで) | 提案値のまま動く |
| OP-03 | 承認画面を実際に使って **15 分 / 商品**で回るかの確認 (G-E の起点) | T-3DP-09-10 の後 | — |
| OP-17 | **S-3DP-04 のワイヤーフレーム PNG** (`docs/wireframes/S-3DP-04-review/prompt.md`)。designer の優先順位 1 位。画面実装前に生成して参照するのが望ましい | T-3DP-09-05 の着手前 | `prompt.md` と §9.8 から実装 |
| OP-18 | 本番 DB の migration (SP-3DP-08 T-3DP-08-01) 適用とデプロイ | T-3DP-09-10 (E2E は CI だが実環境確認) | — |

## 4. タスク一覧

| ID | 状態 | タスク | 概要 | 対応機能 | 工数 |
|---|---|---|---|---|---|
| T-3DP-09-01 | ⬜ | 承認条件の評価 `evaluateApproval` | 5 つのデータ条件を**全部まとめて**返す純関数 | F-3DP-28 | M |
| T-3DP-09-02 | ⬜ | 承認の Action (`openReview` / `approveProduct` / `rejectReview`) | DB から再評価・遷移・履歴・差戻し 3 種 | F-3DP-28, 43 | L |
| T-3DP-09-03 | ⬜ | 稼働の実測 (承認区間) | 作業分の純関数と月次集計 | F-3DP-43 | S |
| T-3DP-09-04 | ⬜ | 承認の待ち行列とナビのバッジ | `/review`・次の商品・空状態 | F-3DP-28 | M |
| T-3DP-09-05 | ⬜ | 承認画面 `/review/[id]` | 1 画面に全部・承認フッター・理由の箇条書き | F-3DP-28, 25〜27, 20, 42 | L |
| T-3DP-09-06 | ⬜ | 商品詳細の節 5・6 (プレビュー・原稿) | 再描画・原稿の検査表 | F-3DP-25〜27 | M |
| T-3DP-09-07 | ⬜ | ホーム Inc-4 の節 (承認待ち・稼働) | 要対応の行・稼働 X/Y 分・G-E 行 | F-3DP-35, 36, 43 | M |
| T-3DP-09-08 | ⬜ | 設定「媒体」タブ (読み取り) | 媒体定義の 5 項目・欠けの列挙・標準文面の状態 | F-3DP-50, 27 | M |
| T-3DP-09-09 | ⛔ | 標準文面の承認の反映 | `proposed → approved` と文面のハッシュ | F-3DP-27, TBD-3 | S |
| T-3DP-09-10 | ⬜ | E2E: 承認 (最優先) | 承認不可→可・差戻し 3 種・空状態・ビューア失敗 | F-3DP-28 | L |
| T-3DP-09-11 | ⬜ | 設計書の追従と Inc-4 完了の記録 | docs/12・dev-plan | (Rule #7/#8) | S |

合計 **11 タスク**。

---

## 5. タスク詳細

### T-3DP-09-01 承認条件の評価 `evaluateApproval`

- **目的**: 承認ボタンの有効条件を**画面の操作に依存させず**(ビューアを回さないと押せない、等はしない: §9.13-3)、データ条件だけにする。満たさないとき**全部の理由**を返す。
- **対象ファイル**: `packages/contracts/src/tdp/approval-check.ts` / `packages/contracts/package.json` / テスト
- **やること**: 入力 = 商品・配布版・プレビュー行・最新の原稿(媒体別)・媒体定義・設定・禁止語。条件 ① プレビュー 6/6 (`scale_reference` を含む)・`selfcheck_json.passed` が全部真・`asset_version` が現在の配布版 ② 配布版の `inspect_ok` が真 ③ **依拠性ガードを今の禁止語で再実行**して `allowed` (title・concept・生成プロンプト・全媒体の原稿) — 保存済みの判定と食い違えば警告 ④ 全対象媒体で最新原稿が `passed` ⑤ 価格 ≥ `tdp_min_price_jpy` かつ媒体定義の 5 項目が揃っている。戻り値 `{ok, reasons: TdpReason[], warnings}`。`reasons` の `code` は `previews_incomplete` / `inspect_ng` / `derivative_rejected` / `manuscript_failed` / `price_below_min` / `media_incomplete` / `not_in_review`、各 `item` に画面のブロック (①〜⑦) を持たせる。**標準文面が `proposed` は承認を妨げない**(`warnings` に `standard_text_unapproved` = 出品が保留される旨)。U-9/U-10 未回答も同様に警告のみ。
- **受入基準**: 5 条件それぞれを 1 つずつ崩すと該当 `code` だけが出る / 全部崩すと**全 code が一度に**返る / `scale_reference` 欠落・古い `asset_version` のプレビュー・`selfcheck.passed=false` が `previews_incomplete` / 価格 = 下限で通り下限 −1 で `price_below_min` / 禁止語を後から登録した結果、保存済み判定は許可でも `derivative_rejected` / 標準文面 `proposed` と U-9/U-10 未回答が `ok:true` のまま `warnings` に出る / 判定に数値リテラルが無い。
- **依存**: SP-3DP-08 完了
- **参照**: F-3DP-28 / docs/12 §9.8 S-3DP-04 (有効条件), §17.4 `approveProduct`, §9.13-3

### T-3DP-09-02 承認の Action (`openReview` / `approveProduct` / `rejectReview`)

- **対象ファイル**: `apps/3dp/app/actions/review.ts` / `apps/3dp/lib/review-core.ts` / テスト (単体 + 実 PG)
- **やること**: §17.4 のとおり。全 Action は `auth()` → zod → ドメイン関数 → `revalidatePath` (C-8)。
  - `openReview({product_id})`: `review` の商品で `review_opened_at` が null なら now を書く (冪等。G-E の起点)。
  - `approveProduct({product_id})`: **データ条件を DB から再評価** (画面の状態を信用しない) = `evaluateApproval`。通れば `transitionProduct(review→approved)` (T-11) で `approved_at` / `approved_by` (セッションの email) / `approved_asset_version` を**同時に**書く。`TdpReviewEvent(kind='approve', round)` を同一トランザクション。`tdp.package.build` は `enqueueIfRegistered` で投入 (SP-3DP-10 で実体)。不許可は理由を**全部まとめて**返す (`ok:false` + `code` の配列)。
  - `rejectReview({product_id, to: 'regenerate'|'rewrite'|'discard', reason})`: 理由は空・空白のみ不可 (`reject_reason_min_chars` を設定から)。`regenerate` = `review→generating` (T-12): `lineage_no` +1・理由を `feedback` に・**企画の累計 10 回に数える**・`tdp.asset.generate` (`reason:'regen_rejected'`)。`rewrite` = `review→ready` (T-13): `tdp.listing.compose` を理由つきで再投入 (配布版は不変)。`discard` = `review→rejected` (T-14)。`TdpReviewEvent` を書く。二重クリックは CAS で 1 回。
- **受入基準 (実 PG)**:
  1. 条件を満たさない商品の `approveProduct` が `ok:false` で**全理由**を返し、`approved_at` は書かれない。
  2. 満たす商品で `approved` になり、`approved_at` / `approved_by` / `approved_asset_version` と `TdpReviewEvent` が 1 行ずつ。**2 回呼んでも 1 回だけ**。
  3. **承認 API を経由せずに `listed` に遷移する経路が無い** (SP-3DP-03 T-3DP-03-10 の静的テストが緑のまま。`app_settings` に自動承認の列を足していない)。
  4. `rejectReview`: 理由 `''` / `'   '` が `reason_required`。3 種それぞれの遷移先・`lineage_no`・投入タスクが正しい。`regenerate` が企画の累計上限に数えられ、上限到達時は `failed` になる前に**警告を返せる**(残り回数を返す関数)。
  5. `review` 以外の商品への各 Action が `not_in_review`。未認証は `auth`。
- **依存**: T-3DP-09-01, SP-3DP-08 T-3DP-08-01, SP-3DP-03 T-3DP-03-05
- **参照**: F-3DP-28/43 / docs/12 §17.4, §17.3 (T-11〜T-14), §9.8 S-3DP-04 (操作と結果)

### T-3DP-09-03 稼働の実測 (承認区間)

- **対象ファイル**: `packages/contracts/src/tdp/gates.ts` (追記: `workMinutes` / `monthWorkSummary`) / テスト
- **やること**: 1 商品の作業分 = `min(approved_at − review_opened_at, work_cap_review_min)` + `min(published_recorded_at − zip_first_downloaded_at, work_cap_publish_min)`。**公開区間の列は Inc-5 (`zip_first_downloaded_at` は SP-3DP-10)** なので、今は承認区間のみ計算し公開区間は `null` (計測不能)。`review_opened_at` か `approved_at` が null の商品は**ペアに数えない**(未評価側に倒す)。**壁時計の「承認 → 公開記録」は作業時間ではない**(使わない)。`monthWorkSummary` — 当月 (JST。`approved_at` の JST 月) の作業分合計・1 商品平均・15 分超の件数・**上限で頭打ちにした件数** (黙って切らない)。
- **受入基準**: 上限 (30 分) で頭打ちになり件数が数えられる / null の商品は「計測不能 N 件」として別枠 / JST 月境界 (`2026-09-30T15:00:00Z` は 10 月) / 判定にリテラルが無い (上限は引数)。
- **依存**: SP-3DP-05 T-3DP-05-01 (`gates.ts`)
- **参照**: F-3DP-43 / docs/12 §17.10.1 (G-E の測り方), §9.12-6

### T-3DP-09-04 承認の待ち行列とナビのバッジ

- **対象ファイル**: `apps/3dp/app/(app)/review/page.tsx` / `apps/3dp/lib/review-queue-core.ts` / `apps/3dp/components/layout/nav-items.ts` / `sidebar-nav.tsx` (バッジ) / テスト
- **やること**: `/review` は最も古い `review` の 1 件を開く (`redirect`)。**承認待ち 0 件**は §9.6.3 の空状態 =「承認待ちはありません」+ **直近に承認 / 差戻しした 3 件** + 「生成中・検査中は N 件」(承認ボタンは出さない)。承認 / 差戻し後は「次の商品」へ連続処理でき、**行列が空になったら一覧ではなく**「承認待ちはありません」。ナビの「承認」を有効化し、承認待ち件数のバッジ (0 のときは出さない)。
- **受入基準**: `nextInQueue` が古い順で、現在の商品を除く / 空状態に承認ボタンが無い / バッジが 0 で非表示・1 以上で件数 / 直近 3 件が承認・差戻しの `TdpReviewEvent` から。
- **依存**: T-3DP-09-02
- **参照**: F-3DP-28 / docs/12 §9.8 S-3DP-04, §9.3 (遷移の規則 ②), §9.6.3

### T-3DP-09-05 承認画面 `/review/[id]`

- **目的**: **見ずに押せない 1 画面。**
- **対象ファイル**: `apps/3dp/app/(app)/review/[id]/page.tsx` / `apps/3dp/app/(app)/review/[id]/_components/*.tsx` / `apps/3dp/lib/review-view-core.ts` / `apps/3dp/lib/messages.ts` / テスト
- **やること** (§9.8 S-3DP-04): 1 ページに縦に: ① プレビュー 6 枚 (拡大可。自己検査が失敗した枚は枠に理由) ② GLB を回す領域 (`ModelViewer`。失敗時は理由 +「固定プレビューのみで判断することになります」を明示し、**承認は妨げない**) ③ 検査結果 (全項目・実測・しきい値・最適化後の再検査) ④ 依拠性判定(判定対象の文字列ごと。**表示時に決定論ガードを再実行**し、保存済みと食い違えば警告) ⑤ 想定手取り (媒体ごとに販売価格 → 手数料 → 手取り。`computeNet`。端数は切り捨て) ⑥ 商品ページ原稿 (媒体タブ。開示節・必須 6 項目・禁止語・数値不一致の理由) ⑦ 出品の前提 (「承認すると N+1 / 上限 M」・停止中か・共用アカウントの 1 行注記・U-9/U-10 の回答状況。未回答 / 標準文面が案のときは「**承認はできますが、出品は保留されます**」)。**折りたたまない・タブにしない**(広い画面では ①② を左の主列、③〜⑦ を右の補助列)。
  - **承認フッター (画面下に固定)**: 要約 1 行「プレビュー 6/6・検査 NG 0・依拠性 OK・手取り ¥427」+ 「承認」「差し戻す…」。満たさない条件があるとき、ボタンを灰色にするだけにせず**「承認できない理由」を箇条書き**で出す(どのブロックの何か、クリックでそのブロックへ移動)。「差し戻す…」のダイアログ: 差戻し先 (必須 3 択)・理由 (空不可)。再生成は企画の累計 10 回に数える旨と残り回数を表示。
  - 画面を開いたとき `openReview` を呼ぶ。承認後は「次: 出品作業へ (目安 15 分)」と待ち行列の「次の商品」。
  - 自動承認のスイッチを**置かない**。
- **受入基準**: `review-view-core` の単体 — ① フッターの理由の箇条書きが `evaluateApproval` の `reasons` と 1 対 1 でブロックの anchor つき ② 要約行の書式 ③ **承認ボタンの有効/無効が `evaluateApproval.ok` のみで決まり、ビューアの操作状態に依存しない** ④ 想定手取りが `computeNet` と一致 (¥500 → ¥427) ⑤ U-9/U-10 未回答 / 標準文面 `proposed` で「承認はできますが、出品は保留されます」 ⑥ 依拠性の再実行結果が保存済みと食い違うと警告 ⑦ 文言に `Inc-` が無く、自動承認・一括操作・進捗バーの部品が無い。`pnpm --filter @3dp/web build` 緑。
- **依存**: T-3DP-09-01/-02/-03/-04, SP-3DP-05 T-3DP-05-04 (`ModelViewer`)。OP-17 (PNG) があれば参照 (`docs/wireframes/S-3DP-04-review/prompt.md`)
- **参照**: F-3DP-28 / docs/12 §9.8 S-3DP-04, §9.1 UR-5/6, §9.13-3, §16.8 行 2

### T-3DP-09-06 商品詳細の節 5・6 (プレビュー・原稿)

- **対象ファイル**: `apps/3dp/app/(app)/products/[id]/_components/preview-section.tsx` / `manuscript-section.tsx` / `apps/3dp/lib/product-detail-core.ts` (追記) / テスト
- **やること** (§9.8 S-3DP-03 の節 5・6): プレビュー 6 枚 + **自己検査の結果 (通過 / 失敗の理由を人間可読で)**・`scale_reference` が無いと「寸法参照が無いため承認待ちに進めません」・「再描画」ボタン (`rerenderPreview`。進行中は無効) / 商品ページ原稿: 媒体ごとのタブ (商品名・紹介文・タグ・価格) と**検査表** (禁止語 0 件か・必須 6 項目・数値が `inspect_json` と一致か・開示が `targets` 全箇所か。不合格は差戻し理由を表示)。履歴の節(10)に承認・差戻しの記録を足す。
- **受入基準**: 検査表の各行が `checks_json` から決まる / 白画像失敗の枠に理由と再描画 / 進行中の再描画ボタンが無効 / 未到達の節が 1 行の文言のまま。
- **依存**: SP-3DP-08 T-3DP-08-08, T-3DP-09-02
- **参照**: F-3DP-25〜27 / docs/12 §9.8 S-3DP-03 (節 5・6), §9.7 台帳 #8

### T-3DP-09-07 ホーム Inc-4 の節 (承認待ち・稼働)

- **対象ファイル**: `apps/3dp/app/(app)/page.tsx` / `apps/3dp/components/home/*.tsx` (`WorkloadStat`) / `apps/3dp/lib/home-core.ts` / テスト
- **やること**: **要対応**に「承認待ち N (一番古いものの経過)」→ `/review`。**今月の枠と稼働**に ② 当月の運営者作業 X 分 / 上限 Y 分 (1 商品平均・15 分超の商品数・頭打ちにした件数)。超過時は「R-1 を下げる」のテキストリンクのみ (**増やす導線を出さない**)。判定パネルの **G-E 行**を実体化(承認〜公開記録のペアが 0 件 → `未評価`。公開区間が Inc-5 なので当面は `未評価` が正)。
- **受入基準**: 承認待ち 0 件で「いま対応が必要なものはありません」が残る / 稼働が上限超過で「R-1 を下げる」のみが出て「増やす」系の文言が無い (走査テスト) / 計測不能の商品が別枠で数えられ 0 分として混ざらない。
- **依存**: T-3DP-09-03/-04, SP-3DP-05 T-3DP-05-08
- **参照**: F-3DP-35/36/43 / docs/12 §9.8 S-3DP-01 (節 3・6), §9.1 UR-1

### T-3DP-09-08 設定「媒体」タブ (読み取り)

- **対象ファイル**: `apps/3dp/app/(app)/settings/_tabs/media.tsx` / `apps/3dp/lib/messages.ts` / テスト
- **やること**: 媒体定義 (BOOTH / Jinxxy) を表で: 手数料モデル・AI 開示 (義務性と `targets`)・出品枠(安全装置タブへのリンク)・自動化可否・判定算入。**欠けた項目は「出品不可」と赤字(+文言)で列挙** (`missingMediaFields`)。標準文面の状態 (`proposed` / `approved`・承認日) と文面の表示。媒体定義はコード側の定数なので**画面から編集しない**(読み取り専用であることを明記)。Jinxxy の算入切替は SP-3DP-11。
- **受入基準**: 欠けた項目が列挙される / 標準文面 `proposed` のとき「出品は保留されます」/ 編集フォームが無い / 運営者向け文言に `Inc-` が無い。
- **依存**: SP-3DP-08 T-3DP-08-02
- **参照**: F-3DP-50/27 / docs/12 §9.8 S-3DP-06 (媒体タブ), §15.2 F-3DP-50

### T-3DP-09-09 標準文面の承認の反映  ⛔ OP-09 待ち

- **対象ファイル**: `packages/contracts/src/tdp/media.ts` / テスト / `docs/12-3dp-design.md` (§17.16 TBD-3)
- **やること**: 運営者が承認した (または修正した) 文面で `STANDARD_TEXTS` を更新し `status:'approved'`・`approved_on` (YYYY-MM-DD)・`approved_by`・**文面の sha256** を持たせる。**文面を後から変えたのにハッシュを更新しなければ `status` を `changed` として未承認扱い**にする (承認後の無言の書換えを防ぐ)。`missingMediaFields` が承認済みで `standard_text_unapproved` を返さなくなる。
- **受入基準**: ① 承認済み + ハッシュ一致 → `standard_text_unapproved` なし ② 文面を 1 文字変えてハッシュ据え置き → `changed` で未承認扱い ③ BOOTH の開示文が「規約上の義務」と書いていない (運営者の方針の表現) ④ Jinxxy の開示文が説明文・メタデータの両方に入る ⑤ docs/12 TBD-3 に承認日。
- **依存**: OP-09, T-3DP-09-08
- **参照**: docs/12 §17.16 TBD-3, §15.2 F-3DP-27, §2.1 R-3

### T-3DP-09-10 E2E: 承認 (最優先)

- **対象ファイル**: `tests/e2e/3dp/review.spec.ts` / `tests/e2e/3dp/fixtures/seed-review-product.ts`
- **シナリオ** (§17.13): ① **承認不可 → 可**: 条件を 1 つ崩した商品でフッターに理由の箇条書き(ブロックへ移動できる)が出て承認できない → 直すと承認でき、DB の `status='approved'`・`approved_at` が入る ② **差戻し 3 種**: 理由が空だと送れない / 再生成 → `generating`・`lineage_no` +1 / 原稿やり直し → `ready` / 却下 → `rejected` ③ **待ち 0 件の空状態** (承認ボタンが無い・直近 3 件) ④ **ビューアの取得失敗でも承認はブロックされず**「固定プレビューのみで判断することになります」が出る ⑤ 自動承認のスイッチ・一括操作・進捗バーが**存在しない** ⑥ U-9/U-10 未回答の注記 ⑦ 承認後に「次の商品」へ。
- **受入基準**: `E2E_TARGET=3dp pnpm exec playwright test --project=3dp` 緑、`pnpm typecheck:e2e` 緑。画像・GLB の取得は `page.route` でスタブ。
- **依存**: T-3DP-09-05/-06/-07
- **参照**: docs/12 §17.13 (Playwright 承認), §9.8 S-3DP-04

### T-3DP-09-11 設計書の追従と Inc-4 完了の記録

- **対象ファイル**: `docs/12-3dp-design.md` / `docs/dev-plan.md`
- **やること**: F-3DP-25〜28・43・50 の状態を実装範囲だけ更新 (F-3DP-43 は承認区間のみ。公開区間は Inc-5 と明記)。§12 に Inc-4 の実装状況。dev-plan §11 の Inc-4 を「完了」に (OP-09 が済んでいなければ「標準文面の承認待ち」と**書く**)。
- **受入基準**: grep で F-3DP-28 が「未」でない / F-3DP-43 の注記 / OP-09 の状態が dev-plan にある。コードは触らない。
- **依存**: T-3DP-09-10
- **参照**: CLAUDE.md Hard Rule #7/#8

---

## 6. テスト計画

- **Vitest (単体)**: `evaluateApproval` (5 条件 × 崩し方) / 稼働の純関数 / `review-view-core` / queue。
- **Vitest (実 PG)**: 承認・差戻しの遷移と履歴・二重クリック・自動承認経路の不在。
- **Playwright**: 承認を最優先 (上記 7 シナリオ)。
- **手動**: 承認画面の実運用感 (OP-03)。

## 7. 完了判定

- T-3DP-09-01〜11 が APPROVED + PASS (T-3DP-09-09 は OP-09 待ち ⛔)。`pnpm typecheck` / `pnpm test:unit` / `pnpm test:integration` / E2E 緑。
- **Inc-4 の完了条件 (§10)**: 承認画面で可否を押せる(実商品で 1 件)。承認時刻が記録され G-E の測定が始まっている。
- **OP-09 が済んでいない場合は「Inc-4 完了 (標準文面の承認待ち)」と書き、初回出品 (SP-3DP-12) のブロッカーとして dev-plan に残す。**
- 申し送り: SP-3DP-10 は `approved` の商品に対し ZIP を作る (`tdp.package.build` は `enqueueIfRegistered` で自動的に有効になる)。`computeSlots` の `reservations` は SP-3DP-10 で差し替える。
