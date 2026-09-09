---
name: reference-spacing-token-gotcha
description: A2P web の spacing トークンは tight/snug/relaxed/loose のみ。space-normal は未定義=no-op
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-26T08:39:19.035Z
---

**A2P web (apps/web) の Tailwind spacing スケールは `packages/ui/src/tokens.ts` の `spacing` だけ**（`tailwind.config.ts` は `spacing: tokens.spacing` で上書き）。有効キーは：
- `space-tight` = 8px / `space-snug` = 12px / `space-relaxed` = 16px / `space-loose` = 24px

**`space-normal` は存在しない**。にもかかわらず `px-space-normal` / `p-space-normal` / `gap-space-normal` 等が18ファイル・約65箇所で使われており、**全て無効クラス(no-op)＝左右パディング/ギャップが効かず要素が端に詰まる**不具合になっていた（監査ログ展開UI・ジョブ詳細系など。ユーザーが繰り返した「デザイン崩れ」の一因）。

**2026-08-25 一括修正**: source 全体で `space-normal` → `space-relaxed`(16px=妥当な"normal") に置換。next build 通過・web デプロイ済。**今後 spacing クラスを書くときは上記4キーのみ使うこと**（`normal` は無い）。関連: [[project-platform-portal]] [[project-home-dashboard]]
