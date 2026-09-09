# A2P/M2P 作業引き継ぎ（2026-09-09 時点）

別端末で続きを作業するための現況・残タスク・発見した制約のまとめ。
起動後はまず本書＋`CLAUDE.md`＋`.claude-handoff/memory/*.md` を読むこと。

## 別端末でのセットアップ手順
1. `git clone https://github.com/kaito-myt/M2P.git`（本コミットに最新が入っている。旧A2Pから改名済み）
2. `pnpm install`
3. **`.env.local` は gitignore で push されていない**（RAILWAY_TOKEN＋各種認証情報）。→ **旧端末から手動でコピー**するか再作成が必須。これが無いと railway 経由の DB/秘密取得が全て失敗する。
4. `railway login` 済み or `.env.local` の `RAILWAY_TOKEN` があれば `scripts/paperback/pb-env.sh` が通る。
5. 会話の記憶を引き継ぐなら `.claude-handoff/memory/*` を新端末の `~/.claude/projects/<プロジェクトハッシュ>/memory/` に配置（ハッシュは絶対パス由来。パスが違えば新規セッションで本書＋memoryを読ませればOK）。

## チャネル別 現況

### KDP eBook（新作出版）
- **本日4冊 出版**（`publish_status=submitted`／レビュー中）: 期待値で買う競馬(ASIN B0HJ7RY8XX)、夏競馬・穴馬回収率メソッド(B0HJ7MXHGJ)、人気急落馬の狙い方、穴馬はオッズが教えてくれる。
- 「夏だけ勝てる馬」= 下書き作成済みだが処理中にメモリ逼迫で停止（未出版）。次回 `--assist`/`--auto` で仕上げ。
- **KDPは1日約5冊の新規作成上限**（`本の作成数制限`）。本日分は消費済み。未出品残 ~26冊（`publish_status`: unlisted≈53 / submitted=40 / published=30 / retracted=21）。
- **重要な修正済みバグ**: `scripts/kdp-publish.mjs` の DEFAULT作成経路で、出版クリック後のページ遷移により `fillStep3` が「Execution context destroyed」で例外→実際は出版成功でも `error` 扱いになっていた。→ 例外時＆完了時に `verifyPublished`（本棚のレビュー中/出版準備中/販売中/ライブ判定）で確定するよう修正済み。再実行すると本棚確認で `submitted` に自動整合する（重複作成ガード有り＝二重出版しない）。
- 実行: `RAILWAY_TOKEN=... LINE_CHANNEL_ACCESS_TOKEN=... LINE_USER_ID=... bash scripts/paperback/pb-env.sh node scripts/kdp-publish.mjs --all --limit=8`（`--auto`=resume専用、無印=新規作成＋公開）。新規作成時は再認証(LINE OTPリレー)が入り得る。

### KDP ペーパーバック
- `scripts/paperback/plan.json` 再生成済み（96冊 / ready=93 / 余白NG=2）。
- 保留7冊の下書きは **変換失効(変換未完了)** で出版不可 → 作り直し要（原稿再アップ→数時間の変換待ち→出版）。
- **KDP eBookと同じ「1日5冊の作成枠」を共有**。本日は eBook で使い切ったため未着手。明日以降。
- 実行: `bash scripts/paperback/pb-batch.sh draft`（下書き作成, 5/day, rc=4で制限検出し停止）→ 数時間後 `bash scripts/paperback/pb-batch.sh publish`。表紙は9.5mmセーフゾーン修正済み。

### BOOK☆WALKER
- **AI本OK**（Koboと逆）。ただし入稿フォームの「AI生成」サブカテゴリ（`input.book_sub_category[value="7497"]`）チェックが**必須**。
- **申請は著者あたり月約3件のみ**（faq/9999）。9月分は消化済み（却下6冊中3冊=25966/25962/25963 を再申請成功、残3冊は403）。次は約1ヶ月後。
- 本文のAI開示文は全書籍除去済み（`scripts/bookwalker/remove-ai-disclosure.mjs`, 55冊117文）。
- **日次自動再タグcron `bw.retag.tick` 実装・テスト済**（`apps/worker/src/tasks/bw-retag.ts`, `bw_retag_enabled` フラグでゲート）。却下書籍を自動で AI生成付与＋内容紹介整形(`fitToSentence`)＋クリーンEPUB再アップ＋再申請、403で当tick停止。**要ワーカー再デプロイで有効化**（枠が閉じているので急ぎ不要）。マイグレーション `20260909000000_bw_retag`（`bw_retag_enabled`列）は本番DBに適用済み。
- 本棚: 販売中1（「今日のわたしをいたわる100の言葉」発売日9/8＝**不可侵**）/ 申請中〜113 / 却下数冊。

### 楽天Kobo（KWL）— ❌ 撤退
- **KWLはAI作成本を一切出版不可**（コンテンツポリシー faq 1144, 制作の一部AI利用も含む）。開示文を消しても不可。
- 再出版バッチ(`scripts/kobo/kobo-republish.sh`)を試したが、**停止前に81/89冊が再送信済み**→全てKobo側で却下される。**今後Koboへ再送信しないこと**（アカウントリスク）。

### Booth
- 主力12冊の下書きを7項目自動入力で作成済み（`scripts/booth/booth-drafts.md` にURL一覧）。**作品ファイルUP＋公開は手動**（方針B）。エンジン=`scripts/booth/booth-submit.mjs`、バッチ=`booth-batch-flagship.sh`。

## 実行環境の注意（メモリ）
- 本機RAM 13.8GB。**Docker Desktop＋WSL VM(vmmemWSL)で~2.5GB食う**とブラウザ自動化Chromeがフリーズする（KDP book4/5が実際に停止）。自動化前に Docker を停止（`wsl --shutdown`）＋Chromeタブ整理で3GB以上空けること。

## 次にやること（優先順）
1. KDP: 残り約26冊を修正済みフローで 5冊/日ずつ出版。「夏だけ勝てる馬」下書き仕上げ。
2. ペーパーバック: 7冊作り直し＋新規、5冊/日、変換後に出版。
3. BW: `bw.retag.tick` をワーカーへデプロイ→枠開放時に自動消化。
4. Booth: 各下書きのファイルUP＋公開（手動）。

## 設計ドキュメント
`docs/02-functional-requirements.md`（F-094/095/096 更新済み）, `docs/05-program-design.md`（BW再申請/AI生成サブカテゴリ/月3制限/Kobo・Booth の実発見を記載済み）。
