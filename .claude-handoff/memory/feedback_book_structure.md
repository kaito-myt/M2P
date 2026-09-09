---
name: feedback-book-structure
description: 生成本の基本構成 — 実用書は はじめに→目次→本文、小説は目次なし本文開始
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-04T03:56:45.683Z
---

生成する本の構成は、実際のKindle書籍の慣習に合わせる（運営者が多数のKindle本を見た所見）:

- **実用書系（ビジネス/自己啓発/実用/趣味/ギャンブル等の非小説）**: 「**はじめに**」から始まり、**次に目次**、その後に**本文**。順序は `はじめに → 目次 → 本文`。
- **小説（genre=novel）**: **目次は付けない**。**本文から開始**（はじめに等の前付けも基本不要）。

**Why:** Kindleの実書籍の標準構成に合わせないと素人っぽく見え、読者の信頼・読了率に影響する。

**How to apply:** DOCX(`packages/output/word/build-docx.ts`)/PDF(`packages/output/pdf`)の組み立てを **genre で分岐**。非小説は はじめに章を先頭→目次セクション→残り本文。小説は目次セクションを挿入しない。export タスク(`pipeline-book-export.ts`)が genre(theme.genre==='novel')を渡す。outline 生成も小説では はじめに/おわりに/目次 を要求しない。詳細仕様は docs/02・docs/05 に記録。関連: [[project_promotion_features]]
