---
name: reference_deai_ui_rules
description: 管理画面の脱AI-UI設計ルール(2026-08確立); タイポ役割/一覧=ヘアライン/カード限定/モバイルヘッダー
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-28T04:06:38.192Z
---

A2P 管理画面(apps/web `(app)`)を「AI生成SaaSテンプレ」から「人間が業務理解して設計したUI」へ寄せる設計ルール。2026-08にレビュー(AI感 3/10→2/10)＋Phase1-3実装で確立。UIを触るときはこれに準拠。

**タイポ役割**（`packages/ui/src/tokens.ts`, docs/04 §6.3.2）: page-title=`sub-heading`(**28px**/600、旧36pxは肥大でAI感の主因→縮小)／section-title=**18px/600**(新設、20↔36の中間。節を"囲まず"分ける)／card-title 20px／kicker=`caption`14px muted。**節見出しにsub-headingを使わない**(ページH1専用)。

**一覧の作法**: 1件=1〜2行の走査系は**ヘアライン区切りの高密度リスト**(`border-y divide-y divide-border-warm`＋行`px-space-tight py-space-relaxed hover:bg-charcoal-03`)。**「1行=角丸カード反復」は禁止**(密度低下＝AI感の主因、KDP入稿/販促で是正済)。3列以上の比較はテーブル(books-tableの Th/Td 語彙)。

**Border/Shadow 3階層**: ①枠なし＋ヘアライン=一覧・節(既定) ②薄面＋枠=真に束ねる要素・アラート ③実線カード＋影=Modal/浮遊のみ。**一覧行・設定の単項目(チェックボックス等)にborderを使わない**(設定は各チェックを枠囲みしていた→枠除去)。

**Button**: 行ごとの黒塗りCTA反復を避け、二次操作はアウトライン(`border border-border-warm bg-cream-light`)。強い塗り(bg-charcoal/foreground)は1画面の主操作のみ。**radius: button/input/badge=default(6)、card=10、pill=ステータス限定**。

**Color**: cool neutral greys(`#f6f7f9`/`#101828`/`#667085`/`#e6e8ec`)＋単一アクセント vermilion `#b23a1e` を「赤字/超過/期限/要対応」など**意味に限定**(装飾に使わない)。トークン名は cream/warm だが値は cool(移行済)。

**モバイル**: ヘッダーの計器群(CostMeter/Alert/Comment)は `hidden md:flex`(狭幅で折返し崩壊するため)。

**残す(非AI資産・触らない)**: ダッシュS-002の単一ヒーロー指標＋ヘアライン指標行／アイコンレスのテキスト・サイドバー／モデル割当マトリクス／書籍ライブラリのテーブル。落とし穴: `line-clamp-N` に `block` を併記すると display が競合してclampが効かない(booksタイトルで踏んだ)。関連: [[reference_spacing_token_gotcha]], [[project_home_dashboard]]。
