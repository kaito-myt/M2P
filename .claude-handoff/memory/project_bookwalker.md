---
name: project-bookwalker
description: BOOK☆WALKER出版 — ローカル40冊申請済→F-094でRailwayサーバー自動入稿化(タブUI+bw.submit)。フォーム仕様・isTrusted罠・セッション運用
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-07T08:07:48.406Z
---

**状態 (2026-09-04)**: ローカルバッチで40冊申請済(審査中, ~¥372印税/冊見込)。**F-094 サーバー自動入稿を実装・デプロイ** — 残り56冊はRailway workerが自動申請(bw.submit.dispatch cron */7、通常時は */30 に戻すこと)。UI=「BOOK☆WALKER入稿」タブ `/bookwalker`。

**フォーム仕様 (実証済)**: /books/new — `#book_main_title(_kana) #authors_0_name(_kana) #book_copyright #book_catchphrase #book_description #book_keywords(≦100字必須!) #book_price_notax(税抜)`; ファイル3点必須 `#book_files_cover(1600px JPG) #book_files_epub #book_files_epub_trial`; カテゴリradio(実用（評論・情報）/文芸・小説/ライトノベル)。申請=`#register-book`→確認モーダルの2段trusted click(`force:true,noWaitAfter`; synthetic/requestSubmit不発火)。成功=POST /api/books/register 2xx+本棚「申請中」。EPUB検証~40s待ち必須。Cookieバナー除去必須。

**サーバー構成 (F-094)**: `app_settings.bw_session_state_enc`(storageState暗号化, KDP_CRED_KEY)+`bw_auto_submit_enabled/cron/dry_run`; `books.bw_publish_status/queued(_at)/submitted_at/cooldown`。worker: `bw.submit`(EPUB3をchaptersからその場生成+sharp表紙1600px+headless申請)+`bw.submit.dispatch`(1冊/tick)。セッション失効→自動OFF+LINE通知→ローカルで手動ログイン後 `bash scripts/bookwalker/bw-session-push.sh` 再push。ローカル申請済分は `scripts/.stage/bw-backfill-applied.cjs` でsubmitted反映(二重申請防止)。

**ローカル資産**: scripts/bookwalker/{build-epub.mjs,bw-cover-jpg.mjs,bw-submit.mjs,bw-batch.sh(lockfile),bw-verify.mjs,bw-session-push.{mjs,sh}}; プロファイル=scripts/.bw-userdata2(初代.bw-userdataはtaskkill中の破損で廃棄→Cookie移植で復旧した教訓)。ログインはreCAPTCHAで自動化不可=手動。

**サーバー入稿の2大ハマり(2026-09-04解決)**: ①`page.evaluate: __name is not defined` — tsx(esbuild keepNames)がevaluate内関数を__name()でラップ→ブラウザに無い。`ctx.addInitScript({content:'globalThis.__name=globalThis.__name||function(f){return f}'})`で回避(KDP c4947a9と同一)。②**EPUBのvoid要素未終了でBW `/api/files/epub/check`が400→申請ボタン永久disabled**。mdToXhtmlが`<br><hr><img>`しか閉じず、markdownタスクリスト`- [ ]`が生成する`<input>`でepubcheck FATAL(RSC-016)。全void要素(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)を`<tag.../>`化で解決。診断= `bw-epub-check.mjs`(check 400本文取得)/`bw-headless-submit-debug.mjs`(register活性・POST列可視化)。確認フロー: upload epub/image 200→epub/check status:OK→register-book(disabled解除)→確認はい/いいえ→POST /api/books/register 200。

**却下と恒久対策 (2026-09-07)**: 初回申請の大半が2点で却下→修正済。①**AI作品は「AI生成」サブカテゴリ必須**(faq/9999)=`input.book_sub_category[value="7497"]`(全メインカテゴリ共通value・常時DOM内)。submit時に常時check(ラベルclick+直接check二段)。※これは入稿フォームのメタデータで[[feedback-no-ai-disclosure]]の本文開示文とは別レイヤ。本文の開示文は`scripts/bookwalker/remove-ai-disclosure.mjs`(文単位除去/KEEPガードで実コンテンツ保護)で55冊117文を恒久除去済(chapters.body_md)。②**内容紹介の途中切れで却下**→`descText.slice(0,800)`を`fitToSentence(text,maxlength)`(実行時maxlength内の最後の文末。！？」』】で切る)に置換。test=`playwright-submit-port.test.ts`(10 pass)。**運用制約**: AI作品は審査1ヶ月+/著者1名 月3作品まで→一括不可・トリクル運用。本棚=`/library/bookshelf`(`/books`は404)、編集=`/books/<bwId>/edit`。**DBはBW book-id未保持**(突合はタイトル)。2026-09-07時点 本棚: 販売中1(「今日のわたしをいたわる100の言葉」発売日9/8=触るな)/申請中8/却下2/取り下げ7。

**申請の日次上限 ~3件/日 (2026-09-07 実測・最重要)**: `POST /api/books/register` は同一アカウントで1日約3件成功で以降403。∴全書籍の一括再申請は不可、~3件/日トリクルが唯一の道(113冊≒38日)。取り下げ=`POST /api/books/drop`(book_id=<id>, CSRF不要)は上限なし。再申請フロー=`bw-retag.mjs <bwId> [--withdraw]`(取下げ→クリーンEPUB再ビルド→編集画面でメインカテゴリ再クリックしAI生成value7497の**可視1個**を実クリック→内容紹介fitToSentence→3ファイル再UP→register)。403でも編集内容は保存済のため翌日registerのみで復帰。本棚列挙=`bw-shelf-enum.mjs`→`shelf-enum.json`(js-bookdrop data-id/js-booksample data-url from id)。

関連: [[project-kdp-publish-assist]] [[project-paperback]] [[project-channel-tabs]] [[feedback-no-ai-disclosure]]
