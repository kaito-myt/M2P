---
name: project-pipeline-settings
description: パイプライン設定タブ — 各工程のAI自動パス設定＋テーマ日次自動生成(出荷済 2026-07-25)
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-07-25T03:12:01.029Z
---

出版パイプラインの各工程を AI 判断で自動パス（人手承認ゲートを自動通過）するか設定する機能。**出荷・デプロイ済み 2026-07-25**（commit 22ca7de）。

- **タブ**: 出版パイプライン最上部 `/pipeline/settings`（nav-items.ts `pipeline-settings` を先頭に）。
- **設定(AppSettings singleton, prod ALTER済)**: `autopass_theme_enabled` / `pipeline_themes_per_day`(1..30) / `pipeline_theme_direction`(text,空=おまかせ) / `pipeline_theme_cron`(既定"0 22 * * *") / `autopass_outline_enabled` / `autopass_content_enabled` / `autopass_cover_enabled` / `autopass_kdp_enabled`。全既定OFF。
- **web**: `apps/web/lib/pipeline-settings-core.ts`(DI core, settings-core.tsと同型・独立) + `app/actions/pipeline-settings.ts` + `app/(app)/pipeline/settings/page.tsx` + `components/pipeline/pipeline-settings-form.tsx` + messages.pipelineSettings。
- **worker配線** (`apps/worker/src/tasks/lib/pipeline-autopass.ts` = readPipelineAutopass): 3ゲートが承認SAコアを忠実にミラーして自動前進 — outline(`pipeline-book-writer-outline.ts`→bulkApproveOutlinesCore相当), content(`pipeline-book-editor.ts`→approveBookContent相当), cover(`pipeline-book-judge.ts` score>=80→bulkAdoptCoversCore相当, 生成表紙が無ければ従来通り停止)。いずれも try/catch でLLM結果を無駄にしないフォールバック。
- **テーマ日次自動**: `pipeline.theme.auto`(`pipeline-theme-auto.ts`) cron(pipeline_theme_cron, autopass_theme_enabledでgate) → Marketerで pipeline_themes_per_day 件生成(keyword_or_brief=方向性) → 自動採用 → BatchPlan投入(夜間 batch_plan.dispatcher が拾う)。runner/crontab登録済。
- KDP入稿トグルは「アシスト出版ツール [[reference-kdp-creation-limit]] の対象にする」意図フラグ（サーバ自動入稿は認証壁で不可）。
- テスト: web pipeline-settings-core.test.ts + worker pipeline-autopass/theme-auto/各ゲートON/OFF。web1189→worker516緑。docs/05更新。
