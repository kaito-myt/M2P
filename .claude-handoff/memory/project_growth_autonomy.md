---
name: project_growth_autonomy
description: 全社ToDo自動承認モード(F-082)＋販促強化 継続AIループ(F-081)と現状ベースライン
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-18T16:58:51.331Z
---

2026-08-19 出荷（運営者方針「必ず黒字化」）:

**F-082 全社ToDo自動承認モード**: `org_auto_approve_tasks`(既定ON, /orgトグル「ToDo自動承認」)は起票時のみ承認していた。org.plan の各ティック冒頭に**滞留 proposed（needs_human kind=create_account/growth_manual等は除外）を一括 approved へ継続スイープ**を追加。提案中で止まるToDoが無くなりAI組織が自走。本番: org_auto_approve/auto_plan/auto_execute すべてON。

**F-081 販促強化 継続AIループ** `promotion.growth.loop`（cron `0 21 * * *`=JST6時, kill-switch `promo_growth_loop_enabled` 本番ON）: 実測(到達/フォロワー/予約投稿残量/プレイブック鮮度)を決定的評価し、安全・可逆な強化を**AIサブタスク再起動**で自動実行 — 薄いキュー/低到達→`promotion.content.generate`(良書紹介再生成)、古いプレイブック/低到達→`promotion.playbook.refresh`。エンゲージengine OFF時は推奨のみ(自動ONせず)。org_task(kind=`growth_loop`,approved)＋LINEに黒字化サマリ記録。上限=再生成5/リサーチ3。`decideGrowthActions`はテスト付。コード: apps/worker/src/tasks/promotion-growth-loop.ts。

**ベースライン(2026-08-19時点・要改善)**: Xフォロワー約2人 / 直近14日 平均インプレッション1.7(160投稿=ほぼ未到達) / 当月ロイヤリティ349円。まだ黒字化していない。到達を上げる主手段 = [[project_sns_engage_bot]](IG自動フォロー)＋X能動エンゲージ＋良書紹介コンテンツ(content_creator v3)＋本ループ。関連 [[project_org_agents]] [[project_promo_quality]]。
