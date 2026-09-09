---
name: project-home-dashboard
description: ホーム(S-002)を実データ接続の経営ミッションコントロールへ全面再実装
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-20T09:17:20.238Z
---

**S-002 ホーム画面を実データ接続で全面再実装(2026-08-20出荷)**。従来はQuality以外プレースホルダで「全然機能してない」と指摘され、運営者目線(①儲かってるか②AI会社は動いてるか③自分がやることは何か)で作り直した。

**構成**: A.事業サマリ(**当月純利益ヒーロー=当月売上−当月コスト・黒字/赤字色分け**＋売上MoM＋コスト/予算＋出版累計＋品質) / B.AI会社の稼働(自律運用6トグルON/OFF＋現在のCEO方針＋進行中ジョブlive) / C.要対応(実カウント＋実リンクのActionCard、0件ミュート) / D.最近の本・パイプライン内訳・未読アラート / E.SNSフォロワー成長。

**実装**: `app/(app)/dashboard/page.tsx`(RSC・`Promise.all`一括集計・force-dynamic)＋`components/dashboard/home-sections.tsx`(表示専用)。データ源=getCostMeterData/salesRecord.aggregate(当月/前月year_month)/book.groupBy(status)/getCommentCounts/alert/orgTask.groupBy/serializeOrgAutomation/kdpAuthRequest.count/promotionGrowthSnapshot。ActionCard・KpiCardはtone/hero/href対応に拡張。設計=docs/04 §S-002・docs/02 F-088。

関連: [[project-platform-portal]] [[project-growth-autonomy]]
