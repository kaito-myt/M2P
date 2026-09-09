---
name: project_blog_covers
description: 栞ブログの良書紹介に実在書籍のAmazon書影を自動挿入(F-092); book_coverエージェント; cover_image_url
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-27T03:21:08.958Z
---

栞ブログ(/blog)の良書紹介記事に、紹介対象の**実在書籍の表紙画像**を自動で差し込む機能（F-092, 2026-08-27出荷・本番稼働）。従来の装丁風擬似カバー(PseudoCover)は**未解決時のフォールバック**に降格。

- **エージェント** `book_cover` (`packages/agents/src/book-cover`)。保存先 `blog_posts.cover_image_url`。
- **解決フロー(誤書影を絶対に出さない設計)**: ① LLM(sonnet-5)で書名/著者を同定 → ② `coreTitle`(副題を落とした先頭塊。副題込みだとAmazon商品名と字句が食い違い照合外れる)で「中核 著者」を**Amazon書籍検索**(`/s?k=&i=stripbooks`, `data-asin`抽出) → ③ **NDL(国会図書館)OpenSearch**の書名一致書誌のISBNも**常に**候補に足す(長い和書名でAmazon検索が関連書しか返さない保険) → ④ 各ASINの**`/dp/<ASIN>`実商品名を取得し中核書名を包含するときだけ採用**(=Amazon自身の商品名で本人確認。短い書名『優駿』等は著者名の裏取りも必須) → ⑤ Amazon書影(`P/<ISBN10>.09.LZZZZZZZ.jpg`)をbyte検証(欠品~43byte除外)。全て非致命(null→PseudoCover)。
- **⚠️やってはいけない(事故った)**: 「LLMが推測したISBNをそのまま/openBDの負の検証だけで採用」は**別の本の書影を掴む**(openBD未収録書で幻覚ISBNが実在の別書籍を指し、byteチェックは本の違いを見抜けない)。実際に平家物語→「ヒーロー!」等6/12件が誤書影になり運営者に指摘された。**必ずAmazon商品名で書名の本人確認をしてから採用する**こと。
- **Why:** キーレスの書籍タイトル検索API(Google Books=quota超過, openBD=収録率低, NDL title=曖昧一致)は単独で対象書を一意特定できない。「Amazon検索で実在ASIN→その商品名で本人確認」が唯一堅い。AmazonへのHTTPはデータセンターIPでCAPTCHAされ得るが、その場合も照合が通らずnull(誤書影でなくフォールバック)に安全側で倒れる。
- 自社本(`book_id`)がある記事は本棚のR2書影を優先。公開時に自動解決＋既存12記事はバックフィル済(`apps/worker/src/scripts/backfill-blog-covers.ts`, 12/12実書影)。
- gotcha: [[reference_sonnet5_no_temperature]](temperature渡すと400)。関連: [[project_home_dashboard]](栞ブログUI刷新), [[project_seo_agent]](blog_seo)。
