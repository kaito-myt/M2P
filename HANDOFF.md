# A2P/M2P 作業引き継ぎ（2026-09-21 時点）

別端末で続きを作業するための現況・残タスク・発見した制約のまとめ。
起動後はまず本書＋`CLAUDE.md`＋`.claude-handoff/memory/*.md` を読むこと。
（旧版 2026-09-09 の内容は本書に統合。Git 履歴 `git log --oneline` にコミット単位の作業履歴あり）

## 別端末でのセットアップ手順
1. `git clone https://github.com/kaito-myt/M2P.git` → `pnpm install`
2. **`.env.local` は gitignore で push されていない**。最低限 `RAILWAY_TOKEN=` だけ埋めれば
   `scripts/paperback/pb-env.sh` が DB/R2/Amazon/KDP_CRED_KEY を Railway から取得する
   （テンプレは `.env.example`。Railway ダッシュボード > Account Settings > Tokens で発行）。
3. 会話の記憶は `.claude-handoff/memory/*` を新端末の `~/.claude/projects/<ハッシュ>/memory/` に配置
   （ハッシュは絶対パス由来。`C:\DEV\M2P` に clone すれば `C--DEV-M2P`）。
4. ブラウザ自動化のログイン状態（`scripts/.kdp-userdata`, `scripts/.note-userdata*`）は gitignore。
   KDP は初回 OTP 再認証（LINE リレー or `kdp_auth_requests` 行を手動 fulfilled）。
   BW/Kobo/note のセッションは DB（app_settings / promotion_channel_settings）に暗号化保存済みなので端末非依存。

## 2026-09-21（本機）で実施したこと
運営者の依頼 5 件（Amazon Ads のパフォーマンス/コスト取込 / ANP の仕上げ / ANP メニューをサイドバーに / ANP ロゴ差し替え /
ANP のアカウント戦略を AI に相談しながら策定）を実施。main に push 済み・本番デプロイ済み（下記「デプロイ結果」参照）。
週末の運用は正常: A2P テーマ自動生成は 9/19・9/20 とも 07:00 JST に成功（各 1 テーマ→書籍化）、失敗ジョブなし。

### Amazon Ads — 広告パフォーマンス＋コスト取込（F-090 拡張, S-030 `/ads`）
- 既存 `ads.spend.fetch`（日次 04:00 JST）を拡張: `spCampaigns`→`ad_campaign_stats`（キャンペーン別）、`spAdvertisedProduct`→
  `ad_product_stats`（書籍/ASIN 別）、`POST /sp/campaigns/list` で名前/状態/日予算、SB/SD は best-effort、JPY 以外は `latest_fx_rate` で換算、
  Reporting API の 31 日制限に対応する期間分割。migration `20260921000000_ad_campaign_product_stats` は本番へ raw SQL 適用済み。
- A2P に **`/ads`（S-030）** 新設（サイドバー「分析 > 広告」）: 接続状態＋「今すぐ取得」、当月 KPI（広告費/広告経由売上/ROAS/ACOS/CTR/CPC…前月比）、
  日次トレンド、キャンペーン別、書籍別（広告費 vs 印税）。期間 = 当月/先月/直近 30 日。
- **運営者の手順（未実施、これをやらないと未接続のまま）**:
  1. https://advertising.amazon.com/API/docs で LwA セキュリティプロファイルを作り Client ID/Secret を取得、Allowed Return URL に
     `http://localhost:8787/callback` を追加。
  2. ローカルで `node scripts/ads/amazon-ads-oauth.mjs --client-id=<ID> --client-secret=<SECRET>`（既定 region=fe/日本）。表示された
     認可 URL をブラウザで承認 → スクリプトがコールバックを受けて refresh token とプロファイル一覧を表示（`scripts/ads/README.md`）。
  3. 表示された 5 つの env（`AMAZON_ADS_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _PROFILE_ID / _REGION`）を Railway の
     `A2P-Worker` に設定して再デプロイ（`--railway-set` オプションでも可）。翌 04:00 JST か `/ads` の「今すぐ取得」で取り込まれる。
  4. 初回実行後、SB/SD レポートが 403 か成功か、レポート列名が想定どおりかを確認（未検証のまま実装、docs/05 に明記）。
- **9/21 深夜の進捗**: LwA セキュリティプロファイル「A2P Ads」（Client ID `…9710cb2a`、返信 URL `http://localhost:8787/callback` 登録済）を
  作成し認可 URL を開いたが **`An unknown scope was requested`**。原因 = 承認メールのオンボーディングリンクで LwA アプリに ads_api スコープを
  割り当てる手順が未完了で、かつリンクが無効化済み（Advanced Tools Center「My Apps」が「request might still be pending」表示）。
  **→ 運営者が 9/21 01:30 頃 `ads-api-onboarding@amazon.com` にリンクのリセットを依頼済み（返信待ち、通常 1〜3 営業日）**。リセット後: シークレットウィンドウでリンクを開く → My Apps で「A2P Ads」に
  スコープ割当 → `node scripts/ads/amazon-ads-oauth.mjs --client-id=… --client-secret=… --railway-set` を再実行。
  ⚠️ クライアントシークレットが会話ログに載ったため、接続完了後に LwA 側で**シークレットを再生成**し env を更新すること。

### ANP — 仕上げ一括（F-ANP-17/21、記事一覧/詳細、ホーム KPI、TikTok、サイドバー、ロゴ）
- **サイドバー・シェル**（A2P と同構造）: `apps/anp/app/(app)/layout.tsx` + `components/layout/{header,sidebar,sidebar-nav,mobile-nav,
  user-menu,nav-items}`。ナビ = ホーム / note アカウント / アカウント設計 / 記事 / 設定。既存ページは route group `(app)` に移動（URL 不変）。
- **ロゴ差し替え**（運営者支給 `ChatGPT Image 2026年9月21日 00_19_44.png`）: ワードマーク = `apps/portal/public/tools/anp.png` と
  `apps/anp/public/anp-logo.png`（1200x437、余白トリム済）、正方形マーク = `apps/anp/public/anp-mark.png`（512、狭幅ヘッダー用）、
  favicon = `apps/anp/app/icon.png`（旧 `favicon.ico` 削除）。ヘッダー（sm 以上はワードマーク、未満はマーク）とログイン画面に適用。
- **アカウント別設定 (F-ANP-17)**: `note_accounts.settings_json`（auto_theme/themes_per_day/autopass/auto_publish/tiktok_enabled を
  グローバル設定の上書きとして保持）。`/accounts/[id]` に設定フォーム。**注意**: グローバル OFF のときアカウント側 ON にしても cron 自体が
  登録されないので動かない（アカウント側は「OFF にする」用途）。
- **セッション期限切れリレー (F-ANP-21)**: `note_auth_requests` に `note_account_id / fulfilled_at / consumed_at` を追加。セッション失効を
  検知したタスク（publish/sales/status-sync/engage）はアカウントを `paused` にして LINE 通知＋`/accounts` にバナー。復旧は
  `bash scripts/anp/note-session-capture.sh <id>`（paused も active に戻し、該当 auth_request を fulfilled にする）。
- **記事 UI**: `/articles`（全アカウント横断の一覧、状態フィルタ）、`/articles/[id]`（本文プレビュー `lib/note-markdown.ts`、コスト、公開 URL）。
  ホーム `(app)/page.tsx` は `lib/home-core.ts` で KPI を集約（要対応/進行中/公開数/売上）。
- **TikTok 連動動画 (Phase 4)**: `promotion.note.article.video`（既存 `tiktok_*` role を流用、アカウント設定 `tiktok_enabled` 既定 OFF）。
- migration `20260921010000_anp_account_settings_authrelay` は本番へ raw SQL 適用＋`migrate resolve` 済み。

### ANP — アカウント戦略の AI 相談（F-ANP-04, `/accounts/design/consult`）
- 運営者要望「最初にアカウント戦略を策定する時、AI に相談しながらリサーチ・策定したい」→ ブリーフ一発入力（F-ANP-01）の前段に
  **チャット壁打ち**を追加。役割 `anp.consultant`（Opus 4.7、seed 済）。1 ターン = (1) LLM が「検索が要るか/クエリ 0〜3 件」を判断 →
  Tavily 検索（本番は `api_credentials(provider=tavily)` 設定済）→ (2) 返答 JSON（`reply` / `brief_draft` / `ready_to_design` /
  `suggested_questions`）。返答は worker `note.account.consult`（CEO 対話と同型の非同期、UI は 2.5 秒ポーリング）。
- 画面: 左 = チャット（出典 URL の展開表示、次の一言チップ、失敗時「もう一度試す」）、右 = **ブリーフ草案**（AI が会話から毎回更新、
  読み取り専用。修正は会話で伝える）→ 「この内容で設計案を生成」で `note.account.design` へ（設計案は `consultation_id` で相談に紐付く）。
- DB: `note_account_consultations` / `note_account_consultation_messages`、`note_account_designs.consultation_id`
  （migration `20260921000000_anp_account_consult` 適用済）。設計 = docs/11 §3.1 F-ANP-04 / §6 / §7 Phase 6。

### デプロイ結果（2026-09-21 01:08 JST）
- A2P-Worker 00:56 / A2P 01:00 / ANP 01:05 いずれも SUCCESS（`railway up --detach` → `deployment list` で確認）。worker ログの task 一覧に
  `note.account.consult` / `promotion.note.article.video` / `ads.spend.fetch` が登録済み、cronJobs=36。デプロイ時に実行中ジョブは 0 で孤児なし。
- 本番 URL 疎通: `anp.m2p.tools/`・`/accounts/design/consult`・`a2p.m2p.tools/ads` は未ログインで 307→/login、`/anp-logo.png` `/anp-mark.png`
  `/icon.png` は 200。

### ANP — note アカウント連携を画面から（F-ANP-20b）と記事一覧の段階タブ（9/21 深夜追加）
- 運営者要望「アカウント戦略（bio 等は AI レコメンド）→ note でアカウント作成 → ANP 側から note のアカウントを連携」:
  `/accounts/[id]` に **「note アカウント連携」**（note にログイン中のブラウザの Cookie `note_gql_auth_token` を貼り付け →
  `note.com/api/v2/current_user` で検証 → storageState を暗号化保存 → handle 自動設定 → active 化 → 失効リクエスト fulfilled）。
  `pending_session` のアカウントには設計案の表示名/ハンドル/bio を再掲。ローカルスクリプトは代替手段として残置。
  ANP サービスに `KDP_CRED_KEY` を設定（worker と同じ鍵）。migration `20260921020000_anp_session_link` 適用＋resolve 済み。
  **未検証**: Cookie だけの storageState で自動公開（エディタ操作）が通るか。初回公開で not_logged_in になったらスクリプト経路で取込。
- 「メニューに記事一覧を追加して。作成中、公開前、公開中の記事が全部一覧化して」: サイドバー「記事一覧」＝`/articles` を
  段階タブ（すべて/作成中/公開前/公開中/失敗・非公開、件数付き）に再構成（`lib/article-stage.ts`）。

### ANP — プロフィール素材（自己紹介文・アイコン・カバー）をアカウント詳細で生成（F-ANP-05, 9/21 夕方）
- `/accounts/[id]`「note プロフィール素材」: 自己紹介文（生成/再生成・別案・手直し保存・コピー・140 字カウンタ）、
  アイコン/カバー画像（生成/再生成・プレビュー・DL）、追加指示欄。worker `note.account.profile`（role anp.strategist 流用、
  画像は人物型なら実写・顔なし・首から下ルール）。`note_accounts.bio/avatar_r2_key/header_r2_key/profile_generated_at`
  （migration `20260921030000_anp_account_profile` 適用＋resolve 済み）。設計案採用時は設計案の bio/画像を引き継ぐ。

### ⚠️ 本番障害（9/21 17:09 発覚・解消）: ANP 画面からのジョブ投入が graphile に届いていなかった
- 症状: 「自己紹介文を生成」等が 10 分以上進まない。内部 `jobs` は queued、`graphile_worker._private_jobs` に該当なし。
  同日の `note.account.design`（15:33）と UI からの `pipeline.note.publish`（07:06）も同様に滞留していた。
- 原因: `apps/anp/next.config.ts` の `serverExternalPackages` に `graphile-worker` が無く webpack にバンドルされ、
  `makeWorkerUtils` が実行時に失敗（Server Action は error を返すだけでログに出なかった）。apps/web には元から入っていた。
- 対処: `serverExternalPackages` に追加＋`enqueueJob` 失敗を console.error。滞留 4 件は scratchpad `reenqueue.cjs` で再投入し完了。
- 診断 SQL: `select id,kind,created_at from jobs where status='queued' and created_at > now()-interval '1 day'` と
  `select j.id,t.identifier from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id=j.task_id order by j.id desc limit 10`
  を突き合わせ、前者にあって後者に無ければ投入失敗。

### M2P ポータルに「設定 › API キー」を追加、モデル設定は各ツール側へ（9/21 夕方）
- `https://m2p.tools/settings/api-keys`: Anthropic / OpenAI / Google / Tavily の保存（暗号化）・疎通テスト・削除。A2P/ANP/worker と同じ
  `api_credentials` なので 1 分以内に全ツール反映。**環境変数で設定済みのものは「環境変数にて設定済み」表示＋「DB に取り込む」ボタン**
  （運営者判断: 表示だけで可。取り込むかは任意。現状 Anthropic/OpenAI/Google は env、Tavily は DB）。M2P-Portal に `API_CRED_KEY` と
  表示用の 3 つの `*_API_KEY` を設定済み。A2P の `/settings` の API キーフォームは撤去し M2P へのリンクに置換。
- **AI モデル設定は M2P に持たせない**（運営者判断: 役割がツールごとに異なる）。A2P は従来の `/settings/models`、ANP は `/settings` に
  「AI モデル設定 (ANP の役割)」節を新設（anp.* の 8 役割、カタログの現行・呼出可のみ）。設計 = docs/10 §10.4b / docs/11 §5.4。

### 本番障害（9/21 18:10 発覚・解消）: ANP アカウント詳細が 500
- 原因: プロフィール画像の署名 URL 生成に R2 が必要だが、ANP サービスに `R2_*` env が無かった（worker/A2P にはある）。
- 対処: `R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME` を ANP に設定＋署名 URL 失敗はページを落とさず
  画像非表示にするよう修正（account-profile-core / design 詳細 / 記事詳細）。

### ANP — 9/21 夜の追加分（画像添付・記事の方針・作成ウィザード・表示名編集・Cookie 個別入力）
- **AI 指示への画像添付（F-ANP-06）**: プロフィール素材／記事の方針の指示欄に Ctrl+V・ドロップ・📎 で画像を添付（R2 `anp/uploads/`、
  worker が縮小して LLM のビジョン入力に）。AI 相談チャットへの添付は未対応（次の候補）。
- **記事の方針・トンマナ（F-ANP-07）**: `/accounts/[id]` に「記事の方針・トンマナ」パネル（ニッチ／想定読者／トーン／方針本文、
  手入力保存＋「AI で生成」）。`note_accounts.editorial_policy`（migration `20260921040000` 適用＋resolve 済）を theme/outline/
  writer/editor/judge のプロンプトに毎回注入。表示名もヘッダーのフォームで変更可に。
- **新規アカウント作成ウィザード（S-ANP-09）**: `/accounts/new` に AI 相談→設計案→作成を 1 ページ化（URL に状態を持つ）。
  サイドメニューの「アカウント設計」は削除、`/accounts` のボタンが入口。旧 `/accounts/design*` は履歴用に残置。
- **note 連携フォーム**: `note_gql_auth_token` と `_note_session_v5` を個別入力に（どちらか一方でも検証へ）。未ログインだと
  `note_gql_auth_token` は出ないので note にログインしてから Cookie を見る。
- **M2P 設定「API 管理」拡張（R2 / LINE / Amazon Ads を DB 管理）— 実装・デプロイ済**（docs/10 §10.4b-2）:
  新パッケージ `packages/credentials`（`@a2p/credentials`: 仕様 `spec.ts` / 保存・リゾルバ `store.ts` / 疎通テスト `test.ts` /
  起動時登録 `register.ts`、Vitest 24 件）。同じ `api_credentials` に provider `r2` / `line` / `amazon_ads` の多項目 JSON を
  暗号化保存。worker は `index.ts` で `installServiceCredentialProviders()`＋`primeServiceCredentials({refreshMs:65s})`、
  web / anp / portal は `instrumentation.ts`。R2 は `@a2p/storage.getR2Runtime`（DB → env）、LINE は `pushLine` /
  `isLineRelayConfigured` / web webhook、Ads は `ads-spend-fetch` が DB → env。`R2_*` env は optional 化
  （`packages/contracts/env.ts`）。ポータル `/settings/api-keys` は「API 管理」に改名し下段に「サービス連携」多項目フォーム。
  M2P-Portal に R2_* / LINE_* を env としてもコピー済（「環境変数にて設定済み」→「DB に取り込む」が使える）。
  **運用**: ポータルで「環境変数の設定を DB に取り込む」→ 疎通テスト OK を確認してから、任意で worker/web/anp の
  R2_* / LINE_* env を削除できる（削除しなくても DB 優先で動く）。Amazon Ads はオンボーディング完了後にポータルの
  フォームへ 5 項目を貼るだけでよい（Railway env は不要になった）。

### ANP — 9/21 深夜の追加分（アカウント設定・販促施策・設定タブ・分析ダッシュボード）
- **記事一覧**: アカウント/有料提案の絞り込みを段階タブと同じピル型ボタンに（`components/account-pills.tsx`）。
- **アカウント設定（F-ANP-08）**: `/accounts/[id]` に「自動運転」（トグル＋全体設定に従う/戻す、1 日のテーマ作成数はアカウント値が正）と
  「収益化」（有料記事の比率 ON/OFF＋%、無料公開部分 %、価格帯、メンバーシップ）。収益化方針はテーマ生成プロンプトに注入
  （`monetizationLines`）。
- **販促施策（F-ANP-32, S-ANP-10 `/promotion`）**: 右上アカウント切替ピル、媒体タブ X/IG/TikTok/ブログ、媒体別に ON/OFF・施策・
  ハッシュタグ・週投稿数・CTA を `note_accounts.promotion_policy_json` に保存、「AI で施策を生成」（`note.account.profile`
  targets=['promotion']）、投稿一覧。`promotion.note.article` が enabled と policy/cta/hashtags を反映。ブログの自動投稿は未接続。
- **設定タブ**: `/settings?tab=models|ops`。運用設定はトグル化。モデル設定に「新しい AI ロールを作成」（`anp_agent_roles`＋prompts＋
  model_assignments、削除は archived）。カスタムロールのパイプライン配線は未接続（UI に明記）。
- **分析**: `/analytics/sales`・`/analytics/cost`（`lib/analytics-core.ts`、Vitest 5 件）。サイドメニューに「分析」「システム」節。
- migration `20260921050000_anp_promotion_policy_agent_roles`（`promotion_policy_json` 列＋`anp_agent_roles` 表）を本番適用＋resolve 済。

### アイコン / カバー画像のアップロード（F-ANP-05b, 2026-09-22）
- `/accounts/[id]` の画像の下に「アップロード / 差し替え」ボタン（PNG/JPEG/WebP ≤ 8MB、元形式のまま R2 保存、キー差し替え）。

### AI モデルの適材適所化（2026-09-21 深夜、本番 DB 適用済）
- 運営者指示「使っている AI モデルがすべて Claude なので、適材適所で最適化」→ `scripts/models/model-mix-2026-09-21.cjs --apply` で
  17 役割を切替（docs/03 §A の表が正）。要点: **editor(実用書既定)/anp.editor → gpt-5**（最大のコスト源 ¥72k/月 → 約 1/4 見込み）、
  分析/財務/運用の本部長・担当 → gpt-5、analytics_mgr/sales_analyst → gemini-3.8-flash、tiktok_proofreader → gpt-5-mini、
  ANP の企画/戦略/相談 → opus-5（非現行 opus-4-7 の cost ¥0 記録を解消）、anp.writer/anp.judge → sonnet-5。
  judge / writer / marketer / readings / 小説系は Claude のまま（採点の甘さ・web_search・構造化出力・文体の理由）。
- 実 API プローブで gpt-5 / gpt-5-mini / gemini-3.8-flash の generateObject と JSON 応答を確認済。戻し方はスクリプト冒頭コメント。
- 要フォロー: (a) 数日後に `token_usage` で editor の単価と judge 合格率に異常が無いか確認、(b) Anthropic の `model_catalog`
  現行行が全て $10/$50 になっている取得不備の修正（コストメーターが Claude 側で高めに出る）。

### DB マイグレーション履歴の整合
- 本番 `_prisma_migrations` に未記録だった 20260915/0918/0919 と今日の 3 本を `prisma migrate resolve --applied` で記録。
  `migrate status` ではまだ 8 月〜9/9 の数本（20260826120000_ad_spend 〜 20260909000000_bw_retag）が未記録のまま
  （実 SQL は適用済みのはず）。全部 resolve すれば `migrate deploy` が通常運用に戻せる見込み（未実施・要確認）。

## 2026-09-18（本機）で実施したこと
運営者の依頼 4 件（入稿キューの検証 / SNS ペルソナ画像の実写・首から下化 / IG カルーセル / 投稿のキャラクター性）と
「ANP をさっさと作り上げる」を実施。すべて main に push 済み・本番デプロイ済み。

### KDP 入稿キューの検証結果
- **9/16〜18 でキューから出版された本は 0 冊**。原因は KDP の「本の作成数制限（creation_limit）」で、サーバー dispatcher は毎日
  11:07 JST に 1 冊試して制限→15:00 まで全体停止、ローカル日次も同じ。**本棚全頁スキャン（87 listing）では審査中・下書きが 0 件**なので
  「審査滞留による制限」説は誤り → 新規タイトル作成数の期間上限（ローリング）の可能性が高い。KDP 側の制限で、コードでは解消不可。
- 従来のスキャンは 1 頁目 50 件しか見ていなかった（`kdp-scan-bookshelf.mjs` をページ送り対応に修正）。DB の「submitted」20 冊のうち
  **9 冊は実は販売中**（published に同期）、**11 冊は KDP に存在しない幽霊**（unlisted に戻しキューへ再投入）。キューは未入稿 47 冊。
- `kdp-sync-shelf.sh` は同題別レコードの ASIN 衝突（books_asin_key）で落ちていたので回避を追加。
- 日次ルーティンの Task Scheduler は「バッテリー駆動時は起動しない」既定条件で 9/17・9/18 とも走っていなかった（Last Result
  0x800710E0）。条件を外し、未実行分の追いつき起動も有効化。

### テーマ自動生成（さらに 2 晩失敗していた）
- 9/16 の上限 4000 字修正後も 9/16・9/17 22:00 は `marketer.theme.invalid_output: schema validation failed`。原因 = LLM が
  `competitors[].rank` を "1位" のような文字列、`asin/author` を null で返す。contracts `marketer.ts` を寛容パースに修正（回帰テスト付き）。
  9/18 11:03 の手動再実行で **テーマ生成→自動採用→書籍パイプライン起動まで一気通貫で復帰**（1 週間ぶりの新刊企画）。

### ANP（note）— 完成に向けた一括実装（設計 = docs/11 更新済み）
- **初の実公開に成功**: `https://note.com/goodbooks_intro/n/nc3e4203790a3`（9/18 10:51 JST）。ただし worker は「公開完了モーダル」を
  検知できず `blocked` 扱いにしていた → 公開 API `GET note.com/api/v3/notes/<id>` で `published` と `user.urlname` を確認する方式に修正済み。
  DB は手動補正（記事 published、`note_accounts.handle=goodbooks_intro`）。SNS 告知（X/IG）も生成済み（9/20 配信予定）。
- **⚠️ 注意**: note-acc-1「AI副業ラボ」は Phase 1 の暫定共有セッションのため、実際の note アカウントは A2P 販促ペルソナ
  「良い本を読む習慣（goodbooks_intro）」= ことは のアカウント。**AI 副業記事が読書ペルソナのアカウントに出る**状態。
  別アカウントで運用するなら note で新アカウントを作り `scripts/anp/note-session-capture.sh <note_account_id>` でセッション取込が必要。
  → **運営者決定 (9/18 午後): note は別アカウントを新規作成する**。それまで `note-acc-1` は `status=paused`（日次生成/自動公開の対象外）にし、
  読書ペルソナの X/IG に積まれていた AI 副業記事の告知 2 件は canceled にした。「どんなアカウントにするか」を ANP 上で設計する機能
  （brief→AI 設計→編集/承認→アカウント作成→note 手作業チェックリスト→セッション取込）を **実装・デプロイ済み（9/18 13:56）**。
  使い方: ANP `/accounts/design` で「やりたいこと」等の brief を入力→「設計を生成」（worker `note.account.design`, role `anp.strategist`）→
  `/accounts/design/<id>` で表示名/ID 候補の選択・各項目の編集・「画像を生成」（アイコン/ヘッダー, 人物型は実写・首から下ルール）・
  「フィードバックして再生成」→「この設計でアカウントを作成」で `note_accounts` に `status=pending_session` で登録され、note.com 側の
  手作業チェックリスト（表示名/ID/プロフィール文のコピー、画像ダウンロード）が出る。note でアカウントを作ったら
  `bash scripts/anp/note-session-capture.sh <note_account_id>` でセッション取込 → 自動で `active` になり、翌朝から日次生成→公開が回る。
  DB: `note_account_designs`（migration 20260919000000 適用済）、seed で `anp.strategist` prompt/model_assignment 投入済。
- 実装（F-ANP-16/17/31、needs_human_review UI、handle 編集/自動保存）: 日次自動テーマ生成 `note.theme.auto`（AppSettings
  `anp_auto_theme_enabled` / `anp_themes_per_day` / `anp_theme_cron`(既定 JST 08:00) / `anp_autopass_enabled`、migration
  `20260918000000_anp_theme_auto` は本番に raw SQL 適用済み）、判定時の有料化提案（`paid` は KYC 未完了のため常に false、`price_jpy` に提案のみ）、
  A2P ストアフロント（/shop・/blog）に「関連 note 記事」枠、`/accounts/[id]` に要確認記事の再審査/再校閲/公開可ボタンと handle フォーム。
- **ANP の Railway デプロイは 9/15 17:40 以降すべて FAILED だった**（`anp.m2p.tools` は 17:14 の古いビルドが動いていた）。原因 = `next build` が
  `/accounts` `/settings` `/` を静的プリレンダリングしようとして DB (`postgres.railway.internal`) に届かず失敗。DB を読むページに
  `export const dynamic = 'force-dynamic'` を付けて解消（9/18 12:1x にデプロイ成功）。
- **本番設定は全部 ON**: `anp_auto_theme_enabled=true`(1/日) / `anp_autopass_enabled=true` / `anp_auto_publish_enabled=true` /
  `anp_publish_dry_run=false`。= 毎朝テーマ生成→執筆→判定→無料記事として note 公開→X/IG 告知まで無人で回る。
- 残（人手）: note の本人情報登録（KYC）→ 有料記事化、検証用下書き 5 件（n6845533ebcf7 / n9c510facf4dc / n1d09eea651e3 / ne071421d3e1d /
  n800cf6101fa9）の削除、メンバーシップ計測の実データ検証、TikTok（Phase 4）。

### SNS ペルソナ画像（実写・顔なし・首から下）と IG カルーセル
- 共通ルール `PERSONA_VISUAL_RULES`（`packages/agents/src/lib/persona-visual.ts`）を人物が描かれ得る全プロンプト（アイコン/カバー、
  IG 固定テンプレ枚、Veo フック）に付加。**実写写真・顔は映さない・首から下（鎖骨〜腰）・きれいめで女性らしい着こなし**。
  OpenAI の安全フィルタ（safety_violations=[sexual]）は「かなりセクシー」「体のラインが出る」「下着/ヌードは描かない（否定形でも）」
  「ショートパンツ/オフショルダー/太もも」を全部拒否したため、**露出・体型を直接指示する語は使えない**（実測 9/18、3 回試行）。
- 5 チャンネル（x/instagram/tiktok/note/blog）のアイコン・カバー・IG 固定テンプレ枚を新ルールで再生成し R2 上書き済み（旧版は
  `.bak-2026-09-18T0217`）。**各 SNS のプロフィール画像は運営者が手動で差し替える**。署名 URL（7 日有効）=
  `scripts/paperback/out/persona-urls-2026-09-18.txt`（gitignore 対象）。再生成は `scripts/regen-channel-visuals.mjs`（失敗項目は継続して最後に一覧）。
- IG は 3〜6 枚のカルーセル（1 枚目=見出し、2〜N=要点カード、最終=固定テンプレ枚）。配信は Zernio 経由で `mediaItems` に全枚渡す
  （Zernio は 2〜10 枚でカルーセル化）。Make webhook 経路も `mediaUrls` 配列＋`imageUrl` を送るが、**Make シナリオ側のカルーセル対応は未実施**。
- 投稿本文のキャラクター性（F-097）: `strategy_json.character_sheet`（既定 = ことは の設定）を content_creator / promoter / anp.promo /
  content_optimizer に注入。本番 DB へのプロンプト新版投入は `pnpm --filter @a2p/db exec tsx apply-character-sheet.ts`（実行済みなら下記参照）。

## 2026-09-16（本機 C:\DEV\M2P 側）で実施したこと
本書の指示どおり pull → 残作業を進めた。**3 件の本番障害を発見・修正・デプロイ済み**（worker/web とも `railway up`、
`deployment list` で SUCCESS 確認）。詳細は各 docs/05 の該当節と memory `reference_rekick_freeze.md`。
1. **日次テーマ自動生成が 9/11〜9/15 の 5 日間全滅**していた（`pipeline.theme.generate` が毎朝 07:00 JST（cron `0 22 * * *` UTC）に
   `ZodError too_big keywordOrBrief max 500`）。原因 = 9/11 に設定した 732 字の `pipeline_theme_direction` が
   Marketer 入力の上限 500 字に弾かれていた。修正 = 入口〜Marketer まで上限 4,000 字で統一
   （contracts `marketer.ts` / worker `pipeline-theme-generate.ts` / web `themes-core.ts`,`pipeline-settings-core.ts`）。
   **→ 9/18 手動再実行で復帰、9/19・9/20 の 07:00 JST 自動実行も成功（各 1 テーマ→書籍化）。**
2. **judge 再キック後の本が無言凍結**（running 17 冊 / judging 3 冊 = 計 20 冊、8/31〜9/4 から放置）。editor / writer.chapter の
   「二重 enqueue 防止」が初回パイプラインの done Job を見て次工程を enqueue しなかった。修正 = editor はサムネ生成済みなら
   judge 直行、writer.chapter 再キックは兄弟 Job 完了で editor 起動（retry_count/feedback 引継ぎ）。手動承認 SA も同様。
   凍結分は scratchpad の復旧スクリプトで次工程を再投入（結果は下記「復旧結果」）。
3. **blog の育成投稿生成（`promotion.content.generate {channel:'blog'}`）が 9/2 から全滅**（9 ジョブ×最大 25 リトライ、
   毎回 LLM 課金だけ発生）。原因 = 長文記事 12 本が maxOutputTokens 8,192 で途中切れ→JSON 破損→`posts` 欠落。
   修正 = blog/note は 32,768 に引き上げ（`content-creator/index.ts`）。死んだ graphile 行は削除済み。
4. **needs_human_review 通知メールが `React is not defined` で judge Job を落としていた**（復旧後の 5 冊で発覚、既存バグ）。
   `@a2p/notify` の React Email テンプレートが worker の tsx 実行で classic JSX になるのが原因。全テンプレートに React import を明示し、
   judge / alert-cost-check のメール組立を try 内へ（通知失敗は非致命）。worker を再デプロイ済み。
5. **S-015「準備完了の本をまとめて入稿キューに登録」が入稿済み（submitted・KDP 審査中）の本まで再キューしていた**（運営者報告、夕方に修正・web デプロイ済み）。
   `submitToKdpCore` に submitted の blocked 条件を追加し、一括ボタンの対象も `publishStatus===unlisted` に限定。既に誤ってキューに入っていた本は DB で `kdp_publish_queued=false` に戻した（submitted 20 冊 + published 28 冊 = 48 冊。残キューは unlisted 36 冊のみ）。docs/02 F-041・docs/05 §4.3.16 追記。
- ほか: graphile の exhausted 残骸（bw.submit / kdp.submit / optimizer.prompt.generate）削除、stale だった単体テスト
  （env keys 39 項目 / judge maxOutputTokens 12288）を実態に合わせて修正。**まだ落ちている無関係テスト 3 件**
  （worker: writer-outline notify payload・promotion-automation の日程 / web: promotion-channels-core の probe 引数）は
  他端末側のコミット由来で未修正 → 次の作業で直すこと。
- **Task Scheduler に `M2P-daily-publish`（毎日 09:30・対話ログオン時のみ・`scripts/daily-publish-task.cmd`）を登録**し、
  本日分は `schtasks /Run` で手動起動した（ログ = `scripts/daily-publish.log`, `scripts/daily-publish-task.log`）。
- **Kobo の保存セッションは失効**（`rakutenkwl.kobo.com` が全 89 UUID で 403 → ログイン画面へリダイレクト）。
  テスト 1 冊の結果確認・残 87 冊の再送信判断は、運営者が `/kobo` タブから手動ログイン→セッション再保存してから。
- **Railway CLI 注意（本機）**: フォルダが `railway link` されていないため、素の `railway up/logs/deployment list` は
  「No linked project found」で**何もせず exit 0**。必ず `export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | cut -d= -f2-)`
  を先に通す（`pb-env.sh` と同じ）。
- 収益確認（DB）: 9 月売上 ¥279（2 冊）・KENP 3,931 頁、AI コスト ¥91,617（9/1〜16）。`monthly_budget_exceeded=true`
  （赤ライン ¥30,000 超過）だがパイプラインは止まらない設計。テーマ方針は 9/11 の実績方針のまま。

### 復旧結果（2026-09-16 昼）
- 対象 20 冊（running 17 / judging 3）を修正版 worker デプロイ後 11:43 JST に再投入。内訳: **judge 直行 14**（editor 再キック後の凍結、retry_count=1 引継ぎ）/
  **editor 再投入 3**（writer.chapter 全章再キック後の凍結、競馬 3 冊、feedback 引継ぎ）/ **export 再投入 2**（旧 done 本を ops-watch 修復が再校閲して
  running に戻していた残骸、未出版なので出力ファイルを作り直し）/ **status=done 復元 1**（同残骸だが KDP 出版済み「今日のわたしをいたわる100の言葉」）。
  **11:52 JST 時点の結果**: judge 14 冊中 **6 冊合格（80〜84 点）→ thumbnail 自動採用 → seo → export へ進行中**、**8 冊は不合格（retry 上限）→ needs_human_review**
  （運営者の判断待ち: 乙女ゲー/宮廷薬師/極道の娘/転生皇帝/モテる男/透明な共犯者/最後のオーケストラ/ファンダムの神殿）。export 2 冊は done。
  editor 3 冊（競馬）は実行中 → 完了後に judge 直行。needs_human_review 8 冊の通知メールは下記 4 の既存バグで失敗（本の状態は正しい）。
  4 の修正で 11:52 に worker を再デプロイした際、実行中だった editor 3 / seo 1 / blog 生成 1 が旧コンテナごと死亡（graphile 行は旧 worker のロック持ち、
  public.jobs は running のまま、book_locks 残留）→ 11:55 に手動で解放（graphile unlock＋jobs を queued に戻す＋book_locks 削除）し新 worker が再開。
  **教訓: 長時間ジョブ実行中の `railway up` は避ける**（memory `reference_worker_db_outage` ⑥ と同じ罠。org.ops.watch の 6 時間毎自己修復でも直るが時間を失う）。
- judge は RETRY_LIMIT=1 のため、今回 80 点未満なら `needs_human_review` で止まる（再々キックはしない）。翌朝 `books.status` を確認。
- blog 育成投稿の生成ジョブを 1 件だけ再投入（graphile job 150030）。成功すれば `promotion_posts(channel=blog, kind=value)` に 12 件入る。

## ⚠️ 最重要の運用ルール（2026-09-15 に判明）
- **Railway デプロイは必ず `railway up --service <A2P|A2P-Worker|ANP> --detach`**（本機では `RAILWAY_TOKEN` を export してから）。
  `railway redeploy --from-source` は**新コードを反映しない**（既存イメージ再起動のみ、exit 0 で成功に見える）。
  9/4〜9/15 の「デプロイ済み」は全てこれで未反映だった → 9/15 08:35 に `railway up` で一括反映済み。
- Windows Task Scheduler に `scripts/daily-publish-task.cmd`（日次出版ルーティン）を **`M2P-daily-publish` として登録済み（本機、09:30 毎日）**。
  別端末では未登録（登録は `schtasks /Create /SC DAILY /ST 09:30 /TN M2P-daily-publish /TR C:\DEV\M2P\scripts\daily-publish-task.cmd /IT /F`）。
- KDP スクリプトは `scripts/paperback/out/` が無いと全滅（新 clone では mkdir が必要）。

## チャネル別 現況

### KDP eBook / ペーパーバック
- `publish_status`: published=59 / submitted・unlisted 残あり。本棚同期 `bash scripts/kdp-sync-shelf.sh` で DB を実態に合わせる。
- 日次ルーティン `bash scripts/daily-publish.sh` = 本棚同期→下書き resume（枠非消費）→新規作成5冊→BW 再申請→PB 出版。
- **creation_limit** は「1日5冊」ではなく審査滞留に応じたアカウント制限。resume は非消費。PB 枠は別。
- PB 価格 = `scripts/paperback/pb-price.mjs`：`max(¥980, ロイヤリティ¥150 確保価格)`（方針B）。
- PB のプレビュー承認ゲート（GUTTER_ISSUE 等）は react-pdf の CJK 改行修正（`cjkSoftBreak`/ZWSP/kinsoku）で解決。
  全 114 冊 PDF 再生成済み（R2 に `.bak-<ts>` バックアップあり）。
- KDP 表紙は 9.5mm セーフゾーン対応済み。

### BOOK☆WALKER
- 申請枠は**月約3件のローリング**（日次ではない）。`scripts/bookwalker/retry-queue.txt` の 5 冊は枠が開き次第 daily-publish が自動再申請。
- 却下本の編集は取り下げ（`POST /api/books/drop`）後のみ。シリーズ情報は `#sereis_selector`（typo そのまま）。
- 「AI生成」タイトル接頭辞は**存在しない**（bw-shelf-enum のバッジ抽出バグだった。修正済み）。
- 本文の AI 開示文は全書籍から除去済み（`remove-ai-disclosure.mjs`）。

### 楽天Kobo
- 88 冊却下 → 1 冊テスト再送信中（作成中）。結果を見てから残りを判断。作品一覧は `rakutenkwl.kobo.com/v2/ebooks`（SPA）。
- **2026-09-16: 保存セッション失効を確認**（API 全件 403、サインインへリダイレクト）。hCaptcha のため自動再ログイン不可 →
  運営者が `/kobo` タブの手動ログイン→セッション保存をやり直すまで状態確認・再送信ともに不可。

### Booth
- 主力12冊の下書き作成済み（`scripts/booth/booth-drafts.md`）。ファイルUP＋公開は手動。

### 販促（SNS）
- ペルソナ「ことは」（20代読書女子）で x/instagram/tiktok/note/blog 統一、2 投稿/日/チャネル。content_creator v5（実在良書紹介のみ）。
- 9/15 に停滞していた 71 投稿を再スケジュール済み。

### 収益・コスト（9月）
- 売上 ¥0（KENP 2,542）、AI コスト ¥81,974/11日 → 今月黒字は不可能、損益分岐が現実目標。
- 対策済み: judge リトライ `RETRY_LIMIT=1`、prompt caching 有効化（editor/writer/chapter）、テーマ方向を
  light_novel(古典翻案)/競馬/AI/健康 に寄せ self_help/novel/lifestyle から離脱、autopass 一時停止。

## ANP（note 自動出版ツール）— Phase 1〜3 実装・デプロイ済み
- 設計 = `docs/11-anp-design.md`（実 DOM・制約・移行記録は全てここ）。アプリ = `apps/anp`、Railway サービス `ANP`。
- Phase 1: theme→outline→body→editor→eyecatch→judge（本番 E2E 検証済み、記事 4,242 字 ¥78.97、judge 74 点）。
- Phase 2: note エディタへの下書き作成（`pipeline.note.publish`）。**現在 dry-run**（`app_settings.anp_publish_dry_run=true`, `anp_auto_publish_enabled=false`）。
- Phase 3: X/Instagram 告知（3/日/チャネル上限, TikTok は Phase 4）、`note.sales.fetch`（ダッシュボード READ-ONLY・select 実操作で THIS_MONTH）、ホーム KPI。
- **人手待ち**:
  1. note 本人情報登録（KYC）→ 有料記事解放。完了後に価格/有料ライン UI を偵察して有料公開を実装。
  2. dry-run 下書き `https://editor.note.com/notes/n800cf6101fa9/edit/` を手動で投稿 → 公開 URL パターン確認 → `anp_publish_dry_run=false`。
  3. 検証用下書き削除: n6845533ebcf7 / n9c510facf4dc / n1d09eea651e3 / ne071421d3e1d。
- 既知の罠: `note.theme.generate` は `job_id`（app jobs 行）必須。judge の `score_total` は LLM が合計 400 を返すため `.catch(0)` で緩め再計算。

## 実行環境の注意
- 本機 RAM 13.8GB。Docker Desktop＋WSL で ~2.5GB 消費するとブラウザ自動化がフリーズ → `wsl --shutdown` 推奨。
- `TaskStop` で子 node/chrome が生き残る → 明示 taskkill。KDP Chrome プロファイルは同時実行不可（daily-publish と create を並走させない）。
- graphile-worker の残骸掃除は `graphile_worker._private_jobs`（`jobs` はビュー）。

## 次にやること（優先順）
-1. **Amazon Ads の接続**（上記「運営者の手順」1〜4）。それまで `/ads` は「未接続」表示。
-1'. **ANP の実運用開始**: `/accounts/design/consult` で AI と壁打ち → 設計案生成 → 採用 → note で新アカウント作成（表示名/bio は
   アカウント詳細に再掲）→ アカウント詳細「note アカウント連携」に Cookie 貼り付け → 翌朝から日次生成・公開。
0. **翌朝の確認**: (a) 07:00 JST の A2P テーマ生成と 08:00 JST の ANP テーマ生成（`note.theme.auto`）が done か、(b) ANP 記事が
   ready→published（note 公開）→ promotion_posts(kind=anp_article) まで進んだか、(c) IG カルーセルが Zernio で複数枚投稿になっているか
   （`promotion_posts` の instagram 投稿の posted 結果と IG 上の見え方）、(d) daily-publish のログ（09:30 に走ったか）。
1. ANP: 上記の人手待ち 1〜3 → 自動公開 ON → 有料記事対応（Phase 3.5）→ TikTok（Phase 4）。
2. KDP: daily-publish は本機 Task Scheduler で毎日 09:30 に自動実行（PC がログオン状態のときのみ）。
3. Kobo: **運営者が手動ログイン→セッション再保存** → テスト 1 冊の結果確認 → 残 87 冊の再送信可否判断。
4. Booth 12 冊の手動公開。
5. 収益: 週次で `docs/05` の KPI を見てテーマ方向を調整。
6. ~~残っている無関係テスト 3 件の修正~~ → 2026-09-16 夕方に修正済み（全スイート green）。
7. SNS: ペルソナ人物描写ルール(顔出し禁止/首から下/セクシー路線)＋IGカルーセル投稿を実装(未実行)。
   `bash scripts/paperback/pb-env.sh corepack pnpm exec tsx scripts/regen-channel-visuals.mjs --dry-run` でプロンプト確認→
   `OPENAI_API_KEY=... 同上（--dry-run なし）` で avatar/banner/カルーセル固定テンプレ枚を再生成し、
   avatar/banner は各SNSへ運営者が手動適用。IG は Make シナリオを `mediaUrls.length>1` でカルーセル
   (Graph API: 子コンテナ→CAROUSEL親→publish)に対応させる改修が必要(docs/05 参照)。
