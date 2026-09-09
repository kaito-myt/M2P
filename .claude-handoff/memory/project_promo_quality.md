---
name: project_promo_quality
description: 販促コンテンツ品質改善イニシアチブ(5インクリメント)の設計と進捗
metadata:
  updated_2026_08_24: |
    販促品質の大改修を本番反映(worker deploy SUCCESS + DBプロンプト更新)。
    【TikTok動画バグ修正(code)】①文字化け=バンドルNoto Sans JPがsubset(7466字, ～①★→絵文字欠落)→compose-cover.ts に glyph coverage サニタイザ(sanitizeForFont/円マーク丸数字置換・絵文字除去)＋video-render.ts wrapCaption も sanitizeTelopText。②改行=wrapByWidth/wrapCaptionに禁則処理(行頭・行末禁止)。③起承転結=tiktok-video/index.ts のシーン間引きを「先頭+末尾」→等間隔サンプリング(承転を残す)。
    【DBプロンプト(即効・更新済)】tiktok_scenario/editor=起承転結の骨格＋5〜6シーン＋テロップに絵文字/記号禁止。content_creator=「育成/本の宣伝禁止」→「良書紹介(実在の良書を1冊, この本読みたいと思わせる)＋媒体別フック＋自己チェック」に転換(codeのbuildContentCreatorUserMessageも同時修正=これが支配的指示)。promoter=X_postsの1行目フック強化(発見/違和感/教えたくなる)＋note_article=2,000〜4,000字の読み応え記事に。
    【apply-*.ts】content-creator/promoterを update-capable化(既存行の body 差分更新)。tiktok-videoは元から更新対応。適用=DATABASE_URL=<prod> pnpm --filter @a2p/db exec tsx apply-*.ts。
    【残(未着手)】(a)IG/TikTokのstrategy_json content_pillars/example_postを良書紹介ピラーへ(DBデータ, sns_strategist)＋auto_enabled確認。(b)販促ロールのモデル最適化(Strategy=gpt-5, 大量生成=gpt-5-mini等。GPT-5.6 Sol/Terra/Lunaは未登録→gpt-5系へ写像)。(c)8軸スコアリング(Scroll Stop/Novelty等60点未満ボツ)を採点AIとして分離。全373+10テストPASS。 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-24T06:53:21.248Z
---

2026-07-23 開始。ユーザー指示: 販促投稿の質を上げる。IGはハッシュタグ無し/URL非クリック/画像が
買いたくならない、マーケターが売れてる投稿を分析して戦略を練る、日次で高インプレ投稿の傾向分析、
TikTokのテンポ改善、A/Bで勝ちフォーマット採用。ユーザーは Increment 1-4 を選択(+TikTokも)。

**設計根拠**: `docs/08-promo-playbook.md`(web調査の勝ちパターン集。IG画像=ベネフィット見出し主役/
4:5/数字/単一アクセント/KUバッジ/表紙は証拠、HVCキャプション、タグ10-15の3層、投稿時間、
TikTok=8-12シーン/1.5-3s/21-34s/フック≤1s/クリフハンガー、A/B変数と勝ち指標=シェア+保存+リンクCTR)。

**5インクリメント**:
1. ✅ 即効修正(commit 24934ef, 本番反映済): resolveHashtags()で戦略タグ空でもデフォルト本紹介タグに
   フォールバック→全生成経路で必ずタグ付与(blog除外)。IGは生Amazon URL廃止→「プロフィールのリンクから」。
   `/books` 公開ランディング新設(link in bio先, 出版済み書籍を表紙+Amazon導線, auth allowlist)。
   既存value投稿は content.generate 再実行で再生成済。**運営者作業: IG bioに /books URL設定**。
2. ✅ 買いたくなる画像(commit b16189a, worker deploy済): `compose-promo.ts` を 4:5(1080×1350)・
   ベネフィット見出し主役・表紙は下部の証拠・数字ランをアクセント色強調(splitNumberRuns)・新刊/KU読み放題
   バッジ・eyebrow(target_reader)・CTA に刷新。**重要バグ修正**: opentype.js が非整数 baseline で NaN 座標
   パス生成→librsvg が黙って描画を落とす(見出しの一部が消える)不具合を linePathLeft の整数丸めで解決。
   回帰テスト付。出版済み2冊の promo_image_key を null 化→次回投稿で新デザイン再生成。
3. ✅ 研究駆動プレイブック(commit 80170a8, F-064, prod seed+ALTER済): promo_strategist エージェント
   (web_search でバズ投稿分析→PromoPlaybook 生成, role/WEB_SEARCH_ROLES登録, prompt=Opus)。
   `promotion.playbook.refresh {channel}` タスクが戦略chごとにリサーチ→`promotion_channel_settings.
   playbook_json` 保存。日次見直し(content_optimizer)に `playbook_guidance` 注入→全予定投稿が勝ちパターンで改善。
   **未実装(follow-up)**: 週次cron自動化、UIカード表示、promoter/tiktok_scenario等の新規生成への注入。
4. 🚧 実データ最適化+A/Bテスト: 2026-07-23 保留 → **2026-08-10 着手(ユーザー再指摘「X/IGに反応が無い/実績を追って戦略を練れているのか」)**。
   **重大な発覚**: エンゲージメント指標をどこにも保存しておらず(promotion_posts に impression/like列なし・metrics表なし)、
   戦略エージェント promo_analyst の入力は「posted/scheduled/failed 件数＋印税」のみ＝**実際の反応を一切見ずに戦略を立てていた(盲目)**。
   さらに投稿過多(実測 X 220/IG 219 = 各1日約16件, 新規小規模アカウントに大量投下で反応ゼロ=逆効果)。
   ユーザー決定=「Xから実測着手＋全体設計」「投稿量を減らす(質重視)」。対応(2026-08-10, worker deploy済):
   - **実測トラッキング backbone**: `promotion_posts` に impressions/likes/reposts/replies/metrics_fetched_at 列追加(prod ALTER済)。
     worker `promotion.metrics.fetch`(日次cron・常時ON, `apps/worker/src/tasks/promotion-metrics-fetch.ts`)=X の保存済み tweet ID から
     `GET /2/tweets?tweet.fields=public_metrics`(OAuth1, `buildXAuthHeader('GET',...,{extraParams})`)で取得しDB保存。テスト付。docs/02 F-072。
   - **投稿量抑制**: `promotion-posts-generate.ts` で 1書籍あたり x_posts を先頭3件に制限＋SNS間隔2日(`MAX_SNS_POSTS_PER_BOOK=3`/`SNS_INTERVAL_DAYS=2`)。docs/02 F-052改善。
   - **未実装(次段)**: (a) X APIプランの読み取り可否を初回実行で検証(Basic~$200/月が要る可能性→非OKなら skip_reason 記録)、
     (b) promo_analyst 入力に実エンゲージメント要約を接続し「伸びた型を増やし/伸びない型を止める」自律最適化を閉ループ化、
     (c) IG/TikTok は投稿ID保存(Zernio返却id)→インサイト取得(Zernio分析API or Meta Graph=IGビジネス+審査)。

**追加(2026-08-12)— 実測がバグで動いていなかった→修正、そしてSNSグロース施策へ方針転換(F-073/GROW)**:
- **重大バグ(修正済)**: F-072 の実測は列を raw ALTER したのに **schema.prisma 未追加＋prisma client 未再生成** で
  `promotion.metrics.fetch` が実行時 `Unknown argument metrics_fetched_at` で毎回落ち、X APIを一度も叩けていなかった
  (実測ゼロの真因はAPI課金枠でなくこのバグ)。schema.prisma に impressions/likes/reposts/replies/metrics_fetched_at
  追加→generate→deploy で解消。**教訓: DB列を raw ALTER したら必ず schema.prisma にも足して prisma generate する**。
- **X API読み取りは現行枠で可**(課金アップグレード不要): `GET /2/tweets?tweet.fields=public_metrics` も
  `GET /2/users/me?user.fields=public_metrics`(フォロワー数) も 200 で返る。
- **実測(2026-08-12)が残酷**: X直近100投稿の平均インプレッション=1・最大9・総いいね1。到達≒ゼロ。
  → **根本問題は投稿の質でなく到達/フォロワー不足**(フォロワーゼロの冷たいアカに連投=虚空、量ほど逆効果)。
  私が従来言っていた「投稿の質を上げる」は的外れだった。
- **ユーザー方針**: 「投稿だけでなく様々な方法でSNSフォロワーを長期的に伸ばす施策を実行しなさい」。SNS継続だが
  ブラスト→フォロワー育成へ。[[feedback_autonomous]] に沿い段階実行。
- **GROW-1(F-073) 出荷**: `promotion_growth_snapshots` 表(フォロワー日次スナップ)＋ worker `org.promo.tick`
  (日次`0 16`常時ON, `apps/worker/src/tasks/org-promo-tick.ts`)=実測評価→reach_critical/growth_stalled/cold_start で
  promotion本部に `growth_alert`(needs_human)起票＋**LINEプッシュ**(財務enforce_limitと同型の自己申告ループ)。
  contracts に `growth_alert` kind追加。テスト付。docs/02 F-073・docs/06に記載。
- **GROW-2〜4 未着手(F-074)**: 2=コンテンツmix是正(value主役化/総量実効削減), 3=安全なエンゲージメント(お礼リプ),
  4=ターゲットフォロー/価値リプ(バンrisk高→運営者quota制)。GROW-1計測を前提に効果測定しながら段階実行。

**追加(2026-08-14)— 投稿停止＋フォロワー不成長の再発、方針決定**:
- **投稿が7日間ゼロで停止**していた。原因=promo投稿は本パイプライン内生成だがパイプライン停止で供給断＋value投稿にcron無し。
  → 全5ch(x/ig/tiktok/note/blog)に `promotion.content.generate` を手動再投入して復旧。**恒久策=value日次cadence cron(GROW-2)未実装**。
- **フォロワーX=2人/フォロー0**で変わらず。伸びない根本=能動エンゲージメント皆無(虚空発信のみ)。
- **ユーザー決定=「積極(中〜高リスク)」**: Xの能動エンゲージメント自動化を積極強度で実行してよい(BANリスク承知)。実装は**ランプアップ**で(新規2フォロワーの積極自動化は即凍結リスク最大のため、目標は積極・立ち上げは段階的)。
- **重要な制約**: 能動フォロー/いいね/検索の自動化は**Xのみ**(OAuth1でPOST /2/users/:id/following等)。**IG/TikTokはZernioが投稿専用でフォローAPI無し**→コンテンツ品質＋相互導線でしか伸ばせない。noteも同様。
- **X APIティア要確認**: metrics取得(GET /2/tweets)は現行枠で可だったが、**search/recent・follow・like が現行枠で叩けるか未検証**(Free枠だと不可の可能性→Basic $100/月要否はユーザー課金判断)。engagement engine構築の最初のゲート。
- **書籍本文の品質(ユーザー指摘)**: Judge(レビュアー)は6軸ルーブリック採点で**読者になり切った"続きを読みたいか"評価をしていない**。Writerも明快/正確/構成優先で**"思わず読み進める"(フック/好奇心ギャップ)を明示指示していない**→「正しいけど退屈」に陥りがち。**CONTENT-1(未実装)**=Writerにページターナー指示追加＋読者ペルソナ書籍レビュー工程新設(SNSのcontent_optimizerペルソナ判定を本文にも適用)。
- **出版通知(PUB-3)出荷**: `kdp.publish.digest`(日次JST7:30)で公開/審査待ち/作成上限待機/失敗を毎朝LINE。実機で通知成功確認。出版停滞の主因は**KDP作成上限1日5冊**(CREATE方式が枠消費)。[[reference_kdp_creation_limit]] [[reference_kdp_publish_authwall]]

**重大バグ(修正済 commit e792464)**: /shop改名時 git mv がフォールバック(plain mv)になり公開 books/page.tsx
の削除が未コミット→HEAD に公開/books と管理(app)/books の2ルートが残り **web ビルドが d33d07b 以降ずっと
失敗**(ログインロゴ/shop/IG URL/TikTok別タブが本番未反映だった)。削除確定で解消。教訓: git mv 後は
`git ls-files` でHEADの実体を確認する。
5. ✅ TikTokテンポ改善(commit 73ae72b, prod prompt更新+worker deploy済): tiktok_scenario/creator/editor
   プロンプトを playbook準拠に刷新(フック1秒=警告/リスト/好奇心/逆張り型, 8〜12ビート, 各narration短文
   15〜35字, caption 8〜16字, クリフハンガー)。**クリップ長は narration の TTS 尺で決まる**(-shortest,
   secondsフィールドは render 未使用)→短文化=短カット。video-render に atempo=1.12(ブリスク化,ピッチ保持)。
   apply-tiktok-video を upsert 化。未実装の伸びしろ: BGM/ズーム(Ken Burns)/トランジション。

**追加(2026-07-24, commit 01b1398)— 投稿の戦略準拠＋ペルソナ品質ループ**: ユーザー指摘「X/IGの投稿が戦略に沿ってない/品質チェックしてない/読者ロールモデルからFBもらって改善して」。根本原因=**promo投稿を作る `promoter` は戦略を全く読んでいなかった**(末尾にcoreタグ足すだけ)。value投稿(content_creator)は戦略使用済。
- 対応: `content_optimizer` を **ペルソナ×戦略ゲート**に強化。契約に `content_pillars`/`persona` 入力＋`score`/`on_strategy`/`persona_reaction` 出力を追加。エージェントがペルソナになりきり評価→戦略(コンセプト/トーン/柱)準拠へ改稿。
- `buildAudiencePersona(profile, {bookTargetReader})`(contracts/agents/sns-strategist.ts)=戦略+書籍想定読者→ペルソナ文。
- 共有ヘルパ `apps/worker/src/tasks/promotion-post/persona-review.ts` `reviewDraftsWithPersona`(メタ混入/promo URL落ちガード)。
- **組込み**: `promotion.posts.generate`(promo・生成時にゲート通す=戦略無視を矯正)＋`promotion.review.daily`(日次)。`promotion_posts += quality_score, review_reason`(本番ALTER済)。DBプロンプトは無改変(指示はuser messageに集約)。
- **未実装(follow-up)**: quality_score の web UI 表示、value生成(content.generate)へのゲート、promoter自体を戦略対応にする(現状は後段矯正)。

**追加(2026-07-30)— CTA/KU無料訴求の二重化バグ修正(SNS品質)**: ユーザー指摘「SNS投稿の品質が低い」。実物調査で判明した低品質の実態=1投稿内で「Kindle Unlimited会員は無料」と「プロフィールのリンクから(どうぞ/見に来てください)」が**各2回**出て冗長・機械的。原因=`sanitizePromoBody`(packages/contracts/src/promotion/channels.ts)がLLM本文の KU無料訴求(「無料でお読みいただけ」等、数字が無く PRICE_SENTENCE_RE に非該当)と プロフィールリンク導線 を落とさず、`finalizePromoBody` が canonical(priceFactLine の「Kindle Unlimited会員は0円」＋IG_NO_LINK「プロフィールのリンクから見に来てください」)を追加注入して二重化。**修正**: (1) `KU_SENTENCE_RE` 追加で LLM本文の KU/読み放題/無料で読み 系文を除去、(2) `isCtaPlaceholderLine` に「プロフィール/プロフ/bio + リンク」行判定を追加。回帰テスト(実障害サンプル)付。**注意**: 既存の scheduled 投稿は二重化のまま(再finalizeは注入済priceLineを KU_SENTENCE_RE が食うので破壊的→やらない)。新規生成分から改善。**デプロイ**: commit済だが Railway が「Deploys have been paused temporarily」で保留中→un-pause後に `railway up --service A2P-Worker`。

**追加(2026-08-01)— 公開ブログ/本棚を独立ブランド「栞 -SHIORI-」へ刷新**: ユーザー指示「ブログのデザインがくそ→名作本を紹介する高デザインブログに/A2Pに固執せず読者向けに/アイコンもA2P無関係に/ヒーローはコンセプト訴求」。対応(commit a0e548d, d30ad2b, web deploy済):
- `/blog`(一覧)・`/blog/[slug]`(記事)・`/shop`(本棚) を **A2Pブランドから切り離し** 独立ブックジャーナル「栞 -SHIORI-」に統一。配色は A2P design token 非依存の独自パレット(paper #F7F1E3 / ink #1B1714 / green #1E5B49 / terracotta #C6572E / line #E6DECB)＋ serif 見出しでエディトリアル化。
- **栞(しおり)シンボルを gpt-image-2 で生成** (`railway run --service A2P-Worker node <script>` で OPENAI_API_KEY 注入→sharp で角丸512化)。ファビコンは Next.js route-segment icon = `apps/web/app/blog/icon.png` と `apps/web/app/shop/icon.png`(A2Pと無関係)。原画=`public/blog-mark-source.png`、ヘッダ用縮小=`public/blog-mark.png`、OG=`public/blog-og.png`。
- ブログのヒーローは「今日の一冊」ではなく **ブログのコンセプト訴求(良い本を読む習慣)**。最新記事は本文冒頭の横長ハイライトカードに移設。
- **中身(コンテンツ)は未着手**: 記事本文はまだ自社告知寄り。次段=名作本レビュー生成エンジン(book_reviewer + blog.review.generate + cron)でジャンル一致のA2P本を関連推薦しながら日次投入予定。note の Playwright 自動投稿も follow-up。

**追加(2026-08-15)— 手動グロースToDo生成(F-075)出荷・実機検証済**: IG/TikTok/noteはフォローAPI無し→自動化不可。
新role `growth_scout`(web_search, anthropic/claude-opus-4-8, DBシード済 prm_growth_scout_v1/ma_growth_scout_v1)が
チャンネル別に**実在の・フォロー/いいねすべき具体ターゲット**(@ハンドル・投稿URL・理由・優先度)を特定→
worker `promotion.growth.todo`(週次`0 22 * * 1`常時ON)が **needs_human org_task(kind=growth_manual, ch別1件upsert)** ＋LINE要約で提示。
`/org`タスクボードは`<details>`展開で全文チェックリスト表示。実機検証: note/tiktok/instagram 各15件の実在ターゲットToDo生成＋LINE通知成功。
contracts=`@a2p/contracts/agents/growth-scout`。テスト付。docs/02 F-075・docs/06。
**X積極エンゲージエンジン(F-076)出荷(2026-08-17)**: X APIは**現行(有料)ティアで search/recent・follow・like いずれも200**で叩けることを実機確認(Free枠不可のはずのsearchが通る=Basic+確定)。worker `promotion.x.engage`(1日3回`0 1,7,13`)=読書ニッチ検索→いいね＋著者フォロー。ガード: `x_engage_enabled`(既定OFF・キルスイッチ)＋ランプアップ`dailyCap`(初日8→15→22→巡航30, ユーザー選択「積極」)＋1回最大6＋ジッター＋大手>3万除外＋`promotion_x_engagements`(action,target一意)で二重防止＋429/403で即停止&LINE。テスト付。OAuth1 POSTはJSON body非署名。docs/02 F-076。
**IG/TikTokも自動化する決定(2026-08-17)**: ユーザーが規約違反・凍結リスク承知で「IG/TikTokもボット自動化する」を選択。公式APIにfollow/like無し→**KDPと同じPlaywrightで実装予定(F-077)**。ただし**最初の関門=ログイン済みブラウザセッション確保**(IG/TikTokはデータセンターIPログインを強く警戒→運営者の初回headfulログインでstorageState取込が現実的)。未着手。
**書籍本文品質(CONTENT-1)出荷(2026-08-17, F-079, DBプロンプトのみ即時反映)**: `writer`に「読み進めたくなる文章」節(冒頭フック/好奇心ギャップ/絵が浮かぶ具体/リズム/次への引き)、`judge`に「"想定読者そのもの"として読み、続きを読みたくなるか・退屈しないかを最優先で採点、退屈原稿はbenefit_clarity/genre_fit大幅減点、overallに"どこで読む手が止まるか"明記」を追加。次回book生成に反映。
**F-078(話題一致ハッシュタグ＋グロース使命プロンプト)出荷済**: pickTopicHashtags(core先頭→話題rotating→残core, X重み対策で話題タグ優先)＋content_creator/content_optimizer/promoterに「唯一の使命=フォロワー増、伸びなければクビ」mandate。実機で5/8投稿に話題タグ付与確認(貯金→#家計簿#貯金, 競馬→#競馬)。
**残: IG/TikTok Playwrightボット(F-077)＝要運営者初回ログインでセッション確保**。

[[project_promotion_features]] に販促機能全体。
