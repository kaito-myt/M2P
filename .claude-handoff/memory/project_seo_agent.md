---
name: project-seo-agent
description: Amazon SEO最適化ランタイムエージェント(seo_optimizer) — KDP入稿前にメタデータ再最適化
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-24T08:04:07.260Z
---

**Amazon SEOエージェント(seo_optimizer)実装・本番稼働(2026-08-24)**。judge通過後・export直前に、**完成原稿**からKDPメタデータ(description/keywords/categories)をA9/A10観点で再最適化する。marketerがテーマ段階で作った初期メタデータを、完成した本文で上書き改善する。

- **agent**: `packages/agents/src/seo-optimizer/index.ts` `optimizeSeo()`(judge6段パターン)。contract=`packages/contracts/src/agents/seo-optimizer.ts`。AgentRole に`seo_optimizer`追加。
- **prompt/model**: `packages/db/apply-seo-optimizer.ts`(冪等・UPDATE対応)。バックエンドキーワード7個(類義語/かなカナ英/タイトル重複回避/商標記号禁止)・description(悩み→変化, 価格URL禁止)・categoryちょうど2個・title/subtitleは提案のみ(本体変更しない)。model=`openai/gpt-5`(分析系)。
- **worker task**: `apps/worker/src/tasks/pipeline-book-seo.ts` `pipeline.book.seo`(Job CAS+BookLock, **SEOは非致命try/catch**, 成否に関わらず必ず`pipeline.book.export`をenqueue→書籍が滞留しない)。runner登録済。
- **配線(2経路とも)**: ①judge autopass経路=`pipeline-book-judge.ts`がexport→seoへ。②**手動表紙採用経路**=`apps/web/lib/covers-core.ts`のexport enqueueもseoへ(covers.test更新)。両経路でSEO必須。
- スキーマ変更なし(既存KdpMetadataのdescription/keywords/categoriesを更新)。**BISAC コード列は未追加(将来)**。categories!=2ならexisting維持。
- 検証: contracts/agents/worker/web typecheck通過, agents376テスト+judge18/18+covers通過。worker+web本番デプロイSUCCESS(2026-08-24)。設計docs/05 §5.3.8b・§6.3.5b。

関連: [[reference-kdp-publish-authwall]] [[reference-model-assignment-routing]] [[project-kdp-publish-assist]]
