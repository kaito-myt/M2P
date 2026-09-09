---
name: project-channel-tabs
description: 出版チャネルタブ群 — /bookwalker(F-094稼働)・/kobo(F-095 UI先行)・/booth(F-096 UI先行)。Kobo/Boothはログインセッション保存待ち
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-03T17:14:05.102Z
---

出版パイプラインのチャネル別入稿タブ (2026-09-04実装)。ナビ「パイプライン」配下: KDP入稿 / BOOK☆WALKER入稿 / 楽天Kobo入稿 / Booth入稿。

- **BW (F-094)**: 完全稼働。[[project-bookwalker]] 参照。
- **Kobo (F-095)**: UI先行(`/kobo`, books.kobo_*列, キュー登録のみ)。KWL=rakutenkwl.kobo.com はKobo OAuth(authorize.kobo.com)経由・未ログイン403・reCAPTCHA前提 → **初回手動ログイン→セッション保存待ち**(プロファイル scripts/.kobo-userdata, 偵察=scripts/kobo/kobo-recon.mjs)。ユーザーのKWL書籍編集URL例: /v2/ebooks/ebook/88c42d62-...。エンジンはBWパターン(EPUB3流用)でworkerタスク化予定。
- **Booth (F-096)**: UI先行(`/booth`, books.booth_*列)。manage.booth.pm=pixivログイン。ダウンロード商品(PDF/EPUB)登録形式。偵察未着手。
- 共通: SA=app/actions/channel-submit.ts(汎用queue/unqueue), app_settings.{kobo,booth}_{auto_submit_enabled,submit_dry_run,session_state_enc} 列は先行作成済み。
- **ユーザー方針**: ログイン作業は本人がやる(依頼すればOK)。セッション保存して使い回す。

設計記録: docs/02 F-094〜096, docs/05 §5.3.15c。
