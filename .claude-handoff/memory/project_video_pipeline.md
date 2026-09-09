---
name: project_video_pipeline
description: TikTok/IGリール動画生成 — Veo3.1ハイブリッド(F-084)＋既存スライドショー(F-060)
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-20T01:34:28.587Z
---

**動画パイプライン** `promotion.video.generate`（worker）:
- **既存(F-060)**: 多エージェント台本(`createTikTokVideoScript`)→ シーン毎に gpt-image縦型画像＋Noto テロップ焼込＋OpenAI TTS＋ffmpeg → 9:16 mp4 → R2 → promotion_posts(tiktok, media_key)。`video-render.ts`。
- **F-084 (2026-08-20)**:
  - **IGリール流用**: 生成mp4を同一 media_key で instagram の予約Reelにも複製(2hずらし, `also_reels` 既定true)。**Zernio(getlate)ポート**が `.mp4` を検知して IG も `type:'video'`(Reel)投稿。投稿経路: instagram/tiktok は ZERNIO_API_KEY 経由(公式審査済)。TikTok自前API審査は恒久却下のためZernio必須。
  - **Veo 3.1ハイブリッド**: `video_use_veo_enabled`(app_settings, 既定OFF→本番ON) 時、**冒頭フック(scene0)のみ Veo実写級**、残りは画像スライド。運営者選択=ハイブリッド(1本≈$1-2/月$30-60)。`veo-clip.ts`: Gemini API `predictLongRunning`(veo-3.1-**fast**既定/lite/standard, 9:16, 8秒, x-goog-api-keyヘッダ)→10秒間隔ポーリング→`response.generateVideoResponse.generatedSamples[0].video.uri`をDL。冒頭clip=9:16クロップ＋ffmpeg drawtext(`notoSansJpBoldPath()`)＋TTS。**Veo失敗時は画像スライドへ自動フォールバック**。コスト=token_usage(provider='google', role='veo_video')。GOOGLE_GENERATIVE_AI_API_KEYはVeo3.1 3ティア利用可(確認済)。
- 動画投稿の実行可否は promo_auto_post_enabled + 各チャンネル auto_enabled。関連 [[project_promotion_features]] [[project_growth_autonomy]]。
