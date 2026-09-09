---
name: reference-kdp-bookshelf-automation
description: KDP本棚をセッション再利用で自動操作する手順とセレクタ(出版取り消し等)
metadata: 
  node_type: memory
  type: reference
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-10T08:00:11.156Z
---

保存済みKDPセッション([[project-kdp-sales]] の `accounts.kdp_session_state_enc` / ローカル `scripts/.kdp-session.json`)で本棚を Playwright 自動操作できる。**破壊的・対外的操作なので必ずユーザーの明示許可＋各ステップのスクショ保存＋ASIN完全一致ガードで実行**。

**本棚URL**: `https://kdp.amazon.co.jp/ja_JP/bookshelf`。検索ボックス(`input[type=search]`)にASINを入れEnterで1冊に絞れる。
**動線(出版取り消し=unpublish)**:
1. ASIN検索→結果1件のみを確認(`button[id$="-other-actions-announce"]` が1個)。live判定=そのidに `live-book-actions` を含む。
2. その「…」ボタンをクリック→ポップオーバー展開。
3. `a[id^="unpublish-"]`(「電子書籍の出版停止」)をクリック。
4. 確認ダイアログ `#confirm-unpublish-announce`(「出版停止」)をクリック。
5. 検証: 再検索してステータスが「下書き/出版停止」・liveボタン消失を確認。
- 他: `a#digital_archive_title-...`(本のアーカイブ), `#archive-title-ok-announce`, `#delete-title-ok-announce`(削除確定)。メニュー項目idは口座id(例 A30HC1XVK9BB4N)ベースで本ごと共通(検索で1冊に絞るのが前提)。
- 「本の作成数制限」等のモーダルが被る場合は閉じる(`続行`/close)。

**重要(KDP仕様)**: 出版済み(ASIN付き)の本は**完全削除できない**。下書きメニューにあるのは「本のアーカイブ」(`a#digital_archive_title-…` → `#archive-title-ok-announce`)のみ。よって「削除」=アーカイブ(本棚から外す・復元可)で実現する。`#delete-title-ok-announce` はDOMにあるが未公開本(ASIN無し)専用。

**実績(2026-07-24)**: 品質低期14冊(7/7+7/14)をunpublishのみ自動実行→14/14成功検証→`status='retracted'`・販促102件canceled・売上KPI除外。

**実績(2026-08-10)**: 自律AIが8/2に再制作した競馬重複本の実本棚取り下げ。調査に `scripts/kdp-scan-detail.mjs "<title>"...`(READ-ONLY, 検索語ごとに全ASIN+live/draft列挙, LINE relay付)を新規追加。起伏×3(B0HDMDSND8/B0HDMCJW97/B0HDMC15WS)+重賞×1(B0HDMKFDLB)=計4 ASINを `scripts/kdp-retract.mjs <ASIN>` で unpublish+archive→4/4成功、再スキャンで起伏/重賞 0件・最強競馬予想術(B0FVL9HDBB)は保持を確認。**セッション(.kdp-userdata, 7/24取得)は17日後も有効でOTP不要だった**(remember-device長寿命)。DB: 該当2冊 retracted 化。再発防止は [[project_org_agents]] の block-on-any 重複制作ガード。

**本番機能化(2026-07-24, commit b1498de)— 低品質本の定期間引き(検出→レビュー承認→自動取り下げ)**:
- 基準=**売上低迷**(公開後 `book_cull_min_age_days`(60)日経過 かつ 累計KENP≤`book_cull_max_kenp`(300) かつ 累計¥≤`book_cull_max_royalty_jpy`(100))。AppSettingsで調整可。`book_cull_enabled=true`有効化済(cron `0 21 * * 1`=月06:00 JST)。
- `book.cull.detect`(週次cron・gated)が候補を `books.cull_status='candidate'` にマーク(指標を `cull_reason` に記録)。
- Web `/books/cull` レビュー画面で承認(`approveCull`→`kdp.book.takedown` job投入)/却下(`rejectCull`)。**破壊的なので人間承認ゲート必須**(確認ダイアログ)。
- `kdp.book.takedown`(worker)がセッション再利用で unpublish+archive→成功で `status='retracted'`, `cull_status='taken_down'`, 販促停止。R2にスクショ証跡。DI(BookshelfPort)でテスト可。
- ファイル: `packages/db/src/book-cull.ts`, `apps/worker/src/tasks/{book-cull-detect.ts,kdp-book-takedown.ts,book-cull/*}`, `apps/web/app/(app)/books/cull/page.tsx`+`app/actions/book-cull.ts`+`components/books/cull-review-client.tsx`。取り下げ済=`retracted`(books-view/messages/books-kpi対応済)。
