# 09 — KDP 売上連携 設計 (F-038 拡張 / Phase 3 最重要課題)

> KDP から売上（ロイヤリティ・販売数・KENP 既読）を取得し `sales_records` に取り込む
> 仕組みの設計。取得方式は **Phase 1: 手動レポートアップロード → Phase 2: Playwright 自動DL**
> の段階実装。データ源は **KDP のダウンロードレポート (xlsx/csv)** に一本化する。

## 0. 背景と前提

- **KDP には売上 API が無い。** レポート画面は React の SPA（ダッシュボード）で、
  HTML に数値が構造化されて出ないため **HTML スクレイプは非現実的**（旧 `parseKdpSalesHtml`
  の `tr.report-row` 等の独自セレクタは実 KDP では空振りする）。
- **確実なデータ源＝KDP の「レポートのダウンロード」**（Excel/CSV）。生成レポートには
  〔タイトル / ASIN / マーケットプレイス / 販売数 / KENP 既読 / ロイヤリティ / 通貨〕が
  構造化されて含まれる。これをパースするのが唯一堅牢な方法。
- 既存資産（そのまま活かす）:
  - DB: `sales_records`（月次×書籍）、`sales_fetch_runs`（実行履歴, `2fa_waiting` 対応）、
    `kdp_2fa_codes`（2FA push-and-wait）、`accounts.kdp_credentials_enc`（暗号化認証情報）
  - UI: アカウント編集での KDP 認証情報入力、売上 KPI 画面（サマリ / トレンド / 実行状況）
  - Worker: `sales.fetch` タスク（実行履歴・復号・パース・ASIN→book_id・upsert の骨格）、
    `sales-fetch-dispatcher`、Playwright ログインコード（email/pw/TOTP/2FA 待受）
  - **唯一の欠落 = 実データ取得**。本設計はここを「レポートファイルのパース」に差し替える。

## 1. データモデル変更

`sales_records` に販売数・KENP を追加（現状 royalty しか保持していない）。

```prisma
model SalesRecord {
  // ...既存...
  royalty_jpy  Int      // 円換算・全マーケットプレイス合算の月次ロイヤリティ
  units_sold   Int      @default(0)  // 追加: 有料販売部数(返品控除後 net)
  kenp_read    Int      @default(0)  // 追加: KU/KOLL 既読ページ数
  review_count Int      @default(0)  // 商品ページ由来 (Phase で別取得。当面 0)
  avg_stars    Decimal? @db.Decimal(3,2) // 同上
  bsr          Int?                       // 同上
  source       String   // manual_upload | auto | manual
  // ...
}
```

- 本番マイグレーションは `ADD COLUMN IF NOT EXISTS`（冪等）。
- `source` の値を拡張: `manual_upload`（レポートアップロード）/ `auto`（Playwright 自動DL）/
  `manual`（手入力・将来）。

## 2. 取り込みの正規化ルール（共通コア）

Phase 1/2 とも、パース後は同じ正規化コア `packages/db` or `@a2p/contracts` の純関数を通す。

- **集約単位**: (ASIN, year_month)。マーケットプレイスを跨いで合算。
- **通貨換算**: レポートはマーケットプレイス通貨建て。JPY はそのまま合算。非 JPY 行は
  FX レートで円換算（USD は既存 `model_catalog.fx_rate_usd_jpy` を代表値に再利用。他通貨は
  当面 best-effort、未対応通貨は警告ログ＋その行スキップして合計から除外）。JP 単独運営では
  .co.jp が支配的なので実害は小さい。将来は日次 FX テーブルを導入。
- **ロイヤリティ内訳**: レポートのロイヤリティは「有料販売分」＋「KENP 既読分(KDP Select
  グローバル基金)」を含む。両方を合算して `royalty_jpy` にする。`kenp_read` はページ数を別途保持。
- **ASIN→book_id**: `books.asin` で解決。未知 ASIN の行はスキップ（warn ログ、throw しない）。
  ASIN 未設定の本は `kdp-asin-fetch` で先に埋める運用。
- **冪等**: (book_id, year_month) で upsert。再アップロードは最新値で上書き（`source` も更新）。

## 3. Phase 1 — 手動レポートアップロード（MVP・確実に今動く）

運営者が KDP でレポート(.xlsx/.csv)をDL → A2P にアップロード → パース → プレビュー確認 → 取込。

### 3.1 フロー
1. 売上画面（S-018 系）に「レポート取込」導線。アカウント + 対象年月 + ファイルを指定。
2. サーバアクション `importSalesReport`:
   - ファイル(xlsx/csv)を受け取り、全シートを走査。ヘッダ行を検出。
   - **ヘッダ駆動のカラムマッピング**（KDP の EN/JA ヘッダ表記ゆれに耐性）:
     - ASIN/ISBN: `ASIN`, `ASIN/ISBN`
     - 販売数: `Units Sold`, `Net Units Sold`, `注文数`, `販売部数`
     - KENP: `Kindle Edition Normalized Pages (KENP) Read`, `KENP Read`, `既読ページ数`
     - ロイヤリティ: `Royalty`, `ロイヤリティ`
     - 通貨: `Currency`, `通貨`
     - マーケットプレイス: `Marketplace`, `マーケットプレイス`
   - 自動判定に失敗した列は UI で運営者が手動マッピング。
   - 正規化コアで (ASIN, ym) 集約 → 円換算 → **プレビュー**（マッピング結果・行数・合計・未知
     ASIN 件数）を返す（この時点では DB 未反映）。
3. 運営者がプレビューを確認して「取込」→ `SalesRecord` upsert（`source='manual_upload'`）。
   `sales_fetch_runs` に手動取込の履歴も記録（status=done, records_upserted）。

### 3.2 実装単位（タスク）
- **T-KS-01** schema: `sales_records += units_sold, kenp_read`（Prisma + prod ALTER 冪等）。
- **T-KS-02** parser: `packages/agents` or `packages/db` に `parseKdpReportWorkbook(buffer)` を新設
  （`xlsx`/`exceljs` でシート走査 → ヘッダ検出 → 行抽出 → `KdpReportRow[]`）。純関数・Vitest。
- **T-KS-03** 正規化コア: `normalizeSalesRows(rows, {ym, fx})` → (book_id 解決前の) `NormalizedSalesRow[]`
  ＋合計・警告。純関数・Vitest。
- **T-KS-04** サーバアクション `importSalesReport`（preview モード / commit モード）。
- **T-KS-05** UI: 売上画面に「レポート取込」モーダル（ファイル選択 → プレビュー表 → 取込）。
- **T-KS-06** e2e: 代表的な xlsx/csv fixture で preview→commit→SalesRecord 反映。

### 3.3 なぜ手動先行か
認証情報保存もスクレイプ調整も不要で、**実 KDP データが即・確実に入る**。Phase 2 の自動化は
「同じパーサに流すファイルを、人間ではなくブラウザが取ってくる」だけの差分になり、パーサ・
正規化・UI プレビューを Phase 1 で作り切ることで自動化の土台が固まる。

## 4. Phase 2 — Playwright 自動ダウンロード（全自動）

既存ログインコード（`playwright-browser-port.ts`）を流用し、**HTML スクレイプではなく
「レポート生成→ファイルDL」**に作り替える。取得ファイルを Phase 1 と同じパーサ/正規化に流す。

### 4.1 変更点
- `browser-port.ts` の契約を `fetchReportHtml` → `downloadReportFile(): { ok, buffer, filename }`
  に拡張（HTML 版は互換のため残置可だが新経路は file を返す）。
- Playwright 手順: ログイン(2FA) → レポート画面 → 期間指定 → 「レポートを生成/ダウンロード」を
  クリック → `page.waitForEvent('download')` でファイル取得 → buffer 化。
- 2FA: TOTP 自動（`totp_secret` あり）/ 無ければ `kdp_2fa_codes` に待受を作り、運営者が UI で
  コード入力 → 再開（push-and-wait。既存 `2fa_waiting` フローを完走させる）。
- `sales.fetch` タスク: 取得 buffer を Phase 1 の `parseKdpReportWorkbook` → `normalizeSalesRows`
  → upsert に接続（`source='auto'`）。
- スケジュール: `sales-fetch-dispatcher` を日次（速報）＋月初（確定）で起動。KDP はロイヤリティが
  月次確定なので、当月は速報値・確定後に上書きする運用。

### 4.2 実 KDP 調整（実アカウント必須）
- レポート画面 URL / 期間セレクタ / ダウンロードボタンのセレクタは実アカウントで確定する。
  `saveDebugArtifacts`（screenshot+html を R2 保存）を活用してセレクタを詰める。
- Railway コンテナに Chromium 同梱（Dockerfile）。既に LAUNCH_ARGS で `--no-sandbox` 等を用意済み。

## 5. 観測性・失敗方針
- 全取込は `sales_fetch_runs` に記録（手動=`manual_upload` 起点でも履歴を残す）。
- パースは throw しない（部分成功）。未知 ASIN・未対応通貨・マッピング失敗はカウントして
  プレビュー/実行結果に表示。
- 取込結果は売上 KPI 画面（既存）に即反映。コスト×売上の損益は既存 KPI 集計を利用。

## 6. スコープ外（別途）
- レビュー数 / 平均星 / BSR は KDP レポートに無い（Amazon 商品ページ由来）。別スクレイプ機能
  として後日（`sales_records.review_count/avg_stars/bsr` は当面 0/null のまま）。
- 日次 FX テーブル（当面は代表レート）。

## 7. 申し送り（実装順）
1. T-KS-01 schema → T-KS-02 parser → T-KS-03 正規化コア（純関数＋テストを先に固める）
2. T-KS-04 アクション → T-KS-05 UI（preview→commit）→ T-KS-06 e2e
3. （Phase 2）browser-port を file DL に拡張 → `sales.fetch` を新パーサに接続 → 実 KDP 調整

## 8. 実装追補（2026-07-24 — 実 KDP レポート対応）

実アカウントのレポート実物に合わせ、パーサ／正規化を確定値・見込みの 2 系統に対応させた。

### 8.1 対応レポート形式（実物）
- **月別ロイヤリティ明細（Prior Month Royalties）= 確定値**
  - シート: `電子書籍のロイヤリティ`（有料販売ロイヤリティ）＋`既読 KENPC`（KENP ページ数＋**KENP ロイヤリティ金額**）
  - 月は各シート先頭の「販売期間 | 6月 2026」メタ行に入る（行の列ではない）
  - **ASIN 別 KENP ロイヤリティ金額が列として存在**するため、そのまま円で計上（按分不要）
  - `source='manual_upload'`（確定）
- **ロイヤリティ推定（Royalties Estimator）= 当月見込み**
  - シート: `概要`（月次合計）/`電子書籍のロイヤリティ`（月×ASIN 有料）/`既読 KENPC`（ページ数のみ・金額なし）等
  - 月は各行の日付列に入る
  - KENP ロイヤリティは ASIN 別に無いので、`概要` の月次合計（＝有料合計＋KENP 原資）から
    `KENP 原資 = 概要ロイヤリティ(JPY) − 有料ロイヤリティ合計` を求め、各書籍の KENP ページ数で**按分**して見込み計上
  - 当月は KENP 単価が Amazon 未確定のため原資 0 → 確定月の実効レートで推計計上する（§10。従来は ¥0 だった）
  - `source='manual_estimate'`（見込み）

### 8.2 バグ修正
- 「ロイヤリティ発生日」列を金額列と誤検出していた（`includes('ロイヤリティ')`）→ 金額列は**厳格一致**で判定。
- 月フィルタが無く複数月を 1 月に合算していた → `targetMonth` で対象月のみ集約。

### 8.3 優先度・表示
- 取込時、**見込みは確定値がある月を上書きしない**（確定 > 見込み）。確定は見込みを上書きする。
- KDP は API が無く KENP は月次確定のため、当月は見込み、確定後に確定値で上書きする運用。
- 売上 KPI に **KENP 読了ページ**を追加（サマリ「KENP読了(累計)」＋書籍別テーブル「KENP読了」列、今期併記）。
  見込み取込でも KENP ページは可視化される。

## 9. 自動取得 Phase 2 実装 (2026-07-24) — セッション再利用

Amazon はヘッドレス自動ログインを bot 検知でブロックしがちなため、**セッション再利用**方式を採用。

### 9.1 セッション取得 (初回・運営者が1回)
- `scripts/kdp-capture-session.mjs`: ヘッドフル Chromium で運営者が普段どおりログイン
  (Google 経由でも可)＋レポートを1回DL。ログイン状態(Playwright storageState)を
  `scripts/.kdp-session.json` に自動保存(数秒ごと・Enter不要・永続プロファイル)。
- 保存したセッションを AES-256-GCM で暗号化して `accounts.kdp_session_state_enc` に格納
  (鍵 `KDP_CRED_KEY`)。認証トークン `at-acbjp`/`x-acbjp` 等は 365〜400 日有効。

### 9.2 レポート DL (ワーカー・DOM操作不要)
実 KDP で判明した2段 GET を `context.request`(セッションCookie付き)で叩く:
1. `GET kdpreports.amazon.co.jp/download/report/pmr/ja_JP/pmrReport.xslx?selectedMonth=YYYY-MM&reportType=KDP_PMR`
   → JSON `{ requested, available, url:<S3署名URL> }`
2. `GET <S3署名URL>` → xlsx バイナリ
- `selectedMonth` で任意月を直接指定できる。S3 URL は48h有効・都度生成。
- セッション切れ判定: サインイン誘導/HTML/401,403 → `reason='session_expired'` を返し、
  運営者へ再キャプチャを促す。report 生成待ちは数回リトライ。

### 9.3 取込 (`runSalesFetch`)
- 復号セッション → `downloadReport` → `@a2p/kdp-report` で対象月を正規化 → ASIN 突合 →
  `sales_records` upsert(`source='auto'`, royalty/units/kenp)。
- **手動確定(`source='manual_upload'`)は自動で上書きしない**(運営者の手動取込を保護)。

### 9.4 スケジュール
- `sales.fetch.dispatch` cron(既定 02:00 JST)を `AppSettings.sales_auto_fetch_enabled=true`
  で有効化。JST基準で **前月(確定KENPロイヤリティの取込直し)＋当月(速報)** を日次 enqueue。
- 当月は KENP 単価が Amazon 未確定。ページ数は入り、KENP 金額は確定月の実効レートによる**推計**で計上(§10)。翌月に確定値へ上書き。

### 9.5 共有パッケージ
- `@a2p/kdp-report`(parse/normalize + xlsx)。web(手動アップロード)と worker(自動取得)で共有。
  web の `lib/kdp-sales/{parse,normalize}.ts` は互換シム(再エクスポート)。

### 9.6 自宅プロキシ経由アクセス(住宅IP) — anti-bot 回避
Railway のデータセンター IP から Amazon にログインすると、再認証(`max_auth_age=0`)で
CAPTCHA/停滞などの anti-bot に高確率で当たり、ヘッドレス自動ログインが完了しない。
対策として **worker の KDP アクセスを運営者の自宅回線(住宅IP)経由に切り替える**トンネルを用意する。

構成:
```
[自宅PC] scripts/kdp-home-proxy.mjs
  ├─ 認証付き HTTP プロキシ(CONNECT トンネル) 127.0.0.1:8899
  ├─ ngrok tcp 8899  → 公開アドレス host:port
  └─ app_settings.kdp_proxy_url に host:port を heartbeat 公開(60s毎, enabled=true)
        │
        ▼
[Railway worker] resolveKdpProxy(app_settings)
  └─ Playwright launch({ proxy: { server:'http://host:port', username, password }})
        → downloadReport / refreshKdpSession が住宅IPから Amazon にアクセス
```

- **認証情報は DB に置かない**。ユーザ/パスは env `KDP_PROXY_USER` / `KDP_PROXY_PASS`
  (Railway worker と自宅 `scripts/.kdp-proxy.env` で一致させる)。DB に載るのは ephemeral な
  ngrok アドレスのみ。
- **鮮度判定**: `kdp_proxy_updated_at` が 5 分より古い、または `kdp_proxy_enabled=false` の場合、
  worker は proxy を使わず**直結にフォールバック**(自宅PCを落とせば従来動作へ自動回帰)。
  → `resolveKdpProxy` / `buildProxyConfig`(`apps/worker/src/tasks/sales-fetch/kdp-proxy.ts`)。
- **AppSettings 追加列**: `kdp_proxy_enabled`(Boolean, 既定 false) / `kdp_proxy_url`(host:port) /
  `kdp_proxy_updated_at`(DateTime)。migration `20260730120000_kdp_home_proxy`。
- 起動: 自宅作業中に `node scripts/kdp-home-proxy.mjs` を常駐させる(Ctrl+C で DB を
  `enabled=false` に戻し worker は直結へ)。前提: ngrok 導入＋authtoken 設定済み。
- 適用範囲: レポート DL(有効セッションなら本来 Railway 直結でも通る)と再ログイン(anti-bot が
  かかる部分)の両方を proxy 経由に統一し、IP フィンガープリントの不一致を避ける。

## 10. 当月 KENP 推計 (2026-10-15 不具合修正)

### 10.1 不具合
当月の KENP ロイヤリティが ¥0 で計上され、売上を過少報告していた。
2026-10-15 実測: KDP ダッシュボード「今月」= 推計ロイヤリティ **¥3,211** / 注文 7 / 既読KENPC 2,770 に対し、
`sales_records` (2026-10) は **¥1,708**。差 ¥1,503 ≒ 2,770 頁 × 約 ¥0.54。

原因: KDP は当月の KENP 金額を**翌月 15 日頃まで確定しない**。ワーカーが取る PMR レポートは当月分で KENP の
ページ数のみ・金額列が空、かつ `概要` シート (Estimator 専用) が無いので按分 (§8.1) の原資も無い。
結果、`normalizeKdpRows` は KENP 金額を 1 円も計上しなかった。

### 10.2 修正方針
- **確定月の実効レートで推計する。** `実効レート = 確定月の KENP 収益 ÷ KENP ページ数` (円/頁)。
  定数は焼き込まない (KDP が単価を変えても確定月が更新されれば追従)。**確定月が 1 つも無ければ推計せず 0 のまま**
  (既定レートは置かない)。
- レートの根拠は「対象月より前で最新の確定月」(下記ガードを通過したもの)。候補は (a) DB `sales_records` の `kenp_royalty_jpy ÷ kenp_read`
  (推計行は除外。ワーカー/手動取込が使う)、(b) 同一レポート内の他の確定月 (明細に KENP 金額 or 概要サマリ按分)。
  より新しい月を採用する。
  DB 側の導出は**アカウント横断**で集計する (単一運営者・同一 KDP 単価のため。アカウント別に分けると新規アカウントでサンプル不足になる)。実装は `packages/kdp-report` の `deriveKenpRate` / `deriveKenpRateFromRecords`。
- **妥当性ガード** (`deriveKenpRate`)。不正な根拠月が架空売上を作らないよう、次の月は根拠にせず**次に古い確定月へフォールバック**し、全滅なら `null` (推計しない):
  - レートが **0.1〜1.0 円/頁** の外。根拠: 実測で単月レートは ±46% ぶれる (2026-06 = 0.371、2026-10 の逆算 = 約 0.5426。2026-07 は当月で導出不可)。
    上限 1.0 は観測最大 (0.5426) の約 1.84 倍で、KDP が単価を倍増しても耐える。2.0 だと誤りの最悪ケースが ¥5,540 (真値 ¥1,503 の 2.26 倍)、
    1.0 なら ¥2,770 (1.39 倍) に収まる。誤って弾いても結果は「推計しない = 修正前の挙動」で安全なため、絞る側に倒した。
  - **相対チェック**: 他の候補レートの最小値の **3 倍超** は不採用 (按分由来レートへの PB ロイヤリティ混入の吸収。DB と同一レポート内の候補の間でも比較する)。
  - **直接渡された `kenpRate` (`NormalizeOptions`) にも同じ帯・相対チェックを強制する** (`isPlausibleKenpRate`)。帯外は無視してレポート内の確定月へフォールバックする。
  - 根拠月の KENP ページ数が **100 頁未満** (少数ページのレートは分散が大きい)。
  - 収益またはページが 0。
- **優先順位**: 明細に KENP 金額がある月 (`detail`) > 概要サマリ按分由来の月 (`allocated`)。按分由来は、より新しくても明細月に劣後する
  (DB 行は `source='manual_estimate'` = Estimator 取込を按分由来とみなす)。
  - **未検証の前提 (リスク)**: 按分の原資は `pool = 概要ロイヤリティ − 有料合計` で、「概要にあって電子書籍有料シートに無い収益」を全部 KENP とみなす。
    全書籍がペーパーバック展開済み (PB 価格 ¥1,480) のため、概要に PB ロイヤリティが含まれていればレートが系統的に過大になり、当月売上を構造的に盛る。
    実データでは確認できていないので、コードでは断定せず「優先順位 + 帯ガード」で吸収している。
    (2026-10-15 追記: 4 シート構成の実データでは PB シートが 0 行・按分も走っていないため**現状は起きていない** (§10.6)。将来 PB が売れたら再評価する。)Estimator 実物で概要の内訳を確認するまで按分由来レートは最後の手段。
- **推計は「KENP が確定できない月」にだけ適用**: 明細に KENP 金額が無く、かつ概要サマリ按分も得られなかった
  (サマリ無し or 原資 0) 月。配分は KENP ページ数比の最大剰余法 (合計 = 総ページ × レートの丸め)。

### 10.3 推計と確定の区別 (DB / UI)
- `sales_records` に 2 列を追加 (migration `20261015000000_sales_kenp_estimate`)。いずれも `royalty_jpy` の内数。
  - `kenp_royalty_jpy`: KENP **確定**分 (レート導出の根拠)。
  - `kenp_royalty_estimated_jpy`: KENP **推計**分。`> 0` なら推計を含む。
- **確定値で上書きされる**: 取込 (worker upsert / 手動取込) は常に両列を書き直すため、翌月 15 日頃に
  明細金額 or 概要按分が得られると推計列は 0 に戻る。
- **確定値を推計で上書きしない**: 既存行に `kenp_royalty_jpy > 0` があり、新しい行が推計なら worker/手動取込とも書き込まない。
  `PROTECTED_SOURCES`(`manual` のみ、自動取得は上書きしない) の方針とは独立に併存する。`manual_upload` は従来どおり
  worker が上書きしてよい権威データ源で、推計だけが確定を上書きできない。
  手動取込は推計を含む場合、`report_kind` に関わらず `source='manual_estimate'` で保存する。
- **手入力**(`/sales/manual` の単票・CSV、KDP ロイヤリティ取込) は運営者確定なので、create/update とも `kenp_royalty_estimated_jpy=0` かつ `kenp_royalty_jpy=0` を書く
  (`kenp_royalty_jpy` も 0 にするのは、金額を差し替えた行を実効レート導出の根拠に残さないため)。`source='manual'` は自動取得で上書きされないので、
  内訳を残すと嘘の「うち推計」が恒久化する。
- UI (S-002 ホーム): 当月純利益ヒーローの「売上」と指標行の当月売上に「(うち KENP 推計 ¥N)」を併記 (推計が 0 なら出さない)。
- 手入力で上書きした月は実効レートの根拠から外れる (`kenp_royalty_jpy=0`)。確定月が手入力のみなら推計は出ない → §10.5 ② の取り直しが必要。
- UI (S-017 売上): 累計売上カードに「うち KENP 推計 ¥N（翌月15日頃に確定）」、書籍別テーブルは**月次売上・累計売上の双方**に
  「(うち推計 ¥N)」、レポート取込プレビューに推計額と根拠月・レートを表示する。
  集計は `packages/db/src/books-kpi.ts` が `monthly/cumulative_kenp_estimated_jpy`、`total_kenp_estimated_jpy` を返す。
- 注意: 推計は `royalty_jpy` に含まれるため、売上を参照する他の集計 (損益・ROI) にも推計が入る。
  確定時に自動で置換される。

### 10.4 KENP ページ数が KDP ダッシュボードの約 2 倍になる件 (解決: §10.6)
同日の実測で `kenp_read` 合計 5,467 vs ダッシュボード 2,770 (約 1.97 倍)。当初の 2 仮説は次のとおり決着した。
- 仮説「同一月に KENP 系シートが 2 枚以上」: **外れ**。実際は「有料シート + 統合シート `総収益`」の組が、同じ ASIN×マーケットプレイスの行を別シートで二重に持っていた。
- 仮説「同一 ASIN×マーケットプレイスの行が重複」: **当たり**。本番ログ `duplicateExamples[].crossSheet=true` で確認 (別シート由来の二重計上)。
  さらに `総収益` の「実質販売件数または既読 KENP」列を常にページ数として読み、有料行の部数をページに足していた (9 月で +18 頁)。
- 修正は §10.6: 4 シート構成では `総収益` だけを正とし、他シートは集計しない。パース診断 (`sheetDiagnostics`/`duplicateExamples`/`kenpDiagnostics`/`layout`) は調査完了後も残す
  (`countDuplicateKeys` の `max` は重複なしのとき 1。`duplicateKeyCount=0` なら重複なし)。統合シート採用後も `duplicateKeyCount` が出る場合は同一シート内の別行 (種類違い等) か要再確認。

### 10.5 適用後の立ち上げ手順 (migration 後。実態に合わせた更新は §10.7)
マイグレーションは既存行を 0 埋めする (`kenp_royalty_jpy=0`) ため、**適用直後は確定月サンプルが 1 件も無く、推計は発生しない**
(当月 KENP は従来どおり ¥0。仕様どおり: 確定月が無ければ推計しない)。

- worker のレポート DL は月単位スコープ (`playwright-browser-port.ts` の `selectedMonth={ym}`) で、1 回の取得に対象月の行しか含まれない。
  よって **worker 経路ではレポート内の他確定月からレートを導出する経路は発火せず、レート源は DB (`sales_records`) のみ**。
  (レポート内導出が効くのは、複数月を含む手動アップロードのみ。)
- 手順: ① マイグレーション適用 → ② **前月を 1 回取り直す** (`sales.fetch` を前月で enqueue。確定済みなら明細の KENP 金額が `kenp_royalty_jpy` に入る)
  → ③ 以降は日次取得 (前月＋当月) で自走し、当月は DB の前月以前の確定月レートで推計される。
- 前月がまだ未確定 (翌月15日前) の場合は前月も推計扱いになり、さらにその前の確定月のサンプルが必要。必要なら過去月も取り直す。

### 10.6 実レポート 4 シート構成と二重計上 (2026-10-15 本番ログで確定)
2026-09 の再取得で出した `sheetDiagnostics` により、§10.1 の原因 2 つと §10.4 の 2 仮説が**実データで確定**した。

**4 シート構成 (現行の月別ロイヤリティ PMR)**

| シート | 中身 | ASIN 別 | 金額列 |
|---|---|---|---|
| `電子書籍のロイヤリティ` | 有料販売。ヘッダ: 注文数/払い戻し数/実質注文数/ロイヤリティの種類/…/通貨/ロイヤリティ | 〇 | 〇 (ロイヤリティ) |
| `既読 KENPC` | KENP ページ数のみ (ヘッダは 4 列: タイトル/著者/ASIN/マーケットプレイス/既読 KENP) | 〇 | **無し** |
| `ペーパーバックのロイヤリティ` | PB 販売 (9 月は 0 行) | 〇 | 〇 |
| `総収益` | **統合シート**。有料行と KENP 行の両方を持つ。ヘッダ: …/`実質販売件数または既読 KENP`(6)/`ロイヤリティの種類`(7)/`支払いプラン`(8)/`通貨`(9)/…/`収益`(14) | 〇 | 〇 (**`収益`**) |

- `総収益` の index 6 は**行種別で意味が変わる列**: 有料行では実質販売件数 (部数)、KENP 行では既読ページ数。行種別は `ロイヤリティの種類` で決まる
  (有料行は `70%` 等の % 表記)。KENP 行の種類の実表記は未確認 → 判定は「KENP/既読/Unlimited 系の語 → KENP、% 表記 → 有料、
  どちらでもなければ注文数列が 0 なら KENP」とし、`sheetDiagnostics[].typeValues` に実際の値を残す (次回ログで確認)。
- 9 月の実測: `電子書籍` 部数 18 / ¥1,230、`既読 KENPC` 5,045 頁、`総収益` は 42 行 (有料 7 + KENP 35)。

**原因 1 — KENP 収益が一度も取れていなかった**: `既読 KENPC` に金額列が**そもそも無い**。KENP 収益の金額は `総収益` の `収益` 列にだけある。
旧パーサは `収益` を金額列と認識せず (語彙は `ロイヤリティ` 系のみ)、`総収益` の `royalty` が未マップ → 全シートで KENP 金額 0 だった。
(§10.6 初版の候補 1「9 月分が未確定」と候補 3「PB 混入で pool≤0」は外れ。`summaryFound=false` で按分は走らず、PB シートは 0 行。)
→ 過去月も含め、**自動取得では KENP 収益が一度も計上されていなかった**。

**原因 2 — 二重計上 (ページ数・部数 2 倍)**: `総収益` は他シートと同じ数字を持つ重複シート。旧パーサは 4 シートを全部足していた。
- KENP ページ: `既読 KENPC` 5,045 + `総収益` 5,063 = 10,108 (= 旧値)。`5,063 − 5,045 = 18` は**有料行の部数 18 を KENP ページとして足した分**
  (index 6 を常に `kenp_read` にマップしていた)。
- 部数: `電子書籍` 18 + `総収益` 18 = 36 (= 旧値)。
- 重複キー例: `B0FVL9HDBB|Amazon.co.jp|2026-09|paid` が `電子書籍`(部数 1 / ¥279) と `総収益` の 2 行 (部数 1, kenp 1 と kenp 459) で 3 行 = **別シート由来 (`crossSheet:true`) の二重計上**。
  §10.4 の 2 仮説のうち「行の重複」が正解。「KENP 系シートが 2 枚以上」ではなく、有料シート + 統合シートの組。
- 10 月の旧値 (5,467 頁 / 部数 10) も同じ構造 (KDP ダッシュボードは 2,770 頁 / 注文 7)。

**修正 (確定事実に基づく)**
- `収益` をロイヤリティ金額列として認識 (`isRoyaltyAmount`)。`ロイヤリティの種類` 列を `royalty_type` としてマップ。
- **統合シート判定**: `role=combined` かつ `royalty_type`・金額列・二重意味列 (`kenp` と `販売/注文` を含むヘッダ) を全て持つシート。
  1 枚でもあれば `layout='unified'`: **このシートだけを正とし、他の ASIN 別シートは重複なので集計しない** (`sheetDiagnostics[].superseded=true`)。
  無ければ `layout='legacy'` (従来の 2 シート/Estimator/単一シート)で全シートを従来どおり集計。判定根拠は worker ログの `layout`・`sheetDiagnostics` に出る。
- 統合シートの行は `ロイヤリティの種類` で有料/KENP に振り分け、index 6 の値を 有料=部数・KENP=ページ に入れ分ける。`収益` は有料行は有料ロイヤリティ、KENP 行は KENP 確定収益 (`royalty_kind='kenp'`)。
- 回帰テスト (`packages/kdp-report/__tests__/layouts.test.ts`): 4 シート合成 (9 月: 部数 18 / 5,045 頁 / ¥1,230 + KENP 収益、10 月: 注文 7 / 2,770 頁 / ¥3,211) と
  従来 2 シート (実物 2026-06・07 + 合成)。9 月・10 月の数値は KDP ダッシュボードとの答え合わせ値。
- `総収益` の金額が 4 シートで他と食い違わないか (例: `総収益` の有料 `収益` 合計 vs `電子書籍` の `ロイヤリティ` 合計 = 9 月 ¥1,230) は、
  次回ログの `sheetDiagnostics[].sums` (superseded シートの合計も出る) で突き合わせる。PB 行が `総収益` に含まれるかも未確認 (9 月は PB 0 行)。

**§10.2「PB 混入でレート過大」について**: 4 シート構成の実データでは PB シートが 0 行で、按分 (概要サマリ経路) も走っていない。よって**現状の実データでは起きていない**。
ただし `総収益` の KENP 行は ASIN 別の確定金額を直接持つので、そもそも按分に頼らない。将来 PB が売れた場合に `総収益` へ PB 行がどう載るかを再評価する。

### 10.7 立ち上げ手順の更新 (§10.5 の実態反映)
- パーサ修正後は `総収益` の `収益` から **過去月の KENP 確定収益を取得できる**。したがって立ち上げは「確定済みの前月 (2026-09) を再取得」で完了する:
  `sales.fetch` を 2026-09 で enqueue → `kenp_royalty_jpy` が埋まる (9 月は ¥1,230 + KENP 収益) → 以降の日次取得 (前月 + 当月) で 10 月が確定月レートで推計される。
- 既に旧パーサで取り込んだ過去月 (旧: 二重計上の部数・ページ数・KENP 収益 0) は**誤った値のまま**なので、取得可能な月を全て取り直して上書きすること
  (`source='auto'` の行は上書きされる。`manual` は保護される)。
- 取り直し後、2026-10 は 注文 7 / 2,770 頁 / ¥3,211 近傍 (KDP ダッシュボード) と一致するか確認する。
