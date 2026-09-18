---
name: project-sns-persona-visuals
description: SNS ペルソナ「ことは」の画像は実写・顔なし・首から下に統一 (2026-09-18)。IG はカルーセル(固定テンプレ枚あり)、投稿本文には character_sheet を注入。OpenAI 画像の安全フィルタで使えない語彙の実測
metadata: 
  node_type: memory
  type: project
  originSessionId: 80ff9c8a-2155-4f98-a6c0-5becb68318b9
  modified: 2026-09-18T02:56:40.824Z
---

**運営者要望 (2026-09-18)**: (1) 顔を出さず首から下だけ、(2) 体はセクシー寄りで男性フォロワー狙い、(3) イラストではなく実写（「実際に人が運用している」印象）、(4) IG はカルーセルで 1 枚は固定の型、(5) 投稿本文にもキャラクター性。

**実装**:
- 人物ルール = `packages/agents/src/lib/persona-visual.ts` `PERSONA_VISUAL_RULES` / `withPersonaVisualRules()`。sns_strategist の avatar/banner、IG 固定テンプレ枚 (`apps/worker/src/tasks/promotion-post/carousel.ts`)、Veo フック (`promotion-video-generate.ts`) に付加。
- IG カルーセル: `defaultBuildMediaUrls`(instagram) が 3〜6 枚 (見出し→要点カード→固定テンプレ枚)。テンプレ枚はチャンネルごとに 1 回生成し `promotion_channel_settings.config_json.carousel_template_key` にキャッシュ。Zernio port は `mediaItems` に全枚 (2〜10 でカルーセル化)。Make webhook 側は未対応。
- 再生成 = `scripts/regen-channel-visuals.mjs`（`--channel=` `--only=` `--force` `--dry-run`、失敗は継続して最後に一覧）。5 チャンネル分の avatar/banner/template を 2026-09-18 に再生成済 (旧版 `.bak-2026-09-18T0217`)。プロフィール画像の SNS 反映は運営者手動。
- キャラクター性 (F-097): `strategy_json.character_sheet`（既定 `DEFAULT_PERSONA_CHARACTER_SHEET`）を content_creator/promoter/anp.promo/content_optimizer へ注入。DB プロンプト新版投入 = `pnpm --filter @a2p/db exec tsx apply-character-sheet.ts`。

**OpenAI 画像の安全フィルタ実測 (safety_violations=[sexual], 3 回試行)**: 「かなりセクシー」「体のラインが出る/体型を強調」「下着姿・ヌードは描かない（否定形でも NG）」「ショートパンツ/オフショルダー/太もも」「slim feminine silhouette」「short pleated skirt」は拒否。通ったのは「実写・首から下(鎖骨〜腰)・きれいめで女性らしい着こなし（薄手ニット/ブラウス/ワンピース/膝丈スカート）・スタイルが良く見える上品なコーデ」。同一プロンプトでも確率的に拒否されるので再試行が要る。**Why:** 運営者の「セクシー」要望はモデル側の制約で「きれいめ・スタイル良く」までしか実現できない。**How to apply:** 露出/体型を直接指示する語は入れず、着こなし・構図・実写質感で表現する。

関連: [[project-sns-reboot]] [[project-promotion-features]]
