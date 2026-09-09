---
name: project-fiction-writing
description: 小説・フィクションは実用書と書き分ける（だ・である調＋詩的描写＋章立て/小見出し廃止）
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-28T15:37:14.517Z
---

**小説の品質改善(2026-08-23)**: ユーザー指摘「小説に章立て/小見出し不要・ですます調は変・表現が稚拙→詩的に」を受け、**フィクション系ジャンルだけ書き方を分岐**した。

- **判定**: `packages/contracts/src/genres.ts` の `FICTION_GENRES`(novel/light_novel/mystery/sf_fantasy/romance_fiction/historical_novel/horror)＋`isFiction()`。
- **根因**: 文体「ですます統一」「`##`小見出し」「各小見出しごとに実践手順」「箇条書き」は**DBプロンプトではなくエージェントの `buildUserMessage` にハードコード**され全ジャンルに適用されていた。さらに **Editorが「だ・である混在→ですますに統一」を指示**し、である調小説を差し戻していた。
- **修正**: `packages/agents/src/writer/chapter.ts`・`writer/outline.ts`・`editor/index.ts` を `isFiction()` で分岐。小説は「だ・である」調・`##`見出しや箇条書き禁止・subheadingsは「場面(シーン)の流れ」内部メモ扱い・はじめに/おわりに無し・情景/心情/比喩/余韻で「見せる」文学的表現。実用書は従来どおり。共通指針 `FICTION_STYLE_DIRECTIVE` を `genreGuidance()` がフィクション時に `{genre_guidance}` へ追記し Writer/Editor/Judge 全プロンプトに注入(runtime、DB再seed不要)。テスト追加(chapter.test.ts ジャンル別文体)、docs/02 F-004更新。contracts/agents typecheck・全373テストPASS。
- **注意**: これはランタイムエージェント(worker)のコード変更 → **本番反映は worker サービスの `railway up` が必要**(未実施)。章数7〜10・subheadings最小2はzodスキーマ強制のまま(真の自由章立てにはスキーマ移行が要る=未)。Judgeは criteria がDBプロンプト由来なので genre_guidance で自動的にフィクション文脈化される。

**出力構成の分岐バグ修正(2026-08-28)**: ユーザー要望「実用書/ビジネス書は はじめに→目次→本文→おわりに 構成に。小説以外はそう」。調査すると docx(`packages/output/word/build-docx.ts` `isNovel`)・PDF(`build-pdf.tsx`)は既に「実用書=はじめに→目次→本文、小説=目次なし本文から」を実装済みだった。**ただし `apps/worker/src/tasks/pipeline-book-export.ts` の `isNovel = book.theme?.genre === 'novel'` が純粋な'novel'のみ判定**→ライトノベル/ミステリー等 novel 以外の6フィクションが実用書扱いで目次付きになる不具合。`isFiction(book.theme?.genre)` に修正(FICTION_GENRES全7種)。はじめに/おわりに章はアウトライン生成プロンプトが非フィクション必須化済み。docs/05 §5.3.9更新。worker再デプロイ済み。

**バッチ計画の工程可視化(2026-08-28)**: ユーザー要望で `/batches` の各本に粗い book.status ではなく「今の処理工程」を表示。`apps/web/app/(app)/batches/page.tsx` に最新 `pipeline.book.*` ジョブ→日本語工程ラベル(企画・リサーチ/構成作成/本文執筆/編集/表紙画像生成/品質審査/メタデータ最適化/出力生成 + 状態サフィックス中/待ち/完了/失敗)を実装。web再デプロイ済み。

**章あたり文字数の壁と増量方針の是正(2026-08-28)**: 「200〜300ページ級」を狙い誰かが `targetTotalChars` 120k/14章(=約8500字/章)に増量したが、**モデル(sonnet-4-6)は1章1発で約4700〜5600字が上限**で、`writer.chapter.chars_out_of_range` が多発(本番実測: 3回リトライしても actual=4722 vs target=9000)。原因は「1章が長すぎ」。**対策**: ①`chapter.ts` に文字数フィードバック付きリトライ(短ければ実測を伝え増量再生成、最大3回)を追加。②`CHAR_TOLERANCE` 0.35→**0.5**(移行期の高め目標アウトラインも本文が書けていれば通す)。③方針転換=「章あたり目標を下げ章数で総量を稼ぐ」: `contracts/writer.ts` `targetChapterCount` default 14→**22**/max 18→**30**、`WriterOutlineOutputSchema.chapters` max→30、outline-review chapters/indices/revised max→30、`targetTotalChars` max 160k→200k。④`outline.ts` プロンプトに「各章 target_chars は4,000〜6,500字/章数10〜28」を明示。⑤テスト更新(chapter ±50%境界、outline 章数31→invalid)。→ 120k÷22章≒5,500字/章で達成可能に。**注意: 真の300ページ超は章数をさらに増やすか章内分割生成が要る(未)**。停止本の既存アウトライン(8500字/章)も tolerance 0.5 で完成可(実長は約半分=~115ページ)。worker/web 再デプロイ済み。

関連: [[project-pipeline-settings]] [[reference-model-assignment-routing]] [[reference-pipeline-stuck-books]]
