# S-3DP-04 承認 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-3DP-04
- 画面名: 承認 (`/review` 待ち行列 / `/review/[id]` 承認画面)
- 対応機能 ID: F-3DP-20, 25, 27, 28, 42, 43 (加えて 01, 02, 03, 15, 22, 26, 30, 40, 50 を表示として含む)
- 元設計書: `docs/12-3dp-design.md` §9.8 S-3DP-04 / §9.1 UR-5 / §9.6.3 / §9.7 #8 / §9.13-3
- 想定画像:
  - `desktop.png` — 承認可能な状態 (全条件 OK。承認ボタン有効)
  - `blocked.png` — **承認不可フッター** (承認ボタン無効 + 理由の箇条書き)
  - `preview-fail.png` — **白画像失敗の枠** (プレビュー生成が GPU 無し環境で白画像 → 自己検査失敗)
  - `reject-dialog.png` — 「差し戻す…」ダイアログ
  - `mobile.png` — モバイル 1 カラム
  - `empty.png` — 承認待ち 0 件

## ChatGPT 使い方
1. ChatGPT (GPT-4o / 画像生成有効) を開く
2. 下記「共通プロンプト」と任意の「{バリアント} プロンプト」を結合してコピー
3. ChatGPT に貼り付けて画像生成
4. 出力 PNG を本ディレクトリに上記ファイル名で保存
5. 縦に長い画面は「1440 x 1800 まで縦長可」と指示済み。切れる場合は「上半分 / 下半分」に分けて 2 枚出させてよい

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
- Left sidebar (240px on desktop; hamburger only below tablet width): section "メニュー": ホーム / 商品 / 承認 (with count badge e.g. "3") / リサーチ ; section "分析": 損益と原価 ; section "システム": 実行状況 (a small "●" mark only when something is abnormal) / 設定 (a small "■" mark only while new listings are stopped). The current screen's item is highlighted (filled black).
- Directly under the header, a thin full-width "stop band" appears ONLY when new listings are stopped (not in this image unless stated).
```

---

## desktop.png プロンプト（承認可能）

```
Layout: 1440 x 1800 pixels (tall page allowed), desktop browser view. Header and sidebar per the common prompt; sidebar item "承認" is highlighted.

Main content: ONE single page, nothing collapsed, no tabs between the blocks. Two columns: wide left main column (about 60%) and right supporting column (about 40%). A fixed footer bar is pinned to the bottom of the viewport across the main area.

Page header (above columns):
- Breadcrumb: "承認 > {商品名}"
- Page title: "承認: 星型ピアスセット" with small text under it: "プロダクトの種別: アクセサリ ／ 状態: 承認待ち 2 日 ／ 待ち行列 3 件中 1 件目"
- Right side: `[← 前の待ち]` `[次の待ち →]` (text-style buttons)

LEFT COLUMN
### ① プレビュー 6 枚
- Section title "① プレビュー (6/6)" and small label "自己検査: 全枚通過"
- 3 x 2 grid of placeholder image rectangles, captions: サムネ / 正面 / 側面 / 背面 / 斜め / 寸法参照
- Each tile has a tiny check mark "通過" under it. Each tile has a small `[拡大]` text link.
- Right of the section title: `[配布 ZIP をダウンロード]` text-style button and `[プレビューを再描画]` text-style button (note: "credit は消費しません")

### ② 3D モデルを回して見る
- Section title "② 3D モデルを回して見る"
- Large rectangle (about 16:10) with a diagonal cross, caption "GLB ビューア (ドラッグで回転 / ホイールで拡大)". Small rotate-icon placeholder `[↻]` in the corner.
- Under it, one line: "固定の 6 枚では見えない側面を、ご自身の画面で確認してください。"

RIGHT COLUMN (stacked, hairline-separated, same width)
### ③ 検査結果
- Table with columns 項目 / 実測 / しきい値 / 結果. 8 rows, e.g. 三角形数 6,820 / 7,500 / OK; テクスチャ解像度 2048 / 2048 / OK; マテリアル数 2 / 4 / OK; 寸法 (cm) 3.2 / 範囲内 / OK; 最適化後の再検査 NG 0 件; 変換 (FBX) の健全性 bbox・三角形数 ±1% 以内 / OK ...
- Small tag: "しきい値種別: アクセサリ"
- Summary line: "NG 0 件"

### ④ 依拠性判定
- Table: 判定対象 (商品名 / 紹介文 / 生成プロンプト / 企画) / 結果 ("許可" with a filled check) / 判定時刻
- Line: "表示時に再判定しました: 保存済みの判定と一致"

### ⑤ 想定手取り
- Two small blocks side by side by 媒体: "BOOTH" and "Jinxxy". Each: 販売価格 ¥500 → 手数料 −¥73 → 手取り ¥427. Caption "端数は切り捨て ／ 価格下限 ¥500"

### ⑥ 商品ページ原稿
- Pill tabs: `(BOOTH)` selected, `(Jinxxy)`
- Fields shown as text blocks: 商品名 / 紹介文 (5 lines of dummy text, last paragraph labelled "AI 生成について" ) / タグ (5 tags) / 価格 ¥500
- Beside it a "原稿検査" checklist: 禁止語 0 件 ✓ / 必須 6 項目 (三角形・テクスチャ・マテリアル・対応環境・ライセンス・AI 開示) ✓ / 数値が検査結果と一致 ✓ / AI 開示が全箇所にある ✓

### ⑦ 出品の前提
- Hairline list: 当月の出品: "承認すると 5 件目 / 上限 8 件 (上限は目標ではありません)" — TEXT ONLY, no bar
- 新規出品: "通常 (停止中ではありません)"
- BOOTH アカウント共用: "3DP の出品は A2P と同じ BOOTH アカウントを使います。処分されると A2P の BOOTH チャネルも同時に失います"
- U-9 / U-10 の回答: "未回答 — 承認はできますが、出品は保留されます" with text link "設定で回答する"

FIXED FOOTER (full main-area width, top hairline, white background)
- Left: one summary line "プレビュー 6/6 ・ 検査 NG 0 ・ 依拠性 OK ・ 手取り ¥427"
- Right: `[差し戻す…]` (outlined) and `[承認]` (filled black, enabled)
- No auto-approve switch anywhere.
```

---

## blocked.png プロンプト（承認不可フッター）

```
Layout: same as desktop.png (same page, same blocks), with these differences. This image exists to show WHY the approve button cannot be pressed.

Differences in the blocks:
- ③ 検査結果: two rows are marked "NG" (bold, with an "✕" and the word 未達): 三角形数 8,410 / 7,500 / NG ; テクスチャ解像度 4096 / 2048 / NG. Summary line "NG 2 件"
- ⑤ 想定手取り: BOOTH price shown as ¥400 with the note "価格下限 ¥500 未満" in bold
- ⑥ 原稿検査: the line "AI 開示が全箇所にある" is marked ✕ with text "商品説明の末尾に AI 開示がありません"
- Each of those problem rows/lines has a thick left bar marker so they are easy to locate.

FIXED FOOTER (taller than normal: it expands upward to hold the reasons list)
- Top line of the footer: heading "承認できない理由 (3 件)"
- Bulleted list, each item with a text link on the right:
  - "検査 NG が 2 件あります (三角形数・テクスチャ解像度)" → `③ 検査結果へ`
  - "価格 ¥400 が下限 ¥500 を下回っています" → `⑤ 想定手取りへ`
  - "商品説明の末尾に AI 開示がありません" → `⑥ 商品ページ原稿へ`
- Bottom row: summary line "プレビュー 6/6 ・ 検査 NG 2 ・ 依拠性 OK ・ 手取り —" on the left. Right: `[差し戻す…]` (enabled, outlined) and `[承認]` (DISABLED: light gray text, light gray border, no fill).
- A small caption next to the disabled button: "上の理由を解消すると押せます"
```

---

## preview-fail.png プロンプト（白画像失敗の枠）

```
Layout: same as desktop.png (same page), with these differences. This shows the state where preview rendering ran in an environment without a GPU, produced white images, and the self-check failed.

① プレビュー block:
- Section title "① プレビュー (0/6)" with a bold label "自己検査: 失敗"
- Instead of the 3 x 2 grid of images, show a single wide bordered frame (this is a state-bearing block, a box is allowed) containing:
  - Six small tiles in a row, all EMPTY WHITE rectangles with a light-gray dashed outline, each captioned with the tile name and "✕ 白画像"
  - Under the tiles, a message in plain Japanese (2 sentences): "プレビューが白画像だったため失敗にしました。GPU の無い環境では描画が白く返ることがあります。『再描画』で作り直せます (credit は消費しません)。"
  - Buttons: `[プレビューを再描画]` (primary, filled black)
  - A collapsed disclosure line `▸ 詳しい情報 (技術者向け)` — collapsed; the technical code and renderer name are NOT shown
- A short note under the frame: "寸法参照を含む 6 枚が揃うまで承認はできません"

② 3D モデルを回して見る: shows the normal viewer placeholder (the viewer works independently of the previews).

Other blocks: ③〜⑦ normal and passing.

FIXED FOOTER: expanded with heading "承認できない理由 (1 件)", one bullet "プレビューの自己検査が失敗しています (白画像 6/6)" with link `① プレビューへ`; summary "プレビュー 0/6 ・ 検査 NG 0 ・ 依拠性 OK ・ 手取り ¥427"; `[差し戻す…]` enabled; `[承認]` DISABLED (light gray).
```

---

## reject-dialog.png プロンプト（差し戻しダイアログ）

```
Layout: same as desktop.png as the dimmed background (light-gray overlay over everything), with a centered modal dialog (sharp rectangle, black 2px border), about 560px wide.

Dialog content:
- Title: "差し戻す"
- Label "差戻し先 (必須)" and three radio options, each with a one-line explanation:
  - ( ) 再生成 — アセットを作り直す。「企画の累計 10 回に数えます (いま 3/10)」
  - ( ) 原稿のやり直し — 商品ページ原稿だけを作り直す
  - ( ) 企画を却下 — この商品を却下して終了する (元に戻せません)
- Label "理由 (必須)" with a 4-line multiline text input, placeholder in light gray "例: 側面の形が崩れている"
- Caption: "理由は次の生成・原稿の入力として引き継がれます"
- Buttons at the bottom right: `[キャンセル]` and `[差し戻す]` (DISABLED, light gray, until a destination and a reason are filled)
```

---

## mobile.png プロンプト

```
Layout: 375 x 812 pixels (iPhone portrait) per screen; render as a tall scrolling page, single column, same blocks stacked in this order. Header has hamburger menu; sidebar hidden.

1. Page title "承認: 星型ピアスセット" + "承認待ち 2 日 ／ 3 件中 1 件目" + `[次の待ち →]`
2. ① プレビュー: 2 x 3 grid of placeholder tiles with captions
3. ② 3D モデルを回して見る: viewer rectangle (4:3)
4. ③ 検査結果: compact 2-column list (項目 / 実測 ÷ しきい値 ／ 結果)
5. ④ 依拠性判定
6. ⑤ 想定手取り (BOOTH then Jinxxy stacked)
7. ⑥ 商品ページ原稿 with pill tabs and 原稿検査
8. ⑦ 出品の前提

Fixed bottom bar (always visible): one summary line "検査 NG 0 ・ 依拠性 OK ・ 手取り ¥427", and below it two full-width buttons side by side `[差し戻す…]` `[承認]`. A small text link "承認できない理由 (0)" above the bar is hidden when there are none.
```

---

## empty.png プロンプト

```
Layout: same as desktop.png (header, sidebar with "承認" highlighted but WITHOUT a count badge).

Main content:
- Page title "承認"
- Centered message block: "承認待ちはありません"
- Section "直近に承認・差し戻しした商品" — hairline list of 3 rows: 商品名 / 結果 (承認 or 差戻し: 再生成) / 日時 (JST) / `[商品を見る]` text link
- One line: "生成中・検査中の商品は 2 件あります" with text link `商品一覧へ`
- NO approve button, NO footer bar.
```

---

## 設計意図メモ（ChatGPT には渡さない）

- 承認は「外せない人間のゲート」。**1 画面に全部並べる**ことが「見ずに押す」への防御の本体 (UR-5)。タブ・折りたたみ・ステップ分割を絶対に描かないよう、プロンプトに明記した。
- 承認ボタンの有効条件はデータ条件のみ (ビューアを回さないと押せない等の儀式は §9.13-3 で却下)。ビューア ② は「見る場」であって「条件」ではない。
- 承認不可は「灰色になるだけ」にしない。理由を箇条書きし、各行に該当ブロックへのリンクを付ける (blocked.png の主題)。同時に問題のブロック側にも太い左マーカーを付け、フッターと本体の対応を目で追えるようにした。
- 白画像失敗は、画像枠そのものを失敗表示に差し替え、コード/レンダラ名は畳みの奥に隠す (§9.7 の「コードは展開の奥」)。「再描画は credit 不要」を必ず添える。
- U-9/U-10 未回答は承認を妨げない (出品が保留されるだけ) ことを ⑦ に文章で示す。ブロック理由と混同しないよう、blocked の箇条書きには入れない。
- 描かないもの: 自動承認スイッチ、一括承認、出品枠の進捗バー (⑦ は文字のみ)。
- 関連: 差し戻し 3 分岐 (再生成 / 原稿やり直し / 企画却下) は §9.5 の状態遷移と対応。再生成は企画の累計 10 回に数える旨を出す。
- 関連 UC: 運営者が 1 件ずつ承認 → 次の待ちへ連続処理 (§9.3 遷移規則②)。
