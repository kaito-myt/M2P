---
name: project-kdp-sales
description: KDP連携(最重要課題)—売上取得の設計と段階実装の進捗
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-02T02:22:35.542Z
---

KDP連携の第一歩＝**売上取得**。KDPは売上APIが無く、レポート画面はSPAでHTMLに数値が出ないため、**確実なデータ源＝レポートのダウンロード(xlsx/csv)をパースする方式**に決定。設計は `docs/09-kdp-sales-integration.md`。

**方針(ユーザー決定, 2026-07-23):** 取得方式=両方を段階実装(Phase1手動アップロード→Phase2 Playwright自動DL)。データ範囲=ロイヤリティ＋販売数＋KENP。

**Phase1(出荷済 2026-07-23, 実レポート対応 2026-07-24):** 運営者が売上画面「レポート取込」でxlsx/csvをアップ→対象年月選択→ASIN突合→`sales_records`へupsert。実KDPレポート2形式に対応:
- **月別ロイヤリティ明細(Prior Month Royalties)=確定値** `source='manual_upload'`。`既読KENPC`シートにASIN別KENPロイヤリティ**金額列**があり按分不要。月は「販売期間|6月 2026」メタ行から。
- **ロイヤリティ推定(Estimator)=当月見込み** `source='manual_estimate'`。KENP金額はASIN別に無いので`概要`月次合計(=有料+KENP)から `KENP原資=概要JPY−有料合計` をページ数**按分**。当月はKENP単価未確定→原資0→¥0(翌月確定値で上書き)。**見込みは確定を上書きしない**(確定>見込み)。
- バグ修正: 「ロイヤリティ発生日」を金額列と誤検出→厳格一致に。targetMonth月フィルタ追加(旧実装は全月合算)。
- 売上KPIに**KENP読了ページ**追加(サマリ「KENP読了(累計)」+書籍別テーブル列, 今期併記, `books-kpi.ts`集計)。見込みでも可視化。
- `apps/web/lib/kdp-sales/{parse,normalize}.ts`(SheetJS, シート役割判定, 月抽出`parseMonth`, 按分), `app/actions/sales-import.ts`, `components/sales/sales-report-import.tsx`。実物=`c:/work/Downloads/KDP_Prior_Month_Royalties-*.xlsx` / `KDP_Royalties_Estimator-*.xlsx`。

**Phase2(実装済 2026-07-24, セッション再利用方式):** Amazonのbot検知回避のため、初回のみ運営者が手動ログインしてログイン状態(Cookie)を保存→ワーカー再利用。
- **セッション取得:** `scripts/kdp-capture-session.mjs`(ヘッドフル・自動保存・Enter不要・永続プロファイル)→`scripts/.kdp-session.json`(gitignore秘密)。暗号化(`KDP_CRED_KEY`, AES-256-GCM)して `accounts.kdp_session_state_enc`(本番ALTER済・宮田海斗アカウントに保存済 enc_len=15308)。認証Cookie `at-acbjp`/`x-acbjp` は365-400日有効。ヘッドレスでも有効を確認済。
- **DL(DOM操作不要・2段GET):** `context.request.get('kdpreports.amazon.co.jp/download/report/pmr/ja_JP/pmrReport.xslx?selectedMonth=YYYY-MM&reportType=KDP_PMR')`→JSON`{url:<S3署名URL 48h有効>}`→`GET url`→xlsx。selectedMonthで任意月指定可。実KDPで実証済(probe)。
- **実装:** 共有パッケージ `@a2p/kdp-report`(parse/normalize; webは互換シム)。`apps/worker/src/tasks/sales-fetch.ts`(runSalesFetch刷新: session→downloadReport→対象月正規化→ASIN突合→upsert source='auto'; **manual_uploadは上書きしない**; session_expired/no_session検知)。`sales-fetch/{browser-port,playwright-browser-port}.ts`(downloadReport)。旧HTMLパーサ削除。
- **cron:** `sales.fetch.dispatch`(02:00 JST)、`AppSettings.sales_auto_fetch_enabled`で有効化。JST基準で前月(確定KENP取込直し)+当月(速報)を日次enqueue。当月KENP金額はAmazon未確定で¥0(翌月上書き)。
- **本番検証済(2026-07-24):** 手動enqueueで2026-06をauto取得→4冊が`source='auto'`でKENP売上込み(¥90/54/42/41)にupsert成功。`AppSettings.sales_auto_fetch_enabled=true`有効化済(cronは次のworker再起動で発火)。
- **デプロイ注意:** 新workspace package追加時は `apps/worker/Dockerfile` の deps ステージに `COPY packages/<name>/package.json ...` を追加しないと本番でERR_MODULE_NOT_FOUNDクラッシュ(kdp-report+xlsxで発生・修正済)。セッション切れ時は運営者が capture スクリプト再実行→再暗号化保存。

**自宅プロキシ経由アクセス(住宅IP, 出荷 2026-07-30, commit c0d8489):** Railwayのデータセンター IP だと Amazon 再認証が anti-bot(CAPTCHA/停滞)に当たりヘッドレス自動ログインが完了しない問題への恒久対策。worker の KDP アクセスを運営者の自宅住宅IP経由に切替可能にした。
- **自宅側:** `node scripts/kdp-home-proxy.mjs` を常駐(自宅作業中)。認証付きHTTP CONNECTプロキシ(127.0.0.1:8899)+ `ngrok tcp 8899` + ngrok公開アドレスを `app_settings.kdp_proxy_url` に60s毎heartbeat公開(enabled=true)。Ctrl+Cで enabled=false に戻し worker は直結へ自動回帰。設定=`scripts/.kdp-proxy.env`(gitignore, DATABASE_PUBLIC_URL/KDP_PROXY_USER/PASS)。
- **worker側:** `resolveKdpProxy/buildProxyConfig`(`apps/worker/src/tasks/sales-fetch/kdp-proxy.ts`)が AppSettings 読取+heartbeat鮮度(5分)判定。有効かつ新鮮なら `chromium.launch({proxy})` で downloadReport/refreshKdpSession を住宅IP経由に。古い/無効なら直結フォールバック。認証はenv `KDP_PROXY_USER/PASS`(Railway A2P-Worker設定済, 生成値=kdp_f1f3a4e3)、DBにはephemeralなngrokアドレスのみ。
- **AppSettings追加列:** `kdp_proxy_enabled`/`kdp_proxy_url`/`kdp_proxy_updated_at`(prod ALTER済, migration 20260730120000)。
- **前提(運営者の1回設定):** ngrok導入(`winget install Ngrok.Ngrok`)+`ngrok config add-authtoken <token>`。ngrok.exe実体=`C:\Users\miyat\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_*\ngrok.exe`。詳細=docs/09 §9.6, runbook §6.5。検証: 認証付きプロキシのHTTPSトンネル+DB publish/disableをローカル実証済。→ [[reference-kdp-publish-authwall]] のサーバ完全自動不可という制約を「住宅IP経由なら回避可能」に更新する余地。

**本棚↔DB ドリフト是正 + ASIN自己修復 backfill (2026-08-02, commit b5ce68a):** 運営者依頼「KDP本棚を確認して出版本一覧(/shop)を構成」で本棚をREAD-ONLY全件スキャン→突合したところ **DBが実本棚から二重に乖離**していた: (1) DBで`submitted`の9冊は実は既に**販売中**だが ASIN未記録で`/shop`未掲載、(2) DBで`published`の14冊は実は本棚で**アーカイブ(下書き)=販売停止**なのに`published`のまま掲載。原因=`kdp.publish.status.sync`が`submitted→published`昇格はするが**ASINをbackfillしない**設計だった(＋一部は昇格自体も未実行)。`/shop`(`apps/web/app/shop/page.tsx`)は`publish_status='published' AND asin IS NOT NULL`が掲載条件なので ASIN無いと永遠に載らない。
- **是正**: 本棚を真実としてDB更新=販売中19冊にASIN backfill+`published`化、非販売15冊を`retracted`化。結果`/shop`=実販売中19冊に一致(全冊採用表紙あり)。
- **恒久修復(コード)**: `readBookStatus`が本棚行から`ASIN:(B0…)`を抽出し`ReadBookStatusResult.asin`で返す→`kdp.publish.status.sync`がlive昇格時、`Book.asin`がnullなら同時にbackfill(既存asin不上書き)。以後は自動追従。テスト14件緑。docs/05 §5.3.19更新。
- **本棚全件スキャン手順(再現)**: `accounts.kdp_session_state_enc`をKDP_CRED_KEY(hex64, AES-256-GCM: iv12|tag16|ct base64)で復号→playwright headless(`railway run --service A2P-Worker`でKEY注入)→`kdp.amazon.co.jp/ja_JP/bookshelf`→`#podbookshelftable-records-per-page-dropdown-option`を`50 冊/ページ`に→各行`button[id$="-other-actions-announce"]`(id内`live-book-actions`=live)の詳細カラムから`ASIN:`とステータス(販売中/レビュー中/下書き)抽出、`#podbookshelftable_view_input-option`=`アーカイブ済みの本`でアーカイブ確認。※行のタイトルは詳細カラムに無く別サブツリー→ASIN+スクショ順でDB照合が確実。
- **孤立本**: `AI副業で月5万円 会社を辞めずに手取りを増やす方法`(B0FVF8QWZ5, 2025/10出版)は本棚では販売中だがDBに書籍レコード自体が無い(初期手動出版と推測)→表紙も無く`/shop`に載せられない。要判断(レコード新規作成 or 放置)。

**売上自動再ログイン(LINE OTP)が発火しない不具合 修正+実証 (2026-08-02, commit 414f89e):** 運営者報告「売上取得できない。売上取得→6桁をLINEで要求→ログインの流れじゃないの?」。sales_fetch_runsは7/30 08:00以降ずっと`session_expired`(`download endpoint returned auth challenge status=200`)で失敗、かつ**kdp_sales_relogin(LINE OTP)が全く作られていなかった**。**根本原因**: 保存セッションは本棚(kdp.amazon.co.jp)のbrowseには有効だが、レポートDLホスト`kdpreports.amazon.co.jp`は**別cookieドメインで独自のOpenID再認証**(=`www.amazon.co.jp/ap/signin?openid.return_to=kdpreports…`にリダイレクト、email/password/OTP要求)を要する。保存storageStateにkdpreports系cookieは無い(`.amazon.co.jp`/`kdp.amazon.co.jp`のみ)。旧`refreshKdpSession`は着地先が**本棚固定→本棚はlogged-inのまま即ok→再認証せず**retry DLも同challengeで失敗し、OTP要求に到達しなかった。**修正**: `refreshKdpSession`に`landingUrl`追加、`sales.fetch`はセッション切れ時`https://kdpreports.amazon.co.jp/`を着地先に→OpenIDサインイン確実発火→handleOtpRetryLoop(LINEリレー`kdp_sales_relogin`)でOTP→reports側セッション確立→retry DL成功。`isLoggedIn`をreportsホスト着地も可に一般化。テスト18件緑。**実証(2026-08-02)**: sales.fetch(2026-07)手動enqueue→LINE OTP要求→運営者返信(consumed@16:26)→`done rec=12`。docs/05 §5.3.19。**診断法**: `railway run --service A2P-Worker node`でセッション復号→`ctx.request.get(pmr endpoint)`が`www.amazon.co.jp/ap/signin?...return_to=kdpreports`を返す＝reports再認証要。

**注意:** 旧 `parseKdpSalesHtml`(tr.report-row等の独自セレクタ)は実KDPでは動かない(SPAのため)。使わない。レビュー数/星/BSRはKDPレポートに無く商品ページ別スクレイプ(別途)。既存資産(認証暗号化`accounts.kdp_credentials_enc`, 売上KPI画面, ディスパッチャ)はそのまま活用。関連: [[project-phase2-state]]
