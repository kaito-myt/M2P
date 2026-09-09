---
name: reference-kdp-creation-limit
description: KDP「本の作成数制限」=1日5冊の作成上限(下書きresumeは非消費)。2026-07-27解除→検証で再消費
metadata: 
  node_type: memory
  type: reference
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-09-02T06:08:34.306Z
---

**KDP新規タイトル作成の本当の壁は「本の作成数制限」(アカウント提出上限)。** 2026-07-25、電子書籍作成ウィザードStep1(詳細)を実データで全項目自動入力成功(タイトル/フリガナ/ローマ字/サブタイトル/著者/内容紹介(CKEditor)/権利ラジオ/成人向けラジオ/キーワード7/カテゴリー2)し「保存して続行」を押すと、Amazonが `本の作成数制限を超えました / このアカウントで提出可能な本の数を超えています` モーダル(ボタンは「続行」のみ)を返し、`title-setup/kindle/new/details` から**先へ進めない**。「続行」を押しても前進せず=**ハードブロック**。

重要: **本棚14冊のアーカイブでは解除されなかった** → 棚上の公開数ではなく「提出/作成した本の数」に対する制限(ローリングのレート制限 or アカウントスタンディング依存)。本棚在庫: アクティブ~11・下書き2・レビュー中1・アーカイブ15。削除可能なのは下書き2冊のみ(公開済みは削除不可・アーカイブのみ [[reference-kdp-bookshelf-automation]])で、数合わせでは解除見込み薄い。

帰結: **自動化は完成・実証済み(Step1)。ブロックはAmazon側のアカウント制限であり自動化では突破不可。** 解除の現実解 = ①KDPサポートに上限引き上げを問い合わせ(お問い合わせ, 人間作業/数日) ②ローリング枠のリセットを待ち許可レートで出版 ③下書き削減(効果薄)。**ツール完成: `C:/DEV/A2P/scripts/kdp-publish.mjs`**(運営者アシスト型・ローカルheadful)。3ステップ全実装（Step1詳細=実証済 / Step2コンテンツ=原稿docx+表紙jpg を `#data-assets-interior-file-upload-AjaxInput`・`#data-assets-cover-file-upload-AjaxInput` に setInputFiles、読方向左から右、DRM既定、AI質問票3セレクト正直回答 / Step3価格=全世界・70%既定・KDPセレクト`#data-is-select`維持・JP価格入力→`#save-and-publish-announce`）。ログイン再利用・作成数制限モーダル検出でskip/中断・出版後ASINを本棚から取得しprod DBへ `publish_status='submitted'`+asin書戻し。Step2/3のセレクタは既存公開本の編集ページ(`title-setup/kindle/<id>/content|pricing`)から実採取。**2026-07-25に--limit=1で実走→step1完了→creation_limitで正しくblocked（=制限以外は完動）**。制限解除後 `node scripts/kdp-publish.mjs`（まず`--dry-run`で出版直前まで検証推奨）で未出品done本を順次出版。env: DBURL(prod)/R2_*。認証壁 [[reference-kdp-publish-authwall]]。

**更新 2026-08-28 (サーバー自動出版で実証＋グローバル・バックオフ実装)**: [[reference-kdp-publish-authwall]] の head-of-line 修正後、dispatcher が準備完了本を正しく選び `kdp.submit` が **TOTPで再認証壁を突破→Playwrightで入稿ウィザードに約7分入り→最後に `reason="creation_limit"` で停止**（＝サーバー直接出版は認証含め機能、Amazonの1日5冊上限だけが壁と実証）。**問題**: 上限到達後も30分毎に別の本でCREATEを試み、7分×浪費＋枠消費（memoryの「検証CREATE反復で再消費」がサーバーでも再現）。**対策実装**: `app_settings.kdp_creation_paused_until`(新カラム)を追加。`kdp.submit` が `creation_limit` を検知したら**翌JST0時(=15:00 UTC)まで全体停止**をセット(`nextJstMidnightUtc`)＋従来の per-book 20h クールダウンも維持。`kdp.submit.dispatcher` は paused_until > now なら **dispatch を全 skip**。→ 上限到達日は無駄撃ちゼロ、翌0時に自動再開して最大5冊/日で自動出版。JPアカウント想定でJST0時境界(Amazonのリセット時刻が違っても、再開後1回試して再度上限なら再pauseで自己補正)。`apps/worker/src/tasks/kdp-submit.ts` + `kdp-submit-dispatcher.ts`。

**更新 2026-09-02 — LIVE上書き再提出も翌日の作成枠を塞ぐ**: 前日にLIVE出品8件を `--overwrite-map` で再提出(新規CREATEゼロ・サーバー出版ゼロ)した翌日、新規タイトル作成がSTEP1で `creation_limit` ブロック。「下書きresume/編集は非消費」は**新規CREATE画面の話に限る**とみるべきで、**大量の再提出や審査中タイトルの滞留(5冊審査中)はアカウント単位スロットリングとして新規作成をブロックしうる**。対処=`kdp_creation_paused_until` 経過後に再試行(ブロックはSTEP1検知で副作用なし)。大量差し替えと新規出版を同日に予定しない。
**リセットは JST 深夜0時**(15:00 UTC、既存記述どおり)で、**15:00 JST 説は誤り**(9/2 15:05 JST に再試行して再ブロックを実測)。再提出のカウントは**完了した JST 日**に付く(UTC 前日夜の実行でも JST では当日扱い)。

**更新 2026-07-27**: 制限は**「1日5冊」の作成上限**と判明（作成=CREATE。**下書きのresume/編集は消費しない**）。この日いったん解除されたが、ウィザードのStep2/3を実DOMで反復デバッグする過程で新規CREATEを重ね**当日枠を再消費**（book2下書きが9重複）。→対策: **`--assist`モードで既存下書きをresume上書き**（新規作成せず=枠非消費）。Step2/3の全罠は解決済み(詳細は [[project-kdp-publish-assist]])。AI質問票は前段「AI使用?はい/いいえ」ゲート有り(react-aui)で、運営者指示により「いいえ」選択。
