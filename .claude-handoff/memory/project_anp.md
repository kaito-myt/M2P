---
name: project-anp
description: M2P 第2ツール ANP (note 自動出版) — 2026-09-18 に無人運転 ON (日次テーマ→執筆→判定→無料公開→X/IG 告知)。初の実公開 URL と共有セッションの注意、残タスク (KYC/有料化, TikTok)
metadata:
  type: project
---

**状態 (2026-09-18)**: Phase 1〜4 の主要部を実装・デプロイ済み。設計 = `docs/11-anp-design.md`（実 DOM・制約・申し送りはここが正）。アプリ `apps/anp`、Railway サービス `ANP`、本番 `anp.m2p.tools`。

**無人運転 ON (本番 AppSettings)**: `anp_auto_theme_enabled=true`(1/日, cron 既定 JST 08:00 `note.theme.auto`) / `anp_autopass_enabled=true`(自動採用→outline→body→editor→eyecatch→judge) / `anp_auto_publish_enabled=true`(`note.publish.dispatch` 30 分毎、無料記事のみ) / `anp_publish_dry_run=false`。cron は worker 起動時に設定を読んで条件付き登録（設定変更後は worker 再デプロイが要る）。

**初の実公開 (2026-09-18 10:51 JST)**: `https://note.com/goodbooks_intro/n/nc3e4203790a3`。note は投稿後に本文ページへ遷移せず「記事が公開されました」モーダルを出すため、公開確認は **公開 API `GET https://note.com/api/v3/notes/<noteId>`**（認証不要、`data.status='published'`, `data.user.urlname`）で行う方式に修正済。

**⚠️ アカウント**: `note-acc-1`「AI副業ラボ」は暫定共有セッション＝実体は A2P 販促ペルソナ「良い本を読む習慣」(handle `goodbooks_intro`) の note アカウント。AI 副業記事が読書ペルソナに出る。分離するなら note 新アカウント作成→`scripts/anp/note-session-capture.sh <note_account_id>`。

**残 (人手)**: note 本人情報登録(KYC)→有料記事化（judge は `price_jpy` に提案のみ保存、`paid` は常に false）、検証用下書き 5 件の削除 (n6845533ebcf7 / n9c510facf4dc / n1d09eea651e3 / ne071421d3e1d / n800cf6101fa9)、メンバーシップ計測の実データ検証、TikTok 連動 (Phase 4)。

**罠**: `note.theme.generate` は `job_id` 必須。judge の `score_total` は breakdown 平均で再計算。本番 `_prisma_migrations` は壊れているので DB 変更は raw SQL 適用（`20260918000000_anp_theme_auto` は適用済）。

関連: [[project-platform-portal]] [[project-sns-persona-visuals]]
