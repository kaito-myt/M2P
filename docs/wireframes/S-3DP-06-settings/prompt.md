# S-3DP-06 設定 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-3DP-06
- 画面名: 設定 (`/settings?tab=`) — 優先範囲は「安全装置」タブ、とくに**停止の解除**
- 対応機能 ID: F-3DP-02, 08, 34, 38, 40, 41, 42 (安全装置タブ)
- 元設計書: `docs/12-3dp-design.md` §9.8 S-3DP-06 (安全装置タブの詳細 / 停止の解除) / §9.10.3 / UR-4, UR-7
- 想定画像:
  - `desktop.png` — 安全装置タブ・通常状態 (停止していない)。提案値バッジ付き
  - `limit-rejected.png` — R-1 に 13 を入れて**サーバーに拒否された**状態
  - `release-collapsed.png` — **停止中**。停止の解除が**畳まれている**状態
  - `release-expanded.png` — **停止の解除が展開**された状態 (理由入力必須)
  - `mobile.png` — モバイル 1 カラム

## ChatGPT 使い方
1. ChatGPT (GPT-4o / 画像生成有効) を開く
2. 下記「共通プロンプト」と任意の「{バリアント} プロンプト」を結合してコピー
3. ChatGPT に貼り付けて画像生成
4. 出力 PNG を本ディレクトリに上記ファイル名で保存
5. 縦に長い画面は「縦長可」と指示済み。切れる場合は上半分 / 下半分の 2 枚に分けてよい

---

## 共通プロンプト（全画像で先頭に置く）

```
You are a senior UX designer creating a low-fidelity wireframe for a Japanese web application called "3DP" (3D product development and sales tool for BOOTH; single-operator use; part of the "M2P" tool platform).

Output as a single wireframe image with the following style rules:
- Pure black-and-white. Light gray only for de-emphasis (placeholders, disabled, not-evaluated). No other colors.
- Sharp rectangles only. No shadows, no rounded corners, no gradients, no photos, no logos.
- Section headings in Japanese. Page title is large (28px equivalent), section titles medium (18px equivalent).
- Lists and tables use thin hairline dividers between rows (no zebra, no heavy borders). Cards/boxes are used ONLY for state-bearing blocks (e.g. a stopped-state panel, a dialog).
- Buttons: `[ボタン名]` (square brackets, text only). Primary button = filled black with white text. Disabled button = light-gray text with light-gray border.
- Input fields: horizontal lines with label above. Dropdowns: `[ラベル ▾]`.
- Filter chips are pill-shaped outlined buttons (selected = filled black). This is the only rounded element allowed.
- Placeholder images are rectangles with a diagonal cross and a Japanese caption.
- All labels and content in Japanese. Numbers are dummy values. Show realistic information density.
- DO NOT DRAW any of the following (they must not exist on any 3DP screen): row-selection checkboxes in lists, bulk-action bars ("N 件まとめて..."), progress bars for listing quota, "predicted monthly revenue", auto-approve switches, charts or graphs.
- Status is never conveyed by color alone: use words plus shapes.

Persistent UI on every screen except login:
- Top header (64px): left = "3DP" wordmark (small), "← M2P ポータル" text link; right = ユーザーメニュー `[A ▾]`. There is NO cost meter and NO notification bell.
- Left sidebar (240px on desktop; hamburger only below tablet width): section "メニュー": ホーム / 商品 / 承認 (with count badge e.g. "3") / リサーチ ; section "分析": 損益と原価 ; section "システム": 実行状況 (a small "●" mark only when something is abnormal) / 設定 (a small "■" mark only while new listings are stopped). The current screen's item is highlighted (filled black). On this screen "設定" is highlighted.
- Directly under the header, a thin full-width "stop band" appears ONLY when new listings are stopped (not in this image unless stated).
```

---

## desktop.png プロンプト（安全装置タブ・通常状態）

```
Layout: 1440 x 2400 pixels (tall page allowed), desktop browser view. Header and sidebar per the common prompt. No stop band. Main column max width about 800px.

### Page header
- Title "設定"; caption 「安全装置・判定値・生成・媒体・運営者の回答・停止/撤退を設定します。」
- Notice block at the very top (a thin bordered strip): 「ここにある判定値・上限値・警告ラインは提案値であり、運営者は承認していません。実績が出たら見直してください。」
- Pill tabs in one row: (安全装置 — selected, filled black) (企画と価格) (生成) (判定値) (媒体) (運用). The 運用 tab is visually separated from the others by a gap and a thin vertical divider.

### ① R-1 月間出品上限  (with a badge `提案値 (未承認)` next to the section title, small outlined tag)
- Description: 「BOOTH の AI 生成物規制に備え、月あたりの出品数にツール側の上限を持ちます。」
- Two number inputs side by side: 「BOOTH の枠」[ 8 ] and 「Jinxxy の枠」[ 4 ], and a computed line 「合計 12 / 最大 12」 (text only, no bar).
- Beside the inputs, always visible (not a tooltip): 「設定できる最大は 12 です (コード側の固定値。この画面からは変更できません)」
- Note: 「同じ商品を 2 媒体に出すと枠は 1 件ずつ消費されます」 ; 「当月の出品 5 件」 as plain text (no bar)
- `[保存]` button; after it a small text 「保存済み 2026-10-10 18:20 JST」
- Group footer: `[このグループを確認した]` text-style button

### ② 禁止語リスト (R-2)  badge `変更済 (未確認)`
- Description: 「1 行 1 語。全角・半角は正規化され、重複は除かれます。」
- A multiline input with 6 dummy lines, `[保存]`, and a note 「固有名詞は網羅できません。見つけたら足してください」

### ③ 常時有効な判定
- Hairline list of 6 rows (判定名 + 一言説明; small code in gray): 作風の模倣 / 二次創作表現 / 特定アバター専用 / 作家名の参照 / 禁止語 / 商標の目印
- Sub-block 「許可される表現」: bullets 「数量表現 (全アバター・N 体対応) とツール・フォーマット名への対応は通す」「固有名詞 + 対応は弾く」

### ④ BOOTH アカウントの共用
- Always-visible statement: 「3DP の出品は A2P と同じ BOOTH アカウントを使います。処分されると A2P の BOOTH チャネルも同時に失います」
- Above the answer fields, bold: 「未回答の間は、初回の出品が保留されます」
- U-9: question 「同じ pixiv アカウントを BOOTH 以外にも使っていますか」 with radio ( ) はい ( ) いいえ and a 用途メモ input line
- U-10: question 「A2P の BOOTH 書籍売上は A2P 全体の何 % ですか」 with a number input [ ___ ] %
- `[回答を保存]` ; text 「回答日時: 未回答」
- (A suggestion line appears only when U-10 is large; not drawn here.)

### ⑤ 規制ゲート
- State row: 「状態: 通常」 (a plain word, no color) ; 「公開状態確認の最終成功: 2026-10-15 04:05 JST」
- Button: `[新規出品を止める…]` (outlined, plain)
- Explanation: 「確認ダイアログが 1 回出ます。理由は任意です。」
- No release control is shown while the state is 通常.
- 操作ログ table (hairline), 3 rows: 時刻 / 操作 / 発火元 / 理由 — e.g. 2026-09-30 22:10 / 停止 / 運営者 / 確認のため ; 2026-10-01 09:15 / 解除 / 運営者 / 原因は一時的な取得失敗と確認 ; 2026-10-05 04:05 / 停止 / 自動検知 / 期待は公開、観測は非公開
```

---

## limit-rejected.png プロンプト（R-1 の天井拒否）

```
Layout: same as desktop.png, but show only the page header, the tab row, and block ① R-1 月間出品上限 (the rest of the page is omitted; draw a faint "(以下省略)").

Block ① in the rejected state:
- The BOOTH input shows [ 13 ] with a bold outline; Jinxxy input [ 4 ].
- Directly under the inputs, a bold message box (thick left bar, not a color): 「13 は保存されていません。サーバー側で拒否しました (最大 12)。現在の値: 8」
- Always-visible statement remains: 「設定できる最大は 12 です (コード側の固定値。この画面からは変更できません)」
- The saved-state text reads 「保存済み (現在の値) BOOTH 8 / Jinxxy 4」. The value 13 is NOT rounded to 12.
```

---

## release-collapsed.png プロンプト（停止中・解除は畳まれている）

```
Layout: same shell as desktop.png (1440 x 2400). Differences: the sidebar item "設定" has a small "■" mark; a STOP BAND directly under the header (full width, thin, solid BLACK with white text): 「新規出品を停止中 (2026-10-15 03:42 JST ・ 自動検知)    [詳細]」 — no release button in the band.

Show the page header, the tab row (安全装置 selected), and a faint "(上部省略)" in place of ① to ④. Draw ⑤ 規制ゲート in detail:

### ⑤ 規制ゲート
- State row: 「状態: 停止中」 in bold with a filled-black small square "■"; 「公開状態確認の最終成功: 2026-10-15 03:40 JST」
- The `[新規出品を止める…]` button is replaced by plain text 「すでに停止中です」 (no button).
- Then, QUIETLY, below the state row and above the log: a single line of small plain text with a disclosure triangle, light gray, no border, no fill: `▸ 停止を解除する…` — visually LESS prominent than the body text. It is NOT placed in a button row and has NO button styling. Nothing inside is visible.
- 操作ログ table (hairline) with the newest row at the top: 2026-10-15 03:42 / 停止 / 自動検知 / 期待は公開、観測は非公開 (星型ピアスセット) + 3 older rows.
- Caption under the log: 「解除は時間経過・再デプロイでは戻りません。理由を添えた手動の解除だけが戻す操作です。」
```

---

## release-expanded.png プロンプト（停止の解除・展開）

```
Layout: same as release-collapsed.png, with the disclosure now expanded: `▾ 停止を解除する…`. The expanded content is an inline panel (thin hairline border, NOT a modal, plain white, quiet styling — it must look less loud than the stop band):

- Heading (regular weight): 「停止を解除する」
- Cause summary (read-only rows): 発火時刻 2026-10-15 03:42 JST / 原因の商品 「星型ピアスセット」 (`商品を見る →`) / 観測内容 「期待は公開、観測は非公開」
- Confirmation statement (bold): 「原因を確認しましたか。解除は、規制違反の疑いを運営者が引き受ける操作です。」
- Input: label 「解除の理由 (必須)」 — 3-line multiline input with a light-gray placeholder 「何を確認し、なぜ解除してよいと判断したかを書いてください」 ; small counter 「0 / 最低 10 文字」
- Buttons right-aligned: `[閉じる]` (outlined) and `[解除する]` (DISABLED: light-gray text and border) with caption 「理由が入力されると押せます」
- After-press behavior note in small gray text (as a caption, not a dialog): 「押すと確認ダイアログが出ます:『次の公開状態確認で異常が出ると再び停止します』」
- Do NOT use the primary filled-black style for 「解除する」. The stop button elsewhere is the more prominent element.
```

---

## mobile.png プロンプト

```
Layout: 375 x 812 pixels per screen; render as a tall scrolling page, single column. Header with hamburger (only on narrow width); sidebar hidden.

1. Page title 「設定」 + notice strip (提案値の注意書き)
2. Pill tabs as a horizontally scrollable row (安全装置 selected)
3. ① R-1: the two number inputs stacked, total line, the always-visible 「設定できる最大は 12 です…」 line, `[保存]`
4. ② 禁止語リスト
5. ③ 常時有効な判定 (6 rows)
6. ④ BOOTH アカウントの共用 with U-9 / U-10 fields
7. ⑤ 規制ゲート in the 停止中 state: state row, quiet `▸ 停止を解除する…` line (collapsed, light gray text link style), and the 操作ログ as 2-line rows
Stop band appears under the header in this mobile image (solid black, white text: 新規出品を停止中).
```

---

## 設計意図メモ（ChatGPT には渡さない）

- 「止めるものは目立たせ、戻すものは目立たせない」(UR-4)。停止ボタンは通常状態で出し、解除は**停止中だけ・畳みの奥・本文より目立たない見た目**。解除ボタンはホームにもバンドにも置かない (§9.13-5)。
- 解除の展開は、原因の再提示 + 「原因を確認しましたか」+ 理由必須 (空不可・短すぎる入力は拒否) + 入力が満たされるまで無効、の順で「立ち止まらせる」。モーダルにしない代わりに、押下後に確認ダイアログがもう 1 回出る (キャプションで示した)。
- R-1 の天井 12 は常時表示し、超過入力はサーバーが拒否して「13 は保存されていません… 現在の値: 8」と出す。黙って 12 に丸める UI を描かない (limit-rejected.png)。
- 提案値バッジ (提案値 (未承認) / 確認済 / 変更済 (未確認)) は UR-7。desktop.png では ① と ② で異なる状態を見せた。
- 運用タブ (撤退モード) は他のタブから離して描き、停止ボタンと並べない (§9.13-8)。運用タブ本体の画像は今回は作っていない。
- 描かないもの: 自動承認スイッチ、「上限を増やす」導線、出品枠の進捗バー。
- 他タブ (企画と価格 / 生成 / 判定値 / 媒体 / 運用) は優先度外のため未作成。
