---
name: project_phase1_state
description: "A2P Phase 1 (MVP) completion state — what's done and the single human blocker remaining"
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
---

A2P Phase 1 (MVP, SP-01〜SP-09) は **コード/設計/テスト面で完成**。確認: 2026-06-10。

- Vitest 全パッケージ PASS（web 924 / worker 274 / packages 各種、失敗ゼロ）。
- Playwright runtime プロジェクト: mock ベース E2E は全 PASS（uc01-batch-night, uc04-cost-alert-runtime 5/5, uc06-revision-run-runtime 6/6 ほか）。実 LLM 呼び出し系と get-api-key round-trip の 19 spec は `.env.local` に実 API キー / API_CRED_KEY が無いため失敗するが、**これは環境依存でコード欠陥ではない**（本番/実キーがあれば PASS する設計）。
- PM `MODE: REVIEW TARGET: Phase 1` の判定は `## PHASE_INCOMPLETE`。差し戻し 2 件のうち NG-1（SP-02〜09 のタスク表に完了マーク ✅ 無し）は解消済み。

**唯一残る Phase 1 完了ゲート = T-09-08（人間タスク）**: 本番 Railway に実 API キーを設定し実 LLM で 1 冊完走させ、コスト/リードタイム/PDF 生成時間を実測して `docs/operations/phase1-real-run.md` の TBD を埋める（dev-plan §2「月額 100 冊で 5 万円以内かの実測」も同依存）。自律実行不可（デプロイ済みインフラ + 実費が必要）。
**Why:** 実測データは本番環境でしか取得できず、エージェントは実行できない。
**How to apply:** 運営者が実走後、`DATABASE_URL=<prod> pnpm tsx scripts/measure-real-run.ts <book_id>` を実行→出力を phase1-real-run.md に転記→OQ-01(PDF性能)と100冊試算を記入→`pm MODE: REVIEW TARGET: Phase 1` を再実行で PHASE_COMPLETE 取得。計測ハーネスとレポート骨格は整備済み。

Phase 2 は SP-10〜13。開始時に pm を計画モードで再起動して SP-10 以降を詳細化する必要がある（DB スキーマ eval_results/prompt_proposals は Phase 1 で先取り済み）。関連: [[feedback_autonomous]]
