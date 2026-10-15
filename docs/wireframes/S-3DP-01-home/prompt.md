# S-3DP-01 ホーム — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-3DP-01
- 画面名: ホーム (`/`)
- 対応機能 ID: F-3DP-02, 14, 30, 32, 35, 36, 37, 39, 40, 43, 46, 47, 49
- 元設計書: `docs/12-3dp-design.md` §9.8 S-3DP-01 / §9.4 停止中バー / §9.6 空状態 / 判定パネルの仕様 / §9.10.1
- 想定画像:
  - `desktop.png` — Stage 2 (運用中) の標準ビュー。判定パネルに `ok` と `未評価` が並ぶ
  - `gate-states.png` — 判定パネルの 4 値 (ok / warn / fail / 未評価) の描き分け確認用 (拡大)
  - `stage0.png` — **Stage 0 (商品 0 件)**。立ち上げチェックが最上部
  - `halted.png` — **停止中のホーム** (停止中バー + 停止中パネル)
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
- Left sidebar (240px on desktop; hamburger only below tablet width): section "メニュー": ホーム / 商品 / 承認 (with count badge e.g. "3") / リサーチ ; section "分析": 損益と原価 ; section "システム": 実行状況 (a small "●" mark only when something is abnormal) / 設定 (a small "■" mark only while new listings are stopped). The current screen's item is highlighted (filled black).
- Directly under the header, a thin full-width "stop band" appears ONLY when new listings are stopped (not in this image unless stated).

Four-value judgement badge (used on this screen; the four MUST look clearly different in shape AND words, not just tone):
- ok      = solid black filled square with a white check mark, label "ok"
- warn    = outlined triangle "▲" with the label "注意"
- fail    = solid black filled square with a white cross, label "未達" (bold)
- 未評価  = DASHED outline circle in light gray, light-gray text "未評価", and its value cell shows "—". It must never look like ok.
```

---

## desktop.png プロンプト（Stage 2 運用中）

```
Layout: 1440 x 2000 pixels (tall page allowed), desktop browser view. Header and sidebar per the common prompt; sidebar item "ホーム" highlighted, "承認" shows badge "2". No stop band. Main content is one column, max width about 960px, sections separated by hairlines.

Page header: title "ホーム" (28px) with a one-line caption "今日判断すべきことがあるか、続けるか止めるかの現在値。出品を促す画面ではありません。"

### Section A: 要対応
- Section title "要対応"
- Hairline list, each row = 種類 / 件数 / 一番古いものの経過 / 遷移先リンク:
  - 承認待ち / 2 件 / 最古 2 日 / `承認へ →`
  - 出品作業待ち (承認済・公開未記録) / 1 件 / 最古 1 日 / `商品へ →`
  - 出品保留 / 1 件 (理由: U-9・U-10 未回答) / — / `設定へ →`
  - 滞留 (24 時間動いていない) / 1 件 / 31 時間 / `商品へ →`
  - 定期タスクの異常 / 1 件 (不発) / 予定超過 3 日 / `実行状況へ →`
- (If the list were empty it would say a single line "いま対応が必要なものはありません" — not drawn here.)

### Section B: 成果 (hero, two large metrics side by side — the ONLY large numbers on the page)
- Left: label "当月純利益" with large number "−¥3,180" and a small line "手取り ¥2,560 − 実コスト ¥5,740"
- Right: label "1 商品あたりの売上" with large number "¥640" and small line "累計売上 ¥3,200 ÷ 出品済み 5 商品"
- Small caption under both: "売上の最終取得 2026-10-15 04:10 (JST)"
- Below, a separate thin row: "Jinxxy: 参考 (判定対象外)  売上 ¥0"
- NO listing count in large type.

### Section C: 撤退判定パネル
- Section title "撤退判定パネル"; caption "総合点はありません。1 ゲート 1 行です。"
- Table header: ゲート名と問い / 今の値 / 続行ライン / 判定日 / 残り日数 / 判定 / 一言の理由
- 5 rows (the four-value badges must appear side by side so the difference is obvious):
  1. G-A 品質 — 試作は届くか / 検査通過 1 / 試行 2 + 運営者判定「届く」 / 運営者が「¥500 で売れる」と言える / P-0 完了済 / — / [ok badge] / 運営者が判定済み
  2. G-B 市場 — 最初の 8 商品が売れるか / 累計 3 本 / 5 本以上 / 初回出品の 90 日後 (2027-01-12) / 残り 89 日 / [warn badge 注意] / 判定日前の暫定: 進み具合がやや遅れています
  3. G-C 採算 — 手取りがコストを上回るか / — / 0 以上 / 初回出品の 180 日後 / 残り 179 日 / [未評価 badge] / 売上取得が一度も成功していません。初回の売上取得後に始まります
  4. G-D 規制 — 公開が維持されているか / 観測 5 商品中 異常 0 件 (最終確認 04:05) / 異常 0 件 / 常時 / 常時 / [ok badge] / 直近の確認で異常なし
  5. G-E 稼働 — 運営者の作業は上限内か / — / 月 240 分 / 毎月末 / 残り 16 日 / [未評価 badge] / 承認〜公開記録のペアが 0 件。最初の公開記録後に始まります
- Rows with 未評価 have light-gray text and "—" in the value cell; rows with ok are normal black text. Each G-B/G-C row has a text link `損益と原価へ →`.
- Under the table: "最終算出 2026-10-15 04:20 (JST)". No "R-1 見直し" row (catalog is under 100).
- Under the table, a small note slot: "判定日前の暫定判定を含みます" (small, gray).
- NO predicted monthly revenue anywhere.

### Section D: 今月の枠と稼働 (two small figures side by side, plain text, no bars)
- Left: "当月の出品 5 件 / 上限 8 件" (BOOTH 5 / 8 、Jinxxy 0 / 4 と小さく併記) + caption "上限は目標ではありません" + text link `R-1 を下げる →`
- Right: "当月の運営者作業 38 分 / 上限 240 分" + "1 商品平均 19 分 ・ 15 分超 2 商品"
- A button `[新規出品を止める…]` (outlined, plain, right aligned in this section)

### Section E: 資源
- Hairline list: Meshy 月間 credit 残量 "1,420 credits (取得 04:12 JST)" / R2 3dp/ 使用量 "2.1 GB / 警告 20 GB (取得 04:12 JST)" / 生成歩留まり "1 発合格 62% (警告ライン 50%)" with link `損益と原価へ →`
- One row shows the failure form as an example: "LLM 残高: 取得できません: タイムアウト (最終成功 2026-10-14 04:12 JST)"

### Section F: 定期タスク
- Hairline list of 5 rows: 名称 / 最終実行 (JST) / 結果
  - 週次リサーチ / 2026-10-12 03:00 / 成功
  - 企画の日次作成 / — / 一度も実行されていません
  - 売上の日次取得 / 2026-10-15 04:10 / 成功
  - 公開状態の確認 / 2026-10-15 04:05 / 成功
  - ゲートの日次スナップショット / 2026-10-15 04:20 / 一部失敗
- Link `実行状況へ →`

### Section G: 商品の状態
- Section title "商品の状態", link `商品一覧へ →`
- Dense hairline list, each row clickable (arrow "›" at right), name left and count right, in this order: 企画済 0 / 生成中 1 / 検査中 0 / 要修正 1 / 生成完了 0 / 承認待ち 2 (bold) / 承認済 1 (bold) / 出品済 5 / 失敗 0 / 却下 2 / 取り下げ済 0 / 合計 12
```

---

## gate-states.png プロンプト（判定 4 値の描き分け確認用）

```
Layout: 1200 x 700 pixels. Do NOT draw the header or sidebar. Draw only the judgement panel from desktop.png Section C, enlarged, with these 5 rows in this order so that `ok` and `未評価` sit directly next to each other:
1. G-D 規制 → [ok badge]  (value cells filled with real numbers, normal black text)
2. G-E 稼働 → [未評価 badge] (value cell "—", whole row in light gray, dashed outline badge, reason text "承認〜公開記録のペアが 0 件。最初の公開記録後に始まります")
3. G-B 市場 → [warn badge 注意]
4. G-A 品質 → [ok badge]
5. G-C 採算 → [fail badge 未達] (bold row, value "手取り − 実コスト = −¥3,180", line "0 以上")

Below the table draw a legend box with the 4 badges side by side and a one-line explanation under each:
- ok = データがあり、ラインを満たしている
- 注意 = ラインに届いていない、または判定日前の進みが遅い
- 未達 = ラインを割っている
- 未評価 = データがまだ無い。「大丈夫」ではない
Emphasis: 未評価 must be immediately distinguishable from ok at a glance (dashed vs solid, light gray vs black, "—" vs numbers).
```

---

## stage0.png プロンプト（Stage 0: 商品 0 件）

```
Layout: same shell as desktop.png (1440 x 1900, header and sidebar; "承認" has NO badge; no stop band). Page title "ホーム" with caption "最初の 1 商品を出すまでの準備を、上から順に確認します。"

Sections in this order (the setup check is at the TOP):

### Section A: 立ち上げチェック
- Hairline list of 5 rows, each: marker (済 / 未 / 確認できない shown as words with distinct shapes: 済 = filled square with check, 未 = empty square outline, 確認できない = dashed outline with "?") / item / one-line guidance / link
  1. 未 設定の提案値を確認した — 「初期値はすべて提案値です。一度確認してください」 → `設定へ →`
  2. 未 Meshy API キーを登録した — 「3D 生成に Meshy のキーが必要です」 → `ポータルの API 管理へ →`
  3. 未 試作を 1 点作った — 「まずアクセサリを 1 点試作して、品質が売れる水準か確かめます」 → `商品一覧へ →`
  4. 未 BOOTH アカウントの共用について回答した (U-9 / U-10) — bold "初回の出品の前に必須です。3DP の出品は A2P と同じ BOOTH アカウントを使います" → `設定 安全装置へ →`
  5. 確認できない A2P 側の BOOTH セッションが有効 — 「BOOTH のログインは A2P 側の既存手順で行ってください」 (no link) with a small gray reason "確認できません: セッション情報を読めませんでした"
- Caption: "0 / 5 完了"

### Section B: 要対応
- Single line: "いま対応が必要なものはありません" (the section is NOT removed)

### Section C: 成果
- Two metric slots, each showing "—" instead of a number and a reason in small text:
  - 当月純利益 "—" / 「まだ出品していないため」
  - 1 商品あたりの売上 "—" / 「出品済みの商品がありません」
- NO "¥0" anywhere.

### Section D: 撤退判定パネル
- Same table as the Stage 2 version, but ALL 5 rows are 未評価 (dashed circle badge, light-gray text, "—" values). Each row's reason states WHEN evaluation starts:
  - G-A: 「試作を 1 点作り、運営者が判定すると始まります」/ 判定日 P-0 = 増分 2 完了時
  - G-B: 「初回の BOOTH 出品後に始まります」/ 判定日 初回出品の 90 日後
  - G-C: 「初回の売上取得後に始まります」/ 判定日 初回出品の 180 日後
  - G-D: 「出品済みが 0 件のため観測対象がありません」/ 判定日 常時
  - G-E: 「承認〜公開記録のペアが 0 件」/ 判定日 毎月末
- Under the table: "最終算出 —  (まだ算出されていません)". NO "ok" badge on the page. NO predicted monthly revenue.

### Section E: 今月の枠と稼働
- "当月の出品 0 件 / 上限 8 件" plain text, "上限は目標ではありません"; "当月の運営者作業 — / 上限 240 分"; `[新規出品を止める…]`

### Section F: 資源
- Meshy 月間 credit 残量: "取得できません: Meshy API キーが未設定です (ポータル → API 管理)"; R2 3dp/ 使用量: "0 GB / 警告 20 GB (取得 04:12 JST)"; 生成歩留まり: "—  (生成実績がありません)"

### Section G: 定期タスク
- All 5 tasks listed (週次リサーチ / 企画の日次作成 / 売上の日次取得 / 公開状態の確認 / ゲートの日次スナップショット), 最終実行 "—", 結果 "一度も実行されていません" for every row

### Section H: 商品の状態
- The full status list with every count "0" shown in light gray, 合計 0
```

---

## halted.png プロンプト（停止中のホーム）

```
Layout: same shell as desktop.png (1440 x 2000). Differences:

1. Sidebar: the item "設定" has a small "■" mark. "ホーム" highlighted.
2. STOP BAND directly under the header, full width, thin (about 36px), solid BLACK with white text: "新規出品を停止中 (2026-10-15 03:42 JST ・ 自動検知)    [詳細]"  — NO release button in the band. (This band appears on every screen; here it is visible on top of the home.)
3. Page title "ホーム".
4. Section 0 (first, above everything): 停止中パネル — a bordered box (2px black border, the only box on the page), headed "新規出品を停止中":
   - Rows: 発火時刻 2026-10-15 03:42 (JST) / 発火元 自動検知 (公開状態の確認) / 原因の商品 「星型ピアスセット」(link `商品を見る →`) / 観測内容 「期待は公開、観測は非公開」
   - Paragraph: 「新規の企画・生成・出品の承認は止まっています。既存の商品は公開のままです。原因を確認したうえで、設定の安全装置タブから理由を添えて解除します。」 followed by a plain TEXT LINK (not a button) `設定 安全装置タブへ →`
   - NO release button, NO "再開" button anywhere on this page.
5. Section 要対応: includes the row 公開状態の異常 / 1 件 / 最古 1 時間 / `商品へ →` (bold), plus 出品保留 / 2 件 (理由: 停止中) / `商品へ →`
6. Section 成果: same as desktop.png.
7. Section 撤退判定パネル: the G-D row is [fail badge 未達] in bold: 観測 5 商品中 異常 1 件 / 異常 0 件 / 常時 / 未達 / 「期待は公開、観測は非公開の商品があります」. Other rows as in desktop.png (G-A ok / G-B 注意 / G-C 未評価 / G-E 未評価).
8. Section 今月の枠と稼働: the stop button is replaced by plain text "新規出品: 停止中" (no button). Quota text remains. No "R-1 を下げる" emphasis change.
9. The remaining sections (資源 / 定期タスク / 商品の状態) are the same as desktop.png, with the 公開状態の確認 row showing 結果 "成功" and the 商品の状態 row 出品済 5.
```

---

## mobile.png プロンプト

```
Layout: 375 x 812 pixels per screen; render as a tall scrolling page, single column (Stage 2 content as in desktop.png). Header with hamburger menu (hamburger only on this narrow width); sidebar hidden.

Stack in this order:
1. Page title "ホーム"
2. 要対応 (5 rows, each row two lines: 種類 + 件数 on the first, 最古の経過 + 遷移先 on the second)
3. 成果: the two hero metrics stacked vertically
4. 撤退判定パネル: each gate becomes a block of 3 lines (ゲート名 + 判定バッジ / 今の値 vs ライン / 一言の理由), keep the ok vs 未評価 difference obvious (dashed gray vs solid black); "最終算出 ... (JST)" at the end
5. 今月の枠と稼働 (plain text; `[新規出品を止める…]`)
6. 資源
7. 定期タスク (3 lines per task)
8. 商品の状態 (dense hairline list)
```

---

## 設計意図メモ（ChatGPT には渡さない）

- ホームは「判断の画面」。ヒーローは当月純利益と 1 商品あたり売上だけを大きくし、出品数は小さい文字の「当月の出品 N / 上限 M」に降格 (UR-1)。現行実装の「残り N 件」大表示を置き換える前提で描いた。
- 判定パネルは `ok` と `未評価` を形 (塗り四角 vs 点線円)・濃淡・数値欄 (`—`) の 3 重で描き分ける (UR-2 / UR-6)。「データが無いだけのゲートを大丈夫に見せない」が設計の肝なので gate-states.png を別枠で用意した。
- Stage 0 は「0」を出さず「—」+ 理由。判定パネルは全行未評価だが各行に「いつ始まるか」を書く。`ok` 表示ゼロ、予測月商ゼロ。
- 停止中は帯 (全画面) と停止中パネル (ホーム最上部) の 2 重で目立たせる。ただし**解除ボタンはどちらにも置かない**。解除は設定の奥 (S-3DP-06)。一方「新規出品を止める…」は軽い確認 1 回で効くボタンとして常設 (UR-4)。
- 描かないもの: 枠の進捗バー、予測月商、グラフ、行選択。
- 暫定判定 (G-B の「注意」) は §9.12-3 が未決のため、注記スロット「判定日前の暫定判定を含みます」を置くに留めた。
- 関連 UC: 運営者が朝開いて 10 秒で要対応と継続可否を確認する。
