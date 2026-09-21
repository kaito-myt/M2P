---
name: project-anp
description: M2P 第2ツール ANP (note 自動出版) — 2026-09-18 無人運転 ON、2026-09-21 AI 相談・作成ウィザード・画像添付・記事方針・アカウント設定・販促施策・設定タブ・分析ダッシュボード。残タスク (KYC/有料化, ブログ配線, カスタムロール配線)
metadata:
  type: project
---

**状態 (2026-09-18)**: Phase 1〜4 の主要部を実装・デプロイ済み。設計 = `docs/11-anp-design.md`（実 DOM・制約・申し送りはここが正）。アプリ `apps/anp`、Railway サービス `ANP`、本番 `anp.m2p.tools`。

**無人運転 ON (本番 AppSettings)**: `anp_auto_theme_enabled=true`(1/日, cron 既定 JST 08:00 `note.theme.auto`) / `anp_autopass_enabled=true`(自動採用→outline→body→editor→eyecatch→judge) / `anp_auto_publish_enabled=true`(`note.publish.dispatch` 30 分毎、無料記事のみ) / `anp_publish_dry_run=false`。cron は worker 起動時に設定を読んで条件付き登録（設定変更後は worker 再デプロイが要る）。

**初の実公開 (2026-09-18 10:51 JST)**: `https://note.com/goodbooks_intro/n/nc3e4203790a3`。note は投稿後に本文ページへ遷移せず「記事が公開されました」モーダルを出すため、公開確認は **公開 API `GET https://note.com/api/v3/notes/<noteId>`**（認証不要、`data.status='published'`, `data.user.urlname`）で行う方式に修正済。

**⚠️ アカウント**: `note-acc-1`「AI副業ラボ」は暫定共有セッション＝実体は A2P 販促ペルソナ「良い本を読む習慣」(handle `goodbooks_intro`) の note アカウント。AI 副業記事が読書ペルソナに出る。分離するなら note 新アカウント作成→`scripts/anp/note-session-capture.sh <note_account_id>`。

**アカウント分離 (2026-09-18 午後)**: 運営者は note を別アカウントで運用する方針 → `note-acc-1` は `status=paused`。ANP に「アカウント設計」機能を追加 (`/accounts/design`: brief→`anp.strategist` が表示名/ID候補・bio・柱・収益方針・初回テーマ・KPI・画像プロンプトを設計→編集/承認→`note_accounts` に `pending_session` で作成→note 手作業チェックリスト→`note-session-capture.sh` で active 化)。テーブル `note_account_designs`、タスク `note.account.design` / `note.account.visuals`。

**AI 相談 (F-ANP-04, 2026-09-21)**: 運営者要望「戦略策定時に AI に相談しながらリサーチ・策定したい」→ `/accounts/design/consult` にチャット壁打ち。role `anp.consultant`（Opus 4.7）、2 段階（リサーチ計画 JSON→Tavily→返答 JSON: reply/brief_draft/ready_to_design/suggested_questions）。worker `note.account.consult`（CEO 対話と同型の非同期＋2.5s ポーリング）。テーブル `note_account_consultations`/`..._messages`、`note_account_designs.consultation_id`。「この内容で設計案を生成」で草案→`note.account.design`。Tavily キー未設定なら検索無しで会話のみ。

**ロゴ (2026-09-21)**: 運営者支給のワードマーク（A2P と同系ネイビー×ティール）に差し替え。`apps/portal/public/tools/anp.png`＝`apps/anp/public/anp-logo.png`（ワードマーク）、`apps/anp/public/anp-mark.png`（正方形マーク）、`apps/anp/app/icon.png`（favicon、旧 favicon.ico 削除）。`sharp` でトリム/切り出し。

**note 連携は画面から (F-ANP-20b, 2026-09-21)**: `/accounts/[id]`「note アカウント連携」に note ログイン中ブラウザの Cookie (`note_gql_auth_token`) を貼り付け → `GET note.com/api/v2/current_user`（未認証 401）で検証 → storageState(.note.com, origins 空) を `KDP_CRED_KEY` で暗号化保存 → handle=urlname, active 化。ANP サービスにも `KDP_CRED_KEY` 設定済。ローカルスクリプトは代替。**未検証**: Cookie のみで自動公開 (エディタ) が通るか。記事一覧 `/articles` は段階タブ（作成中/公開前/公開中/失敗・非公開、`lib/article-stage.ts`）。

**2026-09-21 夜の追加 (全て本番反映)**: 画像添付付き AI 指示 (`ImageAttachTextarea`、R2 `anp/uploads/`、worker が縮小して vision 入力) / 記事の方針・トンマナ `editorial_policy` (全記事プロンプトに注入) / `/accounts/new` 作成ウィザード (旧「アカウント設計」タブ廃止) / 表示名編集 / **アカウント設定** (自動運転トグル＝全体設定に従う/専用、1 日テーマ数はアカウント値が正、収益化: `paid_ratio`(有料比率, 未設定=AI 任せ)・`free_ratio`・価格帯・メンバーシップ → `monetizationLines` でテーマ生成に注入) / **販促施策 `/promotion`** (F-ANP-32: `note_accounts.promotion_policy_json` 媒体別 {enabled, policy, hashtags, posts_per_week, cta}、`promotion.note.article` が enabled と policy/cta/tags を反映、AI 生成は `note.account.profile` targets=['promotion']+channel、ブログ配線は未接続) / **設定** `?tab=models|ops` (運用はトグル、モデル設定に「新しい AI ロール作成」= `anp_agent_roles`+prompts+model_assignments、パイプライン配線は未接続) / **分析** `/analytics/sales`・`/analytics/cost` (`lib/analytics-core.ts`) / ピル型アカウント切替 (`components/account-pills.tsx`)。UI ルール: 横断ページの絞り込みはドロップダウンでなくピル型ボタン。

**残 (人手)**: note で新アカウント作成＋セッション取込（設計機能の出力に従う）、 note 本人情報登録(KYC)→有料記事化（judge は `price_jpy` に提案のみ保存、`paid` は常に false）、検証用下書き 5 件の削除 (n6845533ebcf7 / n9c510facf4dc / n1d09eea651e3 / ne071421d3e1d / n800cf6101fa9)、メンバーシップ計測の実データ検証、TikTok 連動 (Phase 4)。

**罠**: `note.theme.generate` は `job_id` 必須。judge の `score_total` は breakdown 平均で再計算。本番 DB 変更は raw SQL 適用→`prisma migrate resolve --applied <name>` で履歴整合（2026-09-21 に 20260915/0918/0919/0921 分を resolve 済、以後 `migrate deploy` が通る可能性あり・要確認）。

関連: [[project-platform-portal]] [[project-sns-persona-visuals]]
