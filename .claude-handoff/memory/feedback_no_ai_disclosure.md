---
name: feedback-no-ai-disclosure
description: 生成本の本文にAI生成開示文を入れない方針（読者離脱防止）
metadata: 
  node_type: memory
  type: feedback
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-07-24T06:44:41.795Z
---

各本の末尾に「これはAI生成コンテンツです」的なAI開示文を**本文には入れない**。読者が離れるため。

**Why:** ユーザー要望(2026-07-24)。KDPのAI開示義務は入稿フォームの「AI生成コンテンツ」設問で満たす運用なので、本文中の開示は不要。

**How to apply:** `AppSettings.ai_disclosure_text` が既定で空(''). Editor(`packages/agents/src/editor/index.ts`)は非空のときのみ最終章末尾に1回挿入、空ならstep8でLLM付与分も除去・step9未挿入。`DEFAULT_AI_DISCLOSURE_TEXT=''`、本番app_settingsも空に更新済。将来この挙動を戻す/改変する提案はしない。関連: [[project-kdp-sales]]
