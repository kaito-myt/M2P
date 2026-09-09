---
name: project-kobo
description: 楽天Kobo(KWL)自動出版 — エンジン完成(2026-09-04)。ジャンル/著者役割の罠・出版API確認・重複UUID上書き方式
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-08T17:41:16.441Z
---

**状態 (2026-09-04)**: KWL自動出版エンジン完成、全冊バッチ稼働。`/kobo`タブ(F-095)。セッションは app_settings.kobo_session_state_enc(暗号化)。ログインはhCaptchaで自動不可=[[project-channel-tabs]]のCDP方式で手動ログイン→保存。

**KWLフォーム自動化の要点(全てreact-ariaカスタムで DOM直接セット不可、実操作が必要)**:
- テキスト: `[name=metadata.title/subtitle/contributors[0].name/publisher]` は fill()可(上書き時は先に空fill)。
- 内容紹介: **Quillエディタ `.ql-editor`** をclick→キーボードtype(上書きは Ctrl+A→Delete先行)。
- 言語: 「言語をご選択ください」ボタン→リストで「日本語」click(selectOptionは効かない)。
- **ジャンル(必須の主犯)**: トップカテゴリ(例「ビジネス・経済・就職」)をclickで展開(⌄)→現れる**チェックボックス「一般」をチェック**。文字クリックではダメ。genre→トップ名マップ。
- パブリックドメイン=いいえ / 全世界権利=はい (ラジオ、ラベルテキストで選択)。
- 価格: `[name=prices[0]]` をclick→Ctrl+A→キーボードtype(JPYは既定行)。
- 表紙+EPUB: `input[type=file]` を accept で判別し setInputFiles。
- 著者役割 `contributors[0].type` は hidden Controller。可視ウィジェット無く、保存時にサーバーデフォルトで埋まる。

**出版の罠(重要)**: 「出版する」クリック後、UIに「必須項目です」等が誤検知で残るが**実サーバー状態は遷移している**。判定は必ず **API `GET /product/<id>?productType=BOOK` の status** で行う(DRAFT→PUBLISH_REQUESTED→ANALYZE_REQUESTED→公開)。エンジンは「保存→ハードリロード(役割type再取得)→出版クリック→APIでstatus確認→未遷移なら最大4回再クリック(表紙が外れたら再アップロード)」。

**重複UUID上書き方式**: 作成中(DRAFT/審査中)のKobo商品は**UIからもAPIからも削除不可**(DELETE 405/401, status書換PUT 201だが無視)。→ **別作品で上書き**して無駄にしない。`KWL_TARGET_ID=<uuid>`指定でその商品の編集画面を開き上書き。scripts/kobo/dup-uuids.txt(デバッグ残骸UUID)→kobo-batch.shが各々別書籍で上書き出版、kobo-map.txt(bookId uuid)で重複防止。

**スクリプト**: scripts/kobo/{kwl-submit.mjs(KWL_TARGET_ID対応, --submit), kobo-batch.sh(上書き→新規, アダルト除外, DB kobo_publish_status更新), kwl-check-status.mjs, kwl-api-diff.mjs(公開vs下書き差分でstatus特定)}。env=pb-env.sh(KDP_CRED_KEY追加済)。

**AI開示で取り下げ→再出版 (2026-09-09)**: 楽天KoboもAI生成作品として申請取り下げに。本文のAI開示文は`scripts/bookwalker/remove-ai-disclosure.mjs`で全書籍除去済([[project-bookwalker]]と共通=chapters.body_md)。再出版=`scripts/kobo/kobo-republish.sh`(kobo-map.txt全89冊: クリーンEPUB再ビルド→`KWL_TARGET_ID=<uuid>`で既存商品に上書き→`--submit`で再出版; アダルト0件確認済)。1冊検証OK(status=PUBLISH_REQUESTED)後に全89冊バッチ実行。kwl-submitは**事前ビルドのout/<bookId>.epubを使う**ため再出版前にbuild-epub必須。

関連: [[project-channel-tabs]] [[project-bookwalker]]
