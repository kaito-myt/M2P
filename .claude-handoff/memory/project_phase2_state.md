---
name: project_phase2_state
description: "A2P Phase 2 (品質ループ) progress — SP-10 done, SP-11/12/13 remaining"
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
---

A2P Phase 2 (品質ループ, SP-10〜SP-13) を Phase 1 の人間ブロッカー (T-09-08 実走) を待たずに前倒し着手中。確認: 2026-06-14。

- **SP-10 (quality-judge) = PHASE_COMPLETE**（pm REVIEW 31/31 OK）。Quality Judge エージェント (`packages/agents/src/judge/`, 6軸採点・score_total はサーバ側で6軸平均再計算)、`pipeline.book.judge` 本実装（>=80 export / <80&retry<2 editor|writer 再キック / retry>=2 needs_human_review+Alert(judge_failed)+メール）、thumbnail→judge 配線、revision.book.apply 再採点フック、S-010 評価履歴タブ、S-002/S-017 Quality KPI、Vitest（worker judge 14 + agent 16）。6軸は各 0-100 スケール（contracts `judge.ts`）。判定モデル割当 = claude-sonnet-4-6。
- 全パッケージ Vitest green: contracts 66 / db 51 / agents 301 / worker 290 / web 945 = 1653。typecheck 全 clean。
- **SP-11 (prompt-optimizer-approval) = PHASE_COMPLETE**（pm 35/35 OK）。Optimizer エージェント(opus-4-7)、`optimizer.prompt.generate` タスク、10冊トリガー(best-effort)、承認/ロールバック SA(prisma.$transaction 原子的, audit prompt.approve/reject/rollback)、自動承認(5冊連続改善, rollback_until, now DI)、A/B配信(ab_distribution_json マイグレーション, normalizeAbGenre で genre 往復統一, rand DI)、S-023 改訂承認UI、S-022 プロンプト管理(新規3タブ)、UC-03 E2E **Playwright 5/5 PASS**。
- E2E 実行で client/server 境界バグ('use client' が @a2p/db→'fs' ビルドエラー)を検知し `ab-distribution-shared.ts` 分離で修正、`pnpm --filter @a2p/web build` 成功確認。監査 actionLabels に prompt.* 日本語ラベル追加。
- **ローカル E2E 実行環境**: Docker `a2p-pg`(5433) 起動・全マイグレーション適用・seed 済み。E2E ログインは `.env.local` の `E2E_AUTH_PASSWORD_HASH`(=bcrypt of Miyata11)を `tests/e2e/fixtures/db.ts` が優先使用(本番 AUTH_PASSWORD_HASH は実パスワード由来で E2E_AUTH_PASSWORD と不一致のため)。Playwright 実行は PowerShell で `$env:PLAYWRIGHT_JSON_OUTPUT_NAME` + `--reporter=json` をファイル出力して確認(stdout 取得が不安定なため)。
- **SP-12 (sales-auto-fetch, F-038) = PHASE_COMPLETE**（pm 再確認 OK）。KDP レポート HTML パーサ（純関数, fixture テスト）、`BrowserPort` DI 境界（playwright import 無し, Phase 3 で実装注入）、`sales.fetch` タスク（creds 復号→browserPort→parse→SalesRecord upsert, 2FA→Kdp2FaCode, 冪等, units_sold 非永続）、`sales.fetch.dispatch` cron（buildCronItemsWithSettings で enabled 時のみ）、`triggerSalesFetch` SA（jobKey 重複防止）、S-017 ステータスバナー（5状態, sales-fetch-view.ts で client/server 境界分離）、S-027 トグル+cron-utils、E2E（runtime + chromium）**19/19 PASS**。`SalesFetchRun` マイグレーション追加。
- **実 KDP 実走は人間ゲート**（HG-12-01〜03: KDP 認証情報設定→実走→2FA フロー。T-09-08 同種）。
- **教訓**: 'use client' から prisma 値 import（lib の core/view/status が @a2p/db を値 import）すると `next build` が `fs` 解決失敗で落ちる。vitest/typecheck では検知不可。**UI タスク完了時は必ず `pnpm --filter @a2p/web build` を実行**。共有純関数/型は prisma 非依存の `*-shared.ts`/`*-view.ts`（型のみ `import type`）に分離する（[[project_phase2_state]] 既出パターン: ab-distribution-shared.ts, sales-fetch-view.ts）。fixture を変更したら依存する全テストの期待値も同時更新（worker フルスイート再実行で確認）。
- **SP-13 (ab-comparison-cost-tune) = PHASE_COMPLETE**。F-026 モデル A/B 比較ビュー S-021（`/models/ab`, ComparisonForm + KPI 並置 + 純SVG BoxPlot + データ不足表示, `packages/db/src/ab-comparison.ts` 集計）、Prompt Caching（AgentSdkClient + AISdkClient anthropic 経路, `LLMCompleteArgs.enablePromptCaching`, cache トークンを token_usage.cached_input_tokens 記録）。ab-comparison E2E（runtime+chromium）PASS。サイドバーで /models/ab・/prompts・/prompts/proposals を有効化（SP-11 ページが未リンクだったのも修正）。
- **Phase 2 全体 = PHASE_COMPLETE**（pm MODE:REVIEW TARGET:Phase2, 38/38 コード項目 OK）。F-008/009/026/029-031/038 実装+テスト済み。フルスイート: contracts 66 / db 62 / agents 327 / worker 365 / web 1065（0 failed）。`pnpm --filter @a2p/web build` 成功。Phase 2 E2E 合計 56 PASS。
- **残る人間ゲート**（コード完了済み・実走待ち、T-09-08 同種）: Phase1 T-09-08 本番実走 / HG-12 実 KDP sales.fetch / HG-13(=H-13) Prompt Caching 採用判断・Gemini Flash 切替実測・月額コスト実測・Optimizer 実 LLM 1 サイクル。dev-plan §7 意思決定ログ記録も実測後。
- **【決定 2026-06-15】KDP アップロードは当面「人間が手動」運用** = **Phase 3（KDP 自動入稿 SP-14〜16, F-041/042）は保留**。運営者は Phase 1 実装済みの F-020 KDP 入稿チェックリスト(S-015, `/kdp/checklist`)で生成成果物(docx/PDF/PNG＋メタデータ)を確認し KDP へ手動転記・入稿する。dev-plan §7 意思決定ログ＋§2 マイルストーン表に記録済み。再開する場合の前提: 実 Amazon への Playwright+stealth は bot 検出 BAN リスク(R-06)＋実認証＋2FA を伴う outward-facing 作業なので人間判断必須（自律で実 KDP を叩かない）。Railway `PLAYWRIGHT_CHROMIUM=true` / chromium Dockerfile / `KDP_CRED_KEY` env、BrowserPort(SP-12) が共通基盤。
- **ローカル E2E 実行環境メモ**: Docker `a2p-pg`(5433)。**正しい dev DB は `a2p`**（全マイグレーション+seed 済み）。root `.env.local` と `apps/web/.env.local` は元々 a2p / a2p_dev で不整合だった→両方 `a2p` に統一済み（a2p_dev は旧スキーマで SP-11/12 マイグレーション欠落）。`.env.local` に `E2E_AUTH_PASSWORD_HASH`（bcrypt of Miyata11, E2E ログイン用）追記済み。chromium E2E は warm dev サーバ（手動 `pnpm --filter @a2p/web dev`）に reuseExistingServer で当てると cold-compile タイムアウトを回避できる。
- 各スプリント着手時は pm を `MODE: PLAN TARGET: SP-NN` で枠→本タスク表に詳細化してから /iterate。完了時 pm `MODE: REVIEW`。

**Phase 2 全体の完了ゲート**: 実 LLM での Judge スコア感度確認＋Prompt Optimizer 1 サイクル稼働は本番実走（人間タスク、Phase 1 T-09-08 と同根）。関連: [[project_phase1_state]] [[feedback_autonomous]]
