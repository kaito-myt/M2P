# S-3DP-03 商品詳細 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-3DP-03
- 画面名: 商品詳細 (`/products/[id]`) — 優先範囲は「出品作業」と「取り下げ」
- 対応機能 ID: F-3DP-29, 30, 33, 39, 42, 43, 44 (加えて 03, 04, 12〜15, 25〜27, 31, 32, 45, 47, 49 を表示として含む)
- 元設計書: `docs/12-3dp-design.md` §9.8 S-3DP-03 (出品作業の仕様 / 取り下げの仕様) / §9.5 / §9.6.3 / §9.13-7
- 想定画像:
  - `desktop.png` — 承認済 (出品作業待ち) の商品。**出品作業の節が有効**
  - `publish-held.png` — 出品作業が**保留中**(手順が無効 + 保留理由)
  - `listed.png` — 出品済の商品。公開状態の節と、畳まれた「危険な操作」
  - `withdraw-dialog.png` — **取り下げを記録するダイアログ**
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
- Left sidebar (240px on desktop; hamburger only below tablet width): section "メニュー": ホーム / 商品 / 承認 (with count badge e.g. "3") / リサーチ ; section "分析": 損益と原価 ; section "システム": 実行状況 (a small "●" mark only when something is abnormal) / 設定 (a small "■" mark only while new listings are stopped). The current screen's item is highlighted (filled black). On this screen "商品" is highlighted.
- Directly under the header, a thin full-width "stop band" appears ONLY when new listings are stopped (not in this image unless stated).
```

---

## desktop.png プロンプト（承認済・出品作業の節が有効）

```
Layout: 1440 x 2600 pixels (tall page allowed), desktop browser view. Header and sidebar per the common prompt. Single main column, max width about 960px, sections separated by hairlines.

### Page header
- Breadcrumb: "商品 > 星型ピアスセット"
- Title: "星型ピアスセット" ; line under it: "アクセサリ ・ 状態: 承認済 (出品作業待ち) ・ 価格 ¥500 ・ 想定手取り ¥427"
- Process bar (a row of 9 labelled steps, connected by thin lines): 企画 → 生成 → 検査 → 最適化 → プレビュー → 原稿 → 承認 → 出品作業 → 公開. Steps up to 承認 show "✓" (filled), 出品作業 is the CURRENT step (bold, outlined thick), 公開 is not reached (light gray, dashed).
- Right of title: primary button `[出品作業へ]` (filled black) — one main action only

### 1. いま止まっている理由 / 次にやること
- One sentence: 「承認済みです。BOOTH に配布 ZIP を UP して公開し、下の『公開を記録する』を押してください。(承認から 1 日 2 時間経過)」

### 2. 企画
- Rows: 種類 アクセサリ / 題材 星型のピアス / 概念 (何を・誰に・なぜ, 3 lines) / 想定価格 ¥500 / 依拠性判定 "許可 (判定 2026-10-12 21:04 JST, 禁止語リスト 24 語)" / 企画元の所見 `リサーチ所見へ →`

### 3. 生成アセットと版履歴
- Table: 版 / 生成元 (provider・モデル) / 三角形 / 検査 / 作成時刻 / R2 保持 / 配布版. 3 rows: v3 (配布版 marked "★ 配布版", R2 保持) ; v2 (中間版: R2 は削除済み — 行は残る) ; v1 (同上). Prompt column shows `▸ プロンプト` collapsed.
- Line: 「再生成 2/3 (アセット) ・ 企画の累計 2/10 ・ 消費 380 credits (約 ¥1,900)」

### 4. 検査結果 — compact table (6 rows: 項目 / 実測 / しきい値 / OK)
### 5. プレビュー — a row of 6 small placeholder tiles with "自己検査: 通過" and `[プレビューを再描画]` small text button
### 6. 商品ページ原稿 — pill tabs (BOOTH selected / Jinxxy), 3 lines of copy summary, 原稿検査 "全項目合格"

### 7. 出品作業 (the focus of this image; draw it as a distinct bordered block, since it carries state)
- Title "出品作業"
- (No hold reason is shown in this image.)
- Four numbered steps in a vertical list, each one line with its control:
  1. 「BOOTH の下書きを開く」 `[下書きを開く ↗]`
  2. 「配布 ZIP をダウンロード」 `[ZIP をダウンロード]` ; caption "導入 / モデルデータ / テクスチャ ・ 署名付き URL (期限 10 分)" ; line "初回ダウンロード: 2026-10-15 09:12 JST"
  3. 「BOOTH で作品ファイルを UP して公開」 (text only; no control)
  4. 「公開を記録する」 with an input line labelled "BOOTH の商品 URL (必須)" with placeholder "https://....booth.pm/items/..." and a primary button `[公開を記録する]`. Hint under the input: 「URL が無いと公開状態の確認ができません」
- A single always-visible line at the bottom of the block: 「3DP の出品は A2P と同じ BOOTH アカウントを使います。処分されると A2P の BOOTH チャネルも同時に失います」
- A line: 「承認からの経過: 1 日 2 時間 (待ち時間を含みます)」 — the word "作業時間" must NOT appear.
- NO confirmation dialog is drawn for 「公開を記録する」.

### 8. 公開状態 — one line: 「まだ公開を記録していません」 (light gray, unreached)
### 9. 売上 — one line: 「まだここまで進んでいません (現在: 出品作業)」 (light gray)
### 10. 履歴 — hairline list: 承認 2026-10-14 08:05 JST / 生成完了 / 検査合格 / 企画 ... + `この商品のジョブ → 実行状況`

Do NOT draw the 「危険な操作」 block in this image (it exists only for listed products).
```

---

## publish-held.png プロンプト（出品作業が保留中）

```
Layout: same as desktop.png. Only the block "7. 出品作業" differs; draw it in detail and keep the rest of the page simplified (sections 1 to 6 may be reduced to one line each, section titles kept).

Block 7 出品作業 (bordered, state-bearing):
- First, on top, a bold hold-reason box (thick left bar): 「出品は保留中です」 + reason line 「理由: BOOTH アカウント共用についての回答 (U-9 / U-10) が未回答です」 + text link `設定 安全装置タブで回答する →`
- Below it, the same four numbered steps but ALL controls are DISABLED (light-gray text, light-gray borders, the input line is light gray and not editable). The step labels are light gray.
- Caption: 「保留の理由が解消すると、上の手順が使えるようになります」
- The always-visible shared-account line at the bottom stays black.
- Under the block, a small list "保留理由の種類" is NOT drawn (only the one current reason is shown).
Section 1 at the top of the page reads: 「承認済みですが、出品は保留中です。理由は下の出品作業を見てください。」
```

---

## listed.png プロンプト（出品済・公開状態・畳まれた危険な操作）

```
Layout: same as desktop.png shell. Product state is 出品済. Page title "星型ピアスセット", line "アクセサリ ・ 状態: 出品済 ・ 価格 ¥500", link `BOOTH で見る ↗` (small external link). Process bar: all 9 steps filled with ✓, "公開" is the current step.

Show sections 1 to 6 reduced to one line each (titles kept, content summarized). Draw these in detail:

### 7. 出品作業 — reduced to a single line 「公開を記録済み: 2026-10-15 10:02 JST ・ BOOTH URL https://....booth.pm/items/... 」 (no controls)

### 8. 公開状態
- Line: 「期待: 公開」
- Observation history table, 5 rows: 観測時刻 (JST) / 観測値 / 理由
  - 2026-10-15 04:05 / 公開と確認 / —
  - 2026-10-14 04:05 / 公開と確認 / —
  - 2026-10-13 04:05 / 取得できず / タイムアウト (HTTP 取得 10 秒)
  - 2026-10-12 04:05 / 公開と確認 / —
  - 2026-10-11 04:05 / 公開と確認 / —
  The three observation values are different words with different marks: 公開と確認 = ✓, 取得できず = dashed "?" in light gray, 異常 = bold ✕ (the ✕ is not present in this image).

### 9. 売上
- Hairline rows: 販売本数 2 本 ・ 売上 ¥1,000 ・ 手取り ¥854 ; link `損益と原価の商品別へ →` ; row "Jinxxy: 参考 (判定対象外) 0 本"

### 10. 履歴 — hairline list (承認 / 公開記録 / ...)

### 11. 危険な操作 (最下部。既定で畳まれている)
- Placed at the very bottom, with extra vertical distance (a large gap) from section 10, rendered as a quiet one-line disclosure: `▸ 危険な操作` in small light-gray text. NOT expanded. Nothing inside is visible.
- It must not look like a primary action. No button is visible. It is clearly separate from stop/retire controls (none of those exist on this screen).
```

---

## withdraw-dialog.png プロンプト（取り下げを記録するダイアログ）

```
Layout: listed.png as the dimmed background (light-gray overlay), with section 11 now shown expanded behind the dialog (a single button `[取り下げを記録する…]` inside the expanded disclosure). A centered modal dialog (sharp rectangle, black 2px border), about 600px wide:

- Title: 「取り下げを記録する」
- Three numbered notice paragraphs at the top, in this order:
  ① (bold) 「取り下げても損失は減りません。公開したまま放置しても費用は増えず、売上の可能性だけが消えます。」
  ② (bold) 「この操作は BOOTH 上の商品を非公開にしません。先にここで記録してから、BOOTH の管理画面で非公開にしてください。」
  ③ small gray reason for the order: 「BOOTH で先に非公開にすると、公開状態の確認が異常と判定して新規出品を自動で止めます。」
- Label 「理由 (必須)」 with a 3-line multiline text input (empty, placeholder in gray 「例: 売れ行きが無く、掲載を終えるため」)
- Product name shown once: 「対象: 星型ピアスセット (1 商品)」 — only one product; no selection of other products anywhere.
- Buttons bottom right: `[キャンセル]` and `[取り下げを記録する]` (DISABLED, light gray, until a reason is entered)
```

---

## mobile.png プロンプト

```
Layout: 375 x 812 pixels per screen; render as a tall scrolling page, single column, showing the 承認済 (desktop.png) state. Header with hamburger; sidebar hidden.

1. Title + status line + the primary button `[出品作業へ]` full width
2. Process bar condensed: "承認 ✓ → 出品作業 (現在) → 公開" with a `[すべての工程]` expander
3. 1. いま止まっている理由 / 次にやること
4. 出品作業 block FIRST among the detail blocks (bordered), four steps stacked, the URL input and `[公開を記録する]` full width; shared-account line below
5. 2. 企画 / 3. 生成アセットと版履歴 (cards as hairline lists, 2 lines per row) / 4. 検査結果 / 5. プレビュー (2 x 3) / 6. 商品ページ原稿 / 8. 公開状態 / 9. 売上 / 10. 履歴
6. At the very bottom, no 「危険な操作」 (the product is not listed yet).
```

---

## 設計意図メモ（ChatGPT には渡さない）

- ツールは BOOTH の公開を自分で観測できないため、公開は運営者の手作業。「公開を記録する」が無いと G-E (運営者の作業時間) が永久に測れない。よって出品作業の節は**手順 4 つ + URL 必須入力 + 確認ダイアログなし**で描いた (取り消せる事実の記録であって破壊的でない)。
- 保留中は手順を無効にして理由を先頭に出す (台帳 #9)。「壊れている」と誤解させないため。
- 経過は「承認からの経過 (待ち時間を含みます)」。「作業時間」と書かない (§9.12-6 が未決)。
- 取り下げは**商品詳細の最下部の畳みの奥のみ**。一覧に出さず、一括の部品を作らない (UR-4)。ダイアログは「損失は減らない」「BOOTH を自動で非公開にしない」「先に記録する理由」を必ず出す。順序を間違えると自分の操作で kill switch が発火するため。
- 公開状態の観測値は 3 値 (公開と確認 / 異常 / 取得できず) を形と言葉で描き分けた。「取得できず」を異常と同じ扱いにしない (§9.12-7)。
- 未到達の節は「まだここまで進んでいません」の 1 行 (空の表を描かない、§9.6.3)。
- 白画像失敗の詳細表示は S-3DP-04 (承認) に描いた。S-3DP-03 のプレビュー節は同じ部品 (PreviewGrid) を使う想定で、別画像は作っていない。
