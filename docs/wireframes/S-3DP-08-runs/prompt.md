# S-3DP-08 実行状況 — ChatGPT ワイヤーフレーム生成プロンプト

## 画面情報
- 画面 ID: S-3DP-08
- 画面名: 実行状況 (`/runs`)
- 対応機能 ID: F-3DP-14, 18, 23, 31, 36, 39, 46
- 元設計書: `docs/12-3dp-design.md` §9.8 S-3DP-08 / §9.6.3 / §9.7 #1, #2, #14 / §9.13-9
- 想定画像:
  - `desktop.png` — 標準ビュー (定期タスク 5 行 + 滞留 + 実行履歴 + 一部失敗の展開行)
  - `empty.png` — **実行履歴 0**。それでも定期タスクの表は全行出る
  - `mobile.png` — モバイル 1 カラム

## ChatGPT 使い方
1. ChatGPT (GPT-4o / 画像生成有効) を開く
2. 下記「共通プロンプト」と任意の「{バリアント} プロンプト」を結合してコピー
3. ChatGPT に貼り付けて画像生成
4. 出力 PNG を本ディレクトリに上記ファイル名で保存

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
- Left sidebar (240px on desktop; hamburger only below tablet width): section "メニュー": ホーム / 商品 / 承認 (with count badge e.g. "3") / リサーチ ; section "分析": 損益と原価 ; section "システム": 実行状況 (a small "●" mark only when something is abnormal) / 設定 (a small "■" mark only while new listings are stopped). The current screen's item is highlighted (filled black). On this screen "実行状況" is highlighted AND shows the small "●" abnormality mark (no number).
- Directly under the header, a thin full-width "stop band" appears ONLY when new listings are stopped (not in this image unless stated).

Result words used on this screen — each has a distinct shape + word:
- 成功 = ✓ ; 一部失敗 = half-filled square "◧" bold ; 失敗 = solid black square with ✕, bold ; スキップ (フラグ OFF) = hyphen "－" in light gray (NOT a failure) ; 実行中 = "…" ; 一度も実行されていません = dashed outline "?" in light gray, italic ; 予定を過ぎています = bold text with "▲"
```

---

## desktop.png プロンプト

```
Layout: 1440 x 2000 pixels (tall page allowed), desktop browser view. Header and sidebar per the common prompt. Single main column, max width about 1040px, sections separated by hairlines.

Page header: title 「実行状況」; caption 「定期タスクは動いているか、動かなかったのか、なぜ失敗したのかを読む画面です。」

### Section 1: 定期タスク  (ALL 5 registered tasks are always listed, even if never run)
- Table columns: 名称 / 周期 / 次回予定 (JST) / 最終実行 (JST) / 最終結果 / 最終成功 (JST) / 有効フラグ / 操作
- 5 rows:
  1. 週次リサーチ / 毎週 / 2026-10-19 03:00 / 2026-10-12 03:00 / ◧ 一部失敗 / 2026-10-05 03:00 / 有効 (toggle-style label 「有効 ／ 無効」) / `[今すぐ実行]`
  2. 企画の日次作成 / 毎日 / 2026-10-16 03:30 / 2026-10-15 03:30 / － スキップ (フラグ OFF) / — / 無効 / (no run-now button; light-gray text 「手動実行はできません」)
  3. 売上の日次取得 / 毎日 / 2026-10-16 04:10 / 2026-10-15 04:10 / ✓ 成功 / 2026-10-15 04:10 / 有効 / `[今すぐ実行]`
  4. 公開状態の確認 / 毎日 / 2026-10-16 04:05 / 2026-10-15 04:05 / ✓ 成功 / 2026-10-15 04:05 / 有効 (read-only label 「この画面では変更できません」, no toggle) / `[今すぐ実行]`
  5. ゲートの日次スナップショット / 毎日 / **2026-10-12 04:20** / — / ? 一度も実行されていません / — / (no flag; 「常時」) / `[今すぐ実行]` ; the 次回予定 cell is bold with 「▲ 予定を過ぎています」 (the scheduled time passed 3 days ago and it never ran)
- Note under the table (small): 「フラグを切り替えても再起動は不要です。次の実行時にタスク内でフラグを見ます」
- Row 2's flag label has a small quiet toggle `[無効 → 有効にする]` style button (outlined). Only rows 1, 2, 3 have a flag toggle.
- No checkboxes in the table.

### Section 2: 滞留
- Title 「滞留」 and caption 「生成中・検査中のまま 24 時間以上動いていない商品」
- Hairline list of 2 rows: 商品名(link) / 状態 (生成中) / 動いていない時間 (31 時間) / 最終ジョブ 「Meshy 生成: 実行中」 ; 商品名 / 検査中 / 26 時間 / 「検査: 失敗」
- (If none: a single line 「滞留している商品はありません」 — not drawn here.)

### Section 3: 実行履歴
- Title 「実行履歴」 with caption 「直近 100 件」
- Pill filter chips: (すべて — selected) (失敗) (一部失敗) (実行中)
- Table columns: 開始 (JST) / タスク / 商品 / 所要 / 結果 / 理由 ; 10 rows, e.g.
  - 2026-10-15 03:30 / 企画の日次作成 / — / 1 秒 / － スキップ (フラグ OFF) / 「フラグが無効のため実行しませんでした」
  - 2026-10-15 04:10 / 売上の日次取得 / — / 12 秒 / ✓ 成功 / —
  - 2026-10-15 04:05 / 公開状態の確認 / — / 41 秒 / ✓ 成功 / 「5 商品を確認」
  - 2026-10-15 03:20 / Meshy 生成 / 星型ピアスセット / 6 分 / … 実行中 / —
  - 2026-10-14 22:41 / 検査 / 月のペンダント / 2 秒 / ✕ 失敗 / 「三角形が多い 31,402 / 上限 7,500」
  - 2026-10-12 03:00 / 週次リサーチ / — / 4 分 / ◧ 一部失敗 / 「4 種別中 1 件失敗」 with a `▾` expander (this row is EXPANDED, see below)
  - and 4 more ordinary rows (成功 / 失敗 / 成功 / 成功)
- Expanded detail under the 週次リサーチ row (indented, hairline-bounded): 
  - Result summary: 「種別 4 ・ 更新 3 ・ 失敗 1」
  - Failure list (item-level): 「種別: BOOTH 公開データ — 理由: ページを取得できませんでした (タイムアウト)。ほかの種別は続行しました」
  - A second line: 「Web 検索なしで実行 (Tavily キー未設定)」
  - A collapsed `▸ 技術情報 (エラーコード)` — collapsed; no raw codes shown
- 時刻 column shows JST; header note 「時刻はすべて JST」.
```

---

## empty.png プロンプト（実行履歴 0）

```
Layout: same as desktop.png, but the history is empty and nothing has ever run. The sidebar item "実行状況" is highlighted WITHOUT the "●" mark (no abnormality yet; but see 不発 below).

### Section 1: 定期タスク — STILL lists all 5 rows (the rows do not disappear when history is empty)
- Every row: 最終実行 「—」, 最終結果 「? 一度も実行されていません」 (light gray, italic), 最終成功 「—」
- 次回予定 shows a real upcoming JST time for each; none is overdue
- Flag columns as in desktop.png (週次リサーチ 有効, 企画の日次作成 無効, 売上の日次取得 有効, 公開状態の確認 read-only 有効, ゲートの日次スナップショット —)
- A caption under the title: 「登録されている定期タスクをすべて表示しています。実行履歴が無くても行は消えません」

### Section 2: 滞留 — single line 「滞留している商品はありません」

### Section 3: 実行履歴 — filter chips shown but all disabled/light gray; message 「まだ実行履歴はありません」 (NOT an empty table frame).
```

---

## mobile.png プロンプト

```
Layout: 375 x 812 pixels per screen; render as a tall scrolling page, single column, desktop.png content. Header with hamburger (narrow width only); sidebar hidden.

1. Title 「実行状況」
2. 定期タスク: each of the 5 tasks as a 4-line block separated by hairlines — 名称 + 結果 / 周期 ・ 次回予定 / 最終実行 ・ 最終成功 / 有効フラグ + `[今すぐ実行]`; the overdue task shows 「▲ 予定を過ぎています」 in bold; the never-run task shows 「? 一度も実行されていません」
3. 滞留 (2 rows)
4. 実行履歴: pill chips as a horizontally scrollable row; each history entry as a 3-line row (開始 + タスク / 結果 / 理由); one 一部失敗 entry expanded showing the item-level failure reason
```

---

## 設計意図メモ（ChatGPT には渡さない）

- 「一度も実行されていない cron が見える唯一の画面」(F-3DP-46)。定期タスク表は**履歴から作らず、コード側の登録一覧から全行出す**ため、empty.png でも 5 行が残る。履歴から作ると不発 (行が存在しない) が見えない (promotion-dispatch 3 週間停止の教訓)。
- 結果の語彙は 6 種 (成功 / 一部失敗 / 失敗 / スキップ(フラグ OFF) / 実行中 / 一度も実行されていません) を形と言葉で描き分け、**スキップを失敗と取り違えない**こと (台帳 #14)。「予定を過ぎています」は太字 + ▲ で別扱い。
- 一部失敗は展開すると項目単位の理由 (台帳 #1/#2)。コードは展開の奥。
- 公開状態の確認のフラグは**この画面では変更不可**(読み取りのみ)。止めにくくするため。企画の日次作成は credit を消費する生成に流れるので「今すぐ実行」を出さない。
- フラグ切替の注記「再起動は不要」はフラグが効かない罠の再発防止。
- 描かないもの: チェックボックス、一括実行、グラフ。
- 関連: ナビの「●」は件数なしの異常印。どの画面からでも実行状況の異常に気付けるようにする (§9.4)。
