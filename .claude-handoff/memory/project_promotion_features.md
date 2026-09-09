---
name: project_promotion_features
description: 販促(SNS)/画像/ジャンル機能の現状と、未着手の3機能の確定設計
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-07T03:08:12.396Z
---

**Zernio(getlate) 投稿代行に IG/TikTok を移行 (2026-08-06 本番稼働・IG/TikTok公開検証済み)**: TikTok自前API恒久却下＋IGのMake不安定を受け、**Zernio**(審査済みパートナー, `https://zernio.com/api/v1`, Bearer `ZERNIO_API_KEY`)に間借り。**料金=アカウント課金制で最初の2アカウント無料** → IG+TikTok の2つは**無料**(投稿ごとの従量なし)。X は3つ目=$6/月。
- **本番検証完了(2026-08-06)**: `ZERNIO_API_KEY` を A2P-Worker env に登録→worker/web デプロイ→`promotion.dispatch`→`promotion.post.publish`で **IG(画像1080²)・TikTok(9:16 mp4, PUBLIC_TO_EVERYONE) とも `zernio post published`＋status=posted を確認**。IGはMake経路を廃しZernioが本番デフォルト。`promotion_channel_settings.tiktok.auto_enabled=true` に戻し自動運用再開。**運営者残作業: (1) Make(Core)解約OK(IGはもうMake不使用), (2) 旧セッションで作った文字化けIGテスト投稿を IGアプリで手動削除(API削除不可)**。
- **TikTok動画シーン上限 `MAX_SCENES=6` 追加(2026-08-06)**: 初回本番検証で台本が11シーン→gpt-image11回→約12分と過大だった。`createTikTokVideoScript`(packages/agents/src/tiktok-video/index.ts)に scenario=beats3〜5/editor=6本以下指示＋**コードでハード間引き(先頭MAX-1+末尾CTA)**。尺はTTS音声長(-shortest)で決まるためシーン数がコスト/時間の主因。
- **接続済み**(both `goodbooks_intro`): IG accountId=`6a72f59ed0fe733d1a469442`(perm `instagram_business_content_publish`), TikTok accountId=`6a72f3abd0fe733d1a461e5a`(perm `video.publish`), profileId(共通)=`6a72edf6ca022b3c840f01f7`。
- **API**: `GET /v1/accounts`(接続一覧), `POST /v1/posts`{content, publishNow:true, profileId, platforms:[{platform,accountId}], mediaItems:[{type:'image'|'video',url(公開HTTPS)}], tiktokSettings(privacy_level PUBLIC_TO_EVERYONE等)}。**画像はIG規格4:5〜1.91必須**(0.75〜1.91)＝本表紙0.67は弾かれる。A2P生成のvalueカード1024²/promo1080²は正方形でOK。**公開済み投稿はAPI削除不可**(削除は各SNSアプリで手動)。
- **IG公開投稿=ライブ検証済み(成功)**。実装: `apps/worker/src/tasks/promotion-post/zernio-publisher-port.ts`(accountId/profileIdは GET /accounts で自動解決・メモ化)。`promotion-post-publish.ts` resolvePort に「IG/TikTok && ZERNIO_API_KEY → Zernio最優先」を追加(Make/Ayrshare/自前TikTokより先)。**ZERNIO_API_KEY未設定なら従来経路のまま=無破壊**。
- **本番化=完了(2026-08-06)**: 上記すべて実施済み。動画パイプライン(TV-1〜4)は既に実装済み(video-render.ts/tiktok-video.ts, ffmpegはDockerfile)で新規構築不要だった。
- **X判断**: 投稿だけなら公式API継続が最安(無料)。**インプレッション等の分析が欲しいならZernio $6/月**(X公式でデータ取ると$200/月〜)。IG/TikTokは無料枠なのでZernio Analyticsのインプレッションがタダで付く→将来KPIに取り込み可。
- 注意: TikTokアクセストークンは24h失効だがZernio自動更新(`needsReconnection:false`)。ローカルGit Bashのヒアドキュメントで日本語が文字化けする(CP932事故)→ローカルcurlテスト時は注意、**本番Node workerはUTF-8で正常**。

**SNS投稿品質=市場リサーチを生成器に接続 (2026-08-07)**: 品質が低い根因は、`promo_strategist`(web_search)が作る**販促プレイブック(`promotion_channel_settings.playbook_json`)を後段のcontent_optimizer(微修正)しか使わず、本体の生成器(promoter/content_creator)が市場リサーチ抜きで投稿していた**こと＋`promotion.playbook.refresh`が**crontab未登録で一度も定期実行されていなかった**こと(instagramに2週間前の1件だけ)。修正: (1) crontabに週次追加`0 16 * * 1`(火01:00 JST, 静的常時ON, id=promotion-playbook-refresh-weekly), (2) `promoter`/`content_creator`の入力に`playbook_guidance`追加し生成時に`playbookToGuidance(playbook_json)`注入(promoterはx/ig/noteを結合), (3) 全チャンネルのplaybookを即時再生成。以後SNS投稿は生成段階から研究ベース。docs/05 F-064拡張に記録。

**孤児ジョブ/停滞の掃除 (2026-08-07)**: (a) テーマ「ずっと生成中」=内部`jobs`がrunning/queuedのまま孤児化(8/3にmarketer.theme schema失敗→リトライ→worker再起動で中断→statusがrunning残留)。対策=`locks.sweep`(毎時)に`sweepStaleJobs`追加(running/queued かつ created_at 120分超→failed)＋pipeline-theme-generateのCAS再入で finished_at/error クリア。(b) 数日〜2週間runningのまま停止していた本9冊(大半ラノベ=対象外)＋停滞sales_fetch_runs 12件を failed 化。

**自動出版=KDP作成上限で永久ループしていた (2026-08-07)**: kdp.submit.dispatchは動作していたが、KDPの「1日5冊作成上限」でstep1 blocked=creation_limitになり、`creation_limit`時に`kdp_publish_queued`を落とさず**30分ごとに同じ本でCREATE再試行→枠を浪費し永久ブロック**。対策=books.`kdp_submit_cooldown_until`列追加+kdp-submitがcreation_limit/no_draft時に~20hクールダウン設定+dispatcherがクールダウン中を除外(1日1回だけ試行)。**サーバからの新規タイトル完全自動出版はKDP制限で不安定=正道はローカルassist(`bash scripts/kdp-assist.sh`, 下書きresume=枠非消費)**[[project_kdp_publish_assist]][[reference_kdp_creation_limit]]。売上取得(sales.fetch)は日次done で正常稼働中。

**TikTok API 恒久却下 (2026-08-04) → Zernio経由で公開再開 (2026-08-06)**: TikTok for Developers の審査で「個人/社内利用(personal or internal company use)は非対応」として却下。自前API直叩き(F-063)は下書き止まりで公開不可。→ **審査済みパートナー Zernio 経由で PUBLIC 公開を実現・本番検証済み**(上記 Zernio ブロック参照)。`tiktok.auto_enabled` は 2026-08-06 に true へ戻して自動運用再開。以下は却下直後に一時停止していた時の記録: **TikTok 自動投稿を停止**: `promotion_channel_settings.tiktok.auto_enabled=false`＋予約 tiktok 投稿を全 canceled(現在 scheduled=0)。DBレベルの停止で即時有効(デプロイ不要、dispatcherが auto_enabled を見る)。将来 TikTok をやるなら API 方式でなく別手段(手動/動画DL共有等)を検討。posts.generate に「auto_enabled=false のチャンネルは投稿を生成しない」フィルタを追加済み(promotion-posts-generate.ts)だが**未デプロイ**(下記 Railway link 事故のため)。未デプロイ間は新規公開/再生成で tiktok 下書きが再作成されうる→定期 sweep か再デプロイで対応。

**Railway デプロイ = プロジェクトトークン方式で恒久解決 (2026-08-06)**: A2P 本番は project **c4001a55-2b65-4500-a020-3f9ed6044999**(services **A2P** web=90eb3b41 / **A2P-Worker**=2e80c6d5 / Postgres, workspace=**kaito-myt's Projects**)。**CLIログイン(`k.miyata@festal-inc.com`)からは festal-km ワークスペースしか見えず c4001a55 に触れない**(login/link 方式は不可)。→ **A2P所有アカウントのダッシュボードでプロジェクトトークンを発行し `.env.local` の `RAILWAY_TOKEN=` に格納**。以後のデプロイは `export RAILWAY_TOKEN="$(grep ^RAILWAY_TOKEN= .env.local|cut -d= -f2-)" && railway up --service A2P-Worker --detach`(login/link不要・非対話・A2P本番のみにスコープ)。env設定も同トークンで `railway variables --service A2P-Worker --set K=V`。この方式で 2026-08-06 に worker/web を再デプロイ済み。

**2026-08-04 出荷 (SNS品質刷新+キュー全リセット再生成):**
- **note アイキャッチ**: 合成(ensureBookPromoImage)→**gpt-image-2一発(書名+見出し入り横長3:2)**。`buildBookEyecatchImage2Prompt`+`generateBookEyecatchImage2`(promo-image.ts)、publishの`defaultBuildMediaUrls`が channel==='note'&&book のみ使用(IG/TikTokは実表紙合成のまま)。
- **note記事=キュレーター声**: noteは書評アカ「良い本を読む習慣」。promoter note_article を著者一人称(「宮田海斗です出版しました」)→第三者書店員が本を紹介する体裁に指示変更(promoter/index.ts)。著者は「宮田海斗さんの新刊」の三人称のみ。
- **promoter構造化出力の頑健化(重要)**: opusが nested配列/オブジェクト(promo_copy/x_posts/*_actions)を**JSON文字列化して返す**事故で zod検証失敗→プラン空/投稿0件になっていた。`PromotionPlanOutputSchema`の各nestedを`jsonish()`(検証前にparse復元)で包み解消(promoter.ts)。**この事故は org_tasksの「No object generated: response did not match schema」大量失敗の一因でもある**(同型の対策を他agent schemaにも横展開検討)。
- **5チャンネル全キューをリセット→再生成**: 未投稿190件をcanceled→公開30冊に`pipeline.book.promotion.generate`(promoter再生成→posts.generate連鎖)＋x/ig `promotion.content.generate`(value×12)。リセット+再生成は scratchpad `reset_regen.mjs` パターン(graphile_worker.add_job直叩き, promoterはjobs行+job_id要)。TikTokはContent Posting API直(F-063)で投稿自体は動く。

2026-07-22 セッションで出荷済み & 次に作る機能。

**出荷済み(本番反映)**
- 投稿失敗の人間可読化: `apps/web/lib/promotion-error.ts` `explainPromotionError()` が
  `promotion_posts.error` の生文字列(`auth: X API responded 403: {...not permitted...}` 等)を
  日本語見出し＋対処手順に翻訳。channel-board の `PostErrorNote` で表示、生ログは `<details>` 保持。
- 「今すぐ投稿」後に 3/7/12 秒で `router.refresh()` し最終状態反映。`posting` 滞留も
  publishPostNowCore/cancelPostCore の対象集合に含め手動再実行/取消可能に。
- 画像生成を `gpt-image-2` 既定に切替。`packages/agents/src/tools/image-gen.ts` の
  `IMAGE_MODEL`(env `OPENAI_IMAGE_MODEL` 可変)に一元化。model_catalog に gpt-image-2 単価行
  seed 済(apply-openai-catalog.ts, 0.04USD 推定=要実測更新)。
- ジャンル 3→29 種: `packages/contracts/src/genres.ts` が単一の真実源
  (GENRE_CATALOG/GENRE_SLUGS/GENRE_LABELS/GENRE_GROUPS/genreLabel/GenreSlugSchema/GenreValueSchema)。
  `Genre` 型を string に緩和。DB genre は自由 String 列でマイグレ不要。agent プロンプトには
  slug でなく日本語ラベル(genreLabel)を注入。

**X 403 解決済み(2026-07-22)**: 原因はアクセストークンが読み取り専用のまま(アプリ権限を
Read+Write にしてもトークンは発行時点の権限で固定)。トークン再生成で書き込み権限が乗った。
投稿先は @goodbooks_intro (良い本と出合う習慣)。検証済みトークンを本番DBへ反映(read 200 +
write 201 を post-then-delete で確認)、handle も @goodbooks_intro に修正。以後 worker 自動投稿も可。
副次バグ修正: 接続フォームで Webhook 欄にブラウザがメアドを自動補完→URL検証で保存全体が
失敗していた(autoComplete=off + type=url + エラー可視化で修正)。
X直接操作の手順: `Xキー情報`(gitignore済/ラベル付き4行)から値抽出 → encryptApiKey(API_CRED_KEY
は A2P-Worker env) → promotion_channel_settings.token_enc 更新。buildXAuthHeader で read/write テスト。

**IG販促画像を刷新済み(2026-07-22)**: 旧実装は文字なし雰囲気写真(gpt-image-1時代の
NO_TEXT制約の名残)で売れなかった。売れるKindle販促の原則(表紙が主役/3秒で伝わるベネフィット/
KU無料バッジ/CTA/白背景回避)に基づき「デザイン販促クリエイティブ」に刷新。
- `packages/output/image/src/compose-promo.ts` composePromoCreative(): 1080²、実フォント
  (Noto Sans JP グリフパス)合成で文字化けゼロ。ジャンル別背景(gpt-image-2文字なし)＋採用表紙
  (影付き)＋新刊/KU無料バッジ＋ベネフィット見出し＋CTAボタン(▶は三角ポリゴン描画)。promoAccent()。
- `apps/worker/.../promo-image.ts` ensureBookPromoImage 刷新。見出しは band_copy冒頭フック→
  target_reader→hook→書名 の優先。実データで目視検証済(「なぜ新潟だけ勝てないのか？」)。
- 既存本は promo_image_key キャッシュ済 → 新デザイン適用には promo_image_key を null 化して
  再生成させる必要(次回投稿時 lazy 再生成、~$0.04/本)。
- IG/TikTok の連携は Make.com Webhook(Ayrshare ではない)。UI文言も修正済。
- 価値(value)投稿の画像は本の宣伝でないため従来のライフスタイル画像のまま(意図的)。

**SNS日次見直し 実装・本番稼働済み(2026-07-22, F-061)**
- 新ロール content_optimizer: `packages/contracts/src/agents/content-optimizer.ts` /
  `packages/agents/src/content-optimizer/index.ts`(generateText+extractLlmJson)。
  prompt+model_assignment(sonnet) seed済(apply-content-optimizer.ts)。実signalsは差込口のみ(v1未接続)。
- worker `promotion.review.daily`: 戦略のある各chの直近3日scheduledを推敲。非破壊、
  promo投稿のURL(購入導線)が消える改善は破棄。changedのみ更新。runner登録済。
- cron: AppSettings.promo_daily_review_enabled(=true済)/promo_review_cron(既定 JST08:00=UTC23:00)
  で条件付き。ADD COLUMN IF NOT EXISTS 適用済、worker再起動でcron有効化。
- 手動一発実行: graphile quickAddJob(DBURL,'promotion.review.daily',{}) で検証可。

**コスト分析(週次・承認実行) 実装済み(2026-07-22, F-062)**
- 新ロール cost_optimizer: `packages/contracts/src/agents/cost-optimizer.ts` /
  `packages/agents/src/cost-optimizer/index.ts`。prompt+model(sonnet) seed済(apply-cost-optimizer.ts)。
- DBテーブル `cost_improvement_proposals`(status: proposed|applied|dismissed|failed)。AppSettings に
  cost_auto_analyze_enabled/cost_analyze_cron 追加。ADD COLUMN/CREATE TABLE IF NOT EXISTS 適用済。
- worker `cost.optimize.weekly`: 直近30日を役割×モデルで集計→agent→提案をDB保存。旧proposedはsupersede。
  cron は cost_auto_analyze_enabled で条件付き(既定 火05:00 JST)。runner登録済。
- 実行(executor) `apps/web/lib/cost-proposal-core.ts`: 承認で**安全・可逆のみ**実行:
  switch_model_assignment(旧archive→新active) / set_app_setting(許可リスト: promo_dispatch_cron/
  promo_review_cron/promo_daily_review_enabled/cost_analyze_cron のみ) / advisory(実行せず了承)。
  危険キー(予算/上限)は許可リスト外で実行不可。server actions: approve/dismissCostProposal。
- UI: コスト詳細ダッシュボード(/cost)に「コスト改善提案」パネル(承認/却下ボタン、推定削減額/影響表示)。
- 手動一発実行: graphile quickAddJob(DBURL,'cost.optimize.weekly',{})。

**TikTok投稿 動画オンデマンド化 実装済み(2026-07-22, F-063)**
- `apps/worker/src/tasks/promotion-post/tiktok-video.ts` ensureTikTokVideoForPost(): 予定TikTok投稿に
  動画が無ければ publish 時に台本→画像+テロップ+TTS+ffmpeg で1本レンダ→R2→media_key付与。失敗時null。
- promotion-post-publish の buildMediaUrls: tiktok かつ media_key 無し→動画生成→無ければ販促画像。
- 動画メディア方針=生成動画(ユーザー承認)。既にmedia_keyありなら再利用。
- **TikTok接続完了(2026-07-23)**: Make公式TikTokモジュールは広告用のみ(オーガニック投稿不可、
  第三者Zernioは有料)→ **ワーカーからTikTok Content Posting APIを直叩き**方式で実装。
  `tiktok-publisher-port.ts` createTikTokPublisherPort(): refresh(refresh_tokenローテを再暗号化保存)→
  動画バイト取得→/inbox/video/init(FILE_UPLOAD)→upload_urlへPUT→TikTok**下書き(インボックス)**へ。
  resolvePortでtiktokはこのポート(webhook/Ayrshare不使用)。
  資格情報: Developerアプリ「A2E Poster」Sandbox、client_key=sbaww5q5sfo9gnjstw、target=@goodbooks_intro。
  OAuth(authorization_code)でtoken交換→{clientKey,clientSecret,refreshToken,openId}暗号化で tiktok
  token_enc に保存済。`TikTokキー情報`(gitignore)。
  **制約**: Sandbox/未審査は下書き(SELF_ONLY)。一般公開はTikTok App review＋scope video.publish が必要。
  OAuth手順メモ: Login KitのRedirect URI登録には Basic info の Platforms=Web(Web/Desktop URL)＋必須欄が
  埋まっている必要。authorize は www.tiktok.com/v2/auth/authorize、token は open.tiktokapis.com/v2/oauth/token。

**TikTok投稿 本番検証成功(2026-07-23)**: post cmrnfkt6q0015p70v3iy5elxr が status=posted。
動画がTikTok下書き(インボックス, SELF_ONLY)へ到達。公開はアプリ側で手動 or 審査後。
接続フォームの自動補完事故(webhook/tokenに kaito.myt@gmail.com/Miyata11 が入り保存で正規トークン
上書き)を根絶: `channel-board.tsx` の資格情報欄を read-only-until-focus 化(noAutofill()ヘルパ、
autoComplete=new-password + data-lpignore/1p-ignore)＋保存はユーザーがフォーカスした欄のみ送信
(未フォーカス欄は既存値維持)。server側は元々 provided時のみ更新で安全。commit 6c6947c 済。

**接続テスト/接続UIをTikTok直叩きに整合(2026-07-23)**: probe(`promotion-channel-probe.ts`)の
旧Ayrshare経路を撤去。TikTok=保存済みOAuth資格情報(kind:tiktok の clientKey/secret/refreshToken)を
**非破壊で形式検証**(refreshはローテーションでtoken消費するため叩かない, method:'tiktok')。IG=Make
Webhook経路に統一(未設定は要設定案内)。接続カード(`channel-board.tsx`)はTikTok専用表示: 汎用の
Webhook/アクセストークン欄を出さず「OAuthでClient Key/Secret/Refresh Token保存済み・access_tokenは
投稿時自動更新」＋認証情報マスク表示。**TikTokに手入力する項目は無い**(OAuth認可コード交換で保存済)。
ayrshareManagedフラグ廃止。commit 757d405。

**TikTokアプリ内OAuth接続 実装(2026-07-23)**: Postman手動交換を廃し、UIから接続完結。
`/api/promotion/tiktok/{start,callback}`＋`lib/tiktok-oauth-core.ts`(exchange/save/parse, 単体テスト付)。
接続カード: ①Client Key/Secret保存(saveTikTokAppCredentials, read-only-until-focus) →②Callback URL
(`{公開origin}/api/promotion/tiktok/callback`)をコピーしDeveloper portalに登録 →③「TikTokと接続」で
authorization_code自動交換→暗号化保存。state Cookie でCSRF、redirect_uriはgetRequestOriginで公開
オリジン導出しUI表示と一致。connected判定はrefreshToken有無(未設定/認可待ち/接続済み)。env:
TIKTOK_SCOPES(既定user.info.basic,video.upload), NEXT_PUBLIC_APP_URL/NEXTAUTH_URL(正規callback固定・任意)。
**運営者の手作業**: Callback URL を TikTok Developer portal(Login Kit)に登録(既存のoauth.pstmn.ioに追加)。
commit 271632a。

**TikTok動画多エージェント＋レンダは完了確認済(2026-07-23)**: 台本=`packages/agents/src/tiktok-video/`
の5体直列(scenario→creator→editor→proofreader→marketer, createTikTokVideoScript, prompt seed=apply-tiktok-video.ts)。
レンダ=`video-render.ts` renderSlideVideo(AI背景→Noto Sans JPテロップ→OpenAI TTS→ffmpeg 1080x1920→concat)。
結線=promotion.video.generate(バッチ)＋ensureTikTokVideoForPost(オンデマンド)両方。品質の伸びしろ(未実装):
BGM/ズーム(Ken Burns)/トランジション/字幕演出。

**上流ドキュメント反映(2026-07-23)**: `docs/07-agent-catalog.md` 新設=制作/販促/経営の全ランタイム
エージェント横断インデックス(役割/モデル/定義/トリガー/詳細参照, 真実源=prompts/model_assignments DB)。
docs/05 に F-058更新/content_optimizer・cost_optimizer/ジャンル29種/gpt-image-2/probe手段別/自動補完ガード/
F-061..063＋新DB・env を反映済。docs/02・04 は反映エージェント実行中。commit 271632a/(docs)。

**TikTok公開投稿(Direct Post)実装済・審査待ち(2026-07-23)**: `tiktok-publisher-port.ts` に Direct Post 経路。
`directPost`(既定 env `TIKTOK_DIRECT_POST==='1'`)有効時、`/creator_info/query/` で許可公開範囲を確認し
`PUBLIC_TO_EVERYONE` 可(=審査通過済)なら `/publish/video/init/`＋post_info{title,privacy_level:PUBLIC_TO_EVERYONE}
で**公開投稿**、未審査(SELF_ONLYのみ)は**下書き(inbox)へ自動フォールバック**。単体テスト付。commit e7d76ae, worker deploy済。
**公開有効化の3条件(すべて必要, 前2つは運営者作業)**: ①TikTok App review 通過(デモ動画＋プライバシーポリシー
＋利用規約URL＋スコープ申請) ②`TIKTOK_SCOPES` に `video.publish` 追加→UIから再接続(再OAuth) ③A2P-Worker env
`TIKTOK_DIRECT_POST=1`。審査前は仕様上どうやっても公開不可(自分のみ)。TikTok inbox方式の確認: status/fetch API で
`SEND_TO_USER_INBOX`=受信箱配信成功。アプリでは「プロフィール下書き」でなく**受信トレイの通知**から編集・公開。

**TikTok審査対応の下地を実装(2026-07-23, commit bbabaa6)**:
- **法務ページ**(審査のURL提出用): `/legal/privacy`・`/legal/terms` 公開ページ(auth.config allowlistに/legal/*追加、
  未認証閲覧可)。事業者名/連絡先/連携サービスは `apps/web/app/legal/config.ts`(operator=Festal, contact=
  info@festal-inc.com)。TikTokデータ扱いも明記。ビルドで静的HTML生成確認。
- **TikTok公開範囲選択UI**(Direct Postコンプライアンス): `saveTikTokPostSettings` SA＋「TikTok投稿設定」カード
  (公開範囲select + コメント/デュエット/ステッチ許可)。config_json.tiktokに保存。パブリッシャは Direct Post時に
  creator_infoの許可範囲と照合し選択範囲で投稿(未許可は下書きフォールバック)、disable_comment/duet/stitch反映。
- 審査提出時のデモ動画・スコープ理由記入は運営者作業。承認後: 本番client_key/secret確認→UI再接続(video.publish込)
  →TIKTOK_SCOPESにvideo.publish追加→TIKTOK_DIRECT_POST=1。

**未着手（残り）**: IGカルーセル複数枚、Xの実インプレッションを日次見直しのsignalsへ接続。
2b. コスト分析(旧メモ): **承認したら実行=安全な可逆設定のみ**(モデル割当をより安価に/投稿頻度調整/
   任意の高コスト生成パスON-OFF)。コスト分析サブエージェントが週1回、改善案＋影響を一覧化し
   コスト詳細ダッシュボードに表示、ユーザー承認で実行。→ 新DBテーブル(cost_improvement提案)、
   週次cron、承認/実行アクション、ダッシュボードUI。
3. IG カルーセル(複数枚)対応: 表紙＋要点スライド等を複数枚生成しカルーセル投稿。Make 受け口も
   複数画像対応にする(現状は mediaUrls[1] の1枚)。滞在時間・保存・リーチ向上狙い。

**2026-08-04 SNS強化3件**: (1) **X育成強化**: `content_creator` プロンプトを DB で v2 化(価値提供中心・フック最優先・具体×数字で保存性・1投稿1メッセージ・一貫ペルソナ・自然な関与導線・チャンネル最適化を強制、宣伝臭/煽り禁止)。v1→archived, v2→active。x/note の value 投稿を v2 で再生成。プロンプトは DB(prompts表 role=content_creator)が真実。 (2) **IG は Make.com Webhook 継続(Ayrshare は Premium≒$149/月で高いため不採用)**。停止原因は Make 無料枠(1,000オペ/月)枯渇。→ ユーザが **Make Core(≒$9/月, 10,000オペ)** に課金。A2P 側は Webhook が2xxでも "Accepted" のみ=実成否不明の盲点に対処: `http-publisher-port.interpretWebhookBody` で JSON `{ok:false}`/`{error}`/`{status:error}` を failed、`{url}` を external_url 採用(Make シナリオ末尾に Webhook Response で `{url}` を返す運用推奨)。`promotion.post.publish` は実投稿失敗時に LINE 通知。IG設定は promotion_channel_settings.config_json.webhook_url(`hook.eu1.make.com/...`)、handle=@goodbooks_intro。**IG停止の真因判明・復旧(2026-08-04)**: Makeシナリオ「Integration Webhooks」(Webhook→Instagram for Business "Create a photo post")が**2026-07-27にエラーで自動停止(deactivated)**。エラー=「Body is not a valid JSON. Unexpected token '<', <!DOCTYPE」(=画像取得で期限切れ署名URLのHTML/XMLエラーをパース)。停止中もWebhookは200 Acceptedを返しキューに滞留(52件)→A2Pは"posted"と誤記録。**復旧手順**: (1)Webhookキュー52件を全削除(Show queue→Delete, 再送不要=既にposted扱い) (2)右上トグルでActive化 (3)A2P側で販促メディア署名URLを**1h→7日(MEDIA_URL_TTL_SEC=604800, promotion-post-publish.ts)**に延長し再発防止。実IG投稿1件をforce実行→posted→IG表示を確認して復旧完了。今後の停止は(A)応答解釈+(B)失敗LINEアラートで早期検知。**IG育成画像をimage-2一発生成に変更(2026-08-04)**: 従来の合成/文字なしムード写真をやめ、**gpt-image-2で「文字入りバリューカード」を一発生成**(`buildValueCardImage2Prompt`+`valueCardTextFromBody`, promo-image.ts, quality=high 1024²)。本文から気づき見出しを抽出→日本語を正確に描いた保存されるデザインを直接出力(実生成テストで品質確認済=日本語崩れゼロ)。gpt-image-2(IMAGE_MODEL既定)は日本語タイポ正確なので合成不要=composeValueCallは作らず撤去。**note接続UIをメール+パスワードに修正(2026-08-04)**: note専用欄(メール/パスワード)をchannel-boardに追加、`setChannelConnectionCore`が メール→config_json.note_email / パスワード→token_enc に保存。note publisherは UI保存値(config.note_email/config.token)優先→env(NOTE_EMAIL/NOTE_PASSWORD)フォールバック。Webhook/汎用トークン欄はnoteでは非表示(!isNote)。**note reCAPTCHA→セッション再利用で解決(2026-08-04, 実地検証成功)**: worker(RailwayデータセンターIP)からのnoteログインは**ログイン画面でreCAPTCHA要求→ブロック**(住宅IPでは出ない。失敗ログに「reCAPTCHAの認証を行いログインボタンを押してください」)。パスワード/DB反映は無関係。対策=**セッション再利用**: note publisherが`promotion_channel_settings.config_json.note_session_enc`(住宅IPで取得したstorageStateを`API_CRED_KEY`(hex64, AES-256-GCM base64(iv12|tag16|ct))で暗号化)を復号→storageStateで起動→エディタ直行でログイン回避。セッション取得は**このローカル環境(住宅IP)でrailway run**: playwright login→`ctx.storageState()`→暗号化→`update promotion_channel_settings set config_json = config_json || jsonb_build_object('note_session_enc',...)`。実投稿1件がworkerでposted成功。**セッション失効時は住宅IPで再取得が必要**(失効すると再びreCAPTCHAでauth失敗→LINEアラート)。**セッション再取得ツール(永続)=`scripts/note-session-refresh.mjs`**: 住宅IPのローカルで `railway run --service A2P-Worker node scripts/note-session-refresh.mjs` を実行(env NOTE_EMAIL/NOTE_PASSWORD/API_CRED_KEY/DATABASE_URL注入)→login→storageState暗号化→DB保存。note投稿がauth失敗し始めたら再実行。KDPと同じ住宅IP取得→worker再利用方式[[project_kdp_publish_assist]]。 (3) **note 自動投稿を新規実装(ブラウザ自動化)**: `note-publisher-port.ts`(Playwright, env `NOTE_EMAIL`/`NOTE_PASSWORD` を Railway A2P-Worker に格納)。フロー実地検証済: note.com/login→note.com/notes/new→editor(タイトル=textarea[placeholder=記事タイトル]/本文=div[contenteditable=true])→「公開に進む」→「投稿する」。captchaブロック無し(reCAPTCHA v3不可視)。実記事1本を公開して疎通確認済。`defaultResolvePort` は note に creds あれば `createNotePublisherPort()`。docs/05 §F-058 に反映。

[[project_prod_deploy]] にデプロイ手順、[[feedback_autonomous]] に自律方針。
