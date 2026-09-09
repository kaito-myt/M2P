---
name: reference-kdp-publish-authwall
description: KDP新規タイトル作成/出版はセッション再利用で自動化不可(max_auth_age=0の再認証強制)
metadata: 
  node_type: memory
  type: reference
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-28T06:12:12.974Z
---

**KDP は新規タイトルの作成/出版に「その場での再認証」を強制する。** 保存済みセッション([[reference-kdp-bookshelf-automation]] / `accounts.kdp_session_state_enc`)で本棚閲覧・レポートDL・出版停止(unpublish)・アーカイブは headless で通るが、`title-setup/kindle/new/details`(新規電子書籍作成)へ遷移すると `https://www.amazon.co.jp/ap/signin?...openid.pape.max_auth_age=0...` にリダイレクトされる。`max_auth_age=0` = 「今この瞬間に認証し直せ」= パスワード+2FA の step-up をアクション時に要求。**Cookie の鮮度ではなくアクション時強制なので、どれだけ新しい保存セッションでも突破できない。**

帰結: **サーバ(Railway)からの完全自動出版は不可能。** 実現可能なのは「運営者アシスト型」— 運営者が headful ブラウザで一度フレッシュにログイン(step-up 通過→そのブラウザセッションが昇格)し、**同一ライブセッションを即座に**自動操作でウィザード入力+ファイルアップロード+出版まで回す方式(= Phase 3 の「2FA push-and-wait」設計の実体)。storageState を後で headless で使い回す方式では作成/出版はできない。ウィザードDOMのリバースエンジニアリング自体も、この認証壁の先にあるため運営者の同席(フレッシュログイン)が前提。

検証日: 2026-07-24。本棚アーカイブ(unpublish+archive)は同日 headless で14冊成功しており、閲覧系と作成系で認証要件が異なることを実地確認済み。

**【2026-08-12 重要な訂正】サーバ完全自動出版は「TOTPシード」で可能になった。** 上の「完全自動不可」は `AMAZON_TOTP_SECRET`(Amazon認証アプリのTOTPシード)未設定を前提とした結論。env に TOTP シードを設定すると、`max_auth_age=0` の step-up 再認証で worker が **6桁コードをサーバ生成して自動入力**し、Railway データセンターIPから**完全無人**で新規タイトル作成→出版まで通る。実機ログで確認: `kdp.submit start ... otp="totp"` → step1(メタ)→step2(原稿/表紙アップロード)→KDP Select登録→step3(価格)→公開 を無人完走し `submitted` へ。TOTP未設定時のみ [[project-line-auth-relay]] の LINE OTP 返信にフォールバック。
**別の主犯(同日修正)**: `org.kdp.screen` が承認時に `books.kdp_publish_queued` を立てておらず(dispatcherが読むフラグ)、両自動設定ONでも入稿対象ゼロで**14日間自動出版が完全停止**していた。screen が eligible+unlisted 本にフラグを立てるよう修正済(docs/02 F-041)。[[project-kdp-publish-assist]]。

**【2026-08-28 第3の主犯 = head-of-line ブロッキング】** 運営者「入稿キューの本が昨日出版されてない」。調査結果、認証壁でもTOTP問題でもなかった: `kdp.submit.dispatcher` は `updated_at 昇順で1冊だけ`拾うが、**先頭の1冊が採用カバー未生成(cover=false)** で `kdp.submit` が「資産不足(cover/docx) — skip」で毎tick skip→その本は queue に残り続け→**同じ資産欠け本を無限に拾い、後続の準備完了24冊が永久に出版されない**(実測: queued 25冊中 ready 24 / no_cover 1、その1冊が先頭で全体を堰き止め)。worker自体は正常稼働(ログでskipを確認)。**修正**: dispatcher の book.findMany に `covers:{some:{status:'adopted'}}` と `artifacts:{some:{kind:'docx'}}` を追加し**資産が揃った本だけ対象化**→ queue が前進(`apps/worker/src/tasks/kdp-submit-dispatcher.ts`)。教訓: 「1冊ずつ・skip は queue に残す」設計は、skip 条件を満たす本が先頭に居ると全体を止める。診断の勘所は worker ログの `資産不足 — skip` と、queued本の cover/docx 充足数。[[reference-model-assignment-routing]]
