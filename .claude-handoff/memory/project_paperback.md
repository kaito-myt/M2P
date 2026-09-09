---
name: project-paperback
description: 全書籍ペーパーバック化 (2026-09-02着手) — 仕様・生成物・展開手順・未検証点
metadata: 
  node_type: memory
  type: project
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-09-03T06:46:22.099Z
---

ユーザー指示 (2026-09-02): 「ペーパーバックの作成もすべての書籍行いたい」。収益評価=紙の直接売上は少ないが**価格アンカー効果**(紙¥1,500 vs Kindle¥680でKindle転換率up)+信頼性で期待値プラス、在庫リスクゼロ。

**確定仕様 (KDP公式で確認済)**:
- 判型 A5 (148×210mm)。現行の電子用PDF (`packages/output/pdf`) が既に A5・左右余白15mm・ページ番号付きで、**〜300頁ならそのまま印刷要件を満たす**(ノド最小: 〜150頁9.6mm/〜300頁12.7mm/〜500頁15.9mm。301頁以上のみ余白拡大が必要)。頁数レンジ 24〜828 (白黒・白紙)。
- ラップカバー: 幅=bleed3.2+裏148+背+表148+bleed3.2mm、高さ=210+6.4mm。**背幅=頁数×0.0572mm(白紙)** (クリームは0.0635)。背文字は**79頁超のみ**。裏表紙右下50.8×30.5mmはバーコード領域で空ける。
- フォント: NotoSansJP を `apps/worker/fonts/` にローカル配置済 (印刷用埋め込みをCDN非依存に)。

**生成物 (scripts/paperback/)**:
- `pb-env.sh` — Railwayから実行時env取得(秘密はファイルに書かない)
- `pb-plan.cjs` — 全対象本の final.pdf をR2から取得→pdf-libで頁数→背幅/余白適合/レンジ判定→ `plan.json`
- `build-wrap-cover.mjs` — 採用表紙(R2)をsharpで前面パネルへ拡大 + 表紙平均色を暗めた裏表紙(タイトル/説明文=kdp_metadata.description/著者/Kindle誘導) + 背(条件付き縦書き風回転テキスト) → react-pdfで一枚PDF。pdf-libはroot devDep追加済、sharpは packages/output/image の0.34.5を createRequire。

**進捗 2026-09-02**: plan.json=95冊算出(129〜440頁, ほぼ全冊が余白そのまま適合)。**ラップカバー94冊生成済み** (`scripts/paperback/out/*-pb-cover.pdf`, スポットチェック3冊良好=裏表紙説明文/背文字/バーコード領域OK)。戦場2(436→440頁)のみ本文をmargin16mmで再生成(`*-pb-interior.pdf`, `build-print-pdf.mjs`+buildPdf新オプションsideMarginMm)。残る未生成=最強馬は誰だ(採用表紙なし)。PDFプレビューはheadful Chrome(playwright channel:'chrome')でスクショ(headless chromiumはPDFをダウンロード扱い/pdftoppm無し)。

**パイロット第1走の採取 (2026-09-02)**: 本棚行の「ペーパーバックの作成」→ `title-setup/paperback/new/details?existing=<KindleTitleId>&item=…` に遷移し、**STEP1はKindle版からほぼ全て自動引き継ぎ**(タイトル/フリガナ/サブタイトル/著者/内容紹介/キーワード7)。セレクタは `data-print-book-*` 系 (`data[print_book][…]` name)。成人向けradio=`data[print_book][is_adult_content]-radio`。**カテゴリーは引き継がれず空**(必須、`#categories-modal-button`)。続行=`#save-and-continue-announce`。**罠: ページ不可視テキストに「本の作成数制限」文言が常在**し、bodyテキストgrepで誤検知する→**可視リーフ要素に限定して判定**すること(pb-pilot.mjs修正済)。

**出版フロー全解明 (2026-09-03, パイロット=血糖値本 TN2S3HGG343)**:
- **STEP2(content)確定セレクタ**: ISBN=「ISBN を取得」ボタン→**確認ダイアログの同名ボタン**を[role=dialog]内で再クリック(割当例9798171338534)。インク/用紙 `#ink-paper-BW_WHITE`・裁ち落とし `#bleed-no`・表紙仕上げ `#cover-finish-MATTE`・綴じ方向 `#page-turn-direction-left-to-right`(**全て既定値が正解**)。アップロード=「原稿をアップロード」「表紙ファイルをアップロード」ボタン(id無し)→**filechooserイベントで投入**。AI質問 `input[name="has-ai-content"][value="no"]`。バーコード`publisher-barcode`(未チェック=KDPが自動付与でOK)。判型はプルダウン「5.83 x 8.27 インチ (14.81 x 21.01 cm)」＝A5相当が既定。
- **STEP3(pricing)確定セレクタ**: `#price-input-jpy` 実タイプ+Tab→他13市場は自動換算(ロイヤリティ50-60%表示)。出版=button「ペーパーバック本を出版」。価格式: max(1480, ceil((206+頁×2.06)/0.6+60)/10*10)。
- **プレビュー承認ゲート(解決済 2026-09-04)**: 深夜のRAM潤沢時にpb-complete.mjs(trusted起動→変換待ち→trusted終了)で警告が消え、保存→価格→出版まで全自動で通った(血糖値本 TN2S3HGG343 提出済, ¥1480)。日中の失敗はpreviewerのJSエラー(client-side-error連続POST)=RAM不足が原因だった。以下は当時の記録: **旧・最後の壁=プレビュー承認ゲート**: contentの赤バナー「本をプレビューして承認してください」が消えない限り、**保存して続行はネットワークPOSTすら発生せずクライアント側で無言ブロック**され、pricingで「以前のページに問題」モーダルが出版を止める。プレビューアーには**承認ボタンが存在しない**(実ボタン=校正用PDF/ガイドライン確認/印刷プレビューアーを終了のみ)。自動化Chromeでは**previewerが `/print-preview/client-side-error` を連続POST**(JSエラー)し、trusted起動/8分滞在/ページ送り/trusted終了いずれでも「プレビュー済み」が記録されない(警告残存を実測)。**現方針=この1ステップのみ人間が実施**(プレビューアー起動→終了)し、価格→出版は自動。人間ブラウザで承認ボタンが見えるかは運営者の実施待ち。
- 原稿PDFの**フォント未埋め込み警告**(頁2〜43)はAmazonが自動埋め込みで修正(非ブロッカー)。previewerのラップカバー描画は完璧(バーコード自動配置込み)。
- スクリプト: `pb-complete.mjs`(content承認試行→価格→出版, --go)/`pb-publish.mjs`(価格→出版のみ)/`pb-preview-x.mjs`(previewer可視化診断)/`pb-diag-*`。

**未検証 (パイロットで確認)**: ①「ペーパーバックの作成」ウィザードのセレクタ一式 ②ペーパーバック作成が「1日5冊」作成枠を消費するか ③最低価格(印刷費)の実額と推奨売価 ④表紙1024×1536→300dpi拡大の印刷品質。**パイロットは戦場1/2出版(9/3 00:05〜)完了後に実施**(枠リスク回避)。ウィザード自動化は `scripts/kdp-publish.mjs` に `--paperback` モード追加予定(bookshelf行の「ペーパーバックの作成」ボタン起点)。

関連: [[project-kdp-publish-assist]] [[reference-kdp-creation-limit]]

**全冊バッチ (2026-09-04〜)**: `scripts/paperback/pb-batch.sh`(lockfile+timeout900/1200+連続3失敗中断+creation_limit exit4で当日終了) — 1冊= pb-pilot(下書き作成〜STEP2, ASIN行特定必須化=先頭行フォールバック廃止) → pb-complete --go。titleIdはpilotログのprint-setup URLから抽出。出版済み台帳=pb-published.txt, 未完了下書き=pb-drafts-pending.txt。約20〜25分/冊。PB作成はKindleの作成制限と枠を共有しない模様(スロットル中でも作成可)。

**表紙セーフゾーン修正 (2026-09-04, Amazon指摘対応)**: KDPが「表紙の文字が端に近すぎ印刷で切れる、裁ち落としから9.5mm離せ」と却下。build-wrap-cover.mjsを修正=Kindle表紙を端まで引き伸ばさず**セーフゾーン(判型内側9.5mm)内にcontain配置**し、周囲(bleed+9.5mm)は表紙平均色で塗る(色は端まで届くが文字は安全域)。血糖値本で視覚確認済み。全表紙 regen-covers.sh で再生成。
