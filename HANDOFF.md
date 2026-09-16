# A2P/M2P 作業引き継ぎ（2026-09-16 昼 時点）

別端末で続きを作業するための現況・残タスク・発見した制約のまとめ。
起動後はまず本書＋`CLAUDE.md`＋`.claude-handoff/memory/*.md` を読むこと。
（旧版 2026-09-09 の内容は本書に統合。Git 履歴 `git log --oneline` にコミット単位の作業履歴あり）

## 別端末でのセットアップ手順
1. `git clone https://github.com/kaito-myt/M2P.git` → `pnpm install`
2. **`.env.local` は gitignore で push されていない**。最低限 `RAILWAY_TOKEN=` だけ埋めれば
   `scripts/paperback/pb-env.sh` が DB/R2/Amazon/KDP_CRED_KEY を Railway から取得する
   （テンプレは `.env.example`。Railway ダッシュボード > Account Settings > Tokens で発行）。
3. 会話の記憶は `.claude-handoff/memory/*` を新端末の `~/.claude/projects/<ハッシュ>/memory/` に配置
   （ハッシュは絶対パス由来。`C:\DEV\M2P` に clone すれば `C--DEV-M2P`）。
4. ブラウザ自動化のログイン状態（`scripts/.kdp-userdata`, `scripts/.note-userdata*`）は gitignore。
   KDP は初回 OTP 再認証（LINE リレー or `kdp_auth_requests` 行を手動 fulfilled）。
   BW/Kobo/note のセッションは DB（app_settings / promotion_channel_settings）に暗号化保存済みなので端末非依存。

## 2026-09-16（本機 C:\DEV\M2P 側）で実施したこと
本書の指示どおり pull → 残作業を進めた。**3 件の本番障害を発見・修正・デプロイ済み**（worker/web とも `railway up`、
`deployment list` で SUCCESS 確認）。詳細は各 docs/05 の該当節と memory `reference_rekick_freeze.md`。
1. **日次テーマ自動生成が 9/11〜9/15 の 5 日間全滅**していた（`pipeline.theme.generate` が毎晩 22:00 JST に
   `ZodError too_big keywordOrBrief max 500`）。原因 = 9/11 に設定した 732 字の `pipeline_theme_direction` が
   Marketer 入力の上限 500 字に弾かれていた。修正 = 入口〜Marketer まで上限 4,000 字で統一
   （contracts `marketer.ts` / worker `pipeline-theme-generate.ts` / web `themes-core.ts`,`pipeline-settings-core.ts`）。
   **今夜 22:00 JST の cron で復帰するはず。翌朝 `jobs where kind='pipeline.theme.generate'` が done か要確認。**
2. **judge 再キック後の本が無言凍結**（running 17 冊 / judging 3 冊 = 計 20 冊、8/31〜9/4 から放置）。editor / writer.chapter の
   「二重 enqueue 防止」が初回パイプラインの done Job を見て次工程を enqueue しなかった。修正 = editor はサムネ生成済みなら
   judge 直行、writer.chapter 再キックは兄弟 Job 完了で editor 起動（retry_count/feedback 引継ぎ）。手動承認 SA も同様。
   凍結分は scratchpad の復旧スクリプトで次工程を再投入（結果は下記「復旧結果」）。
3. **blog の育成投稿生成（`promotion.content.generate {channel:'blog'}`）が 9/2 から全滅**（9 ジョブ×最大 25 リトライ、
   毎回 LLM 課金だけ発生）。原因 = 長文記事 12 本が maxOutputTokens 8,192 で途中切れ→JSON 破損→`posts` 欠落。
   修正 = blog/note は 32,768 に引き上げ（`content-creator/index.ts`）。死んだ graphile 行は削除済み。
4. **needs_human_review 通知メールが `React is not defined` で judge Job を落としていた**（復旧後の 5 冊で発覚、既存バグ）。
   `@a2p/notify` の React Email テンプレートが worker の tsx 実行で classic JSX になるのが原因。全テンプレートに React import を明示し、
   judge / alert-cost-check のメール組立を try 内へ（通知失敗は非致命）。worker を再デプロイ済み。
- ほか: graphile の exhausted 残骸（bw.submit / kdp.submit / optimizer.prompt.generate）削除、stale だった単体テスト
  （env keys 39 項目 / judge maxOutputTokens 12288）を実態に合わせて修正。**まだ落ちている無関係テスト 3 件**
  （worker: writer-outline notify payload・promotion-automation の日程 / web: promotion-channels-core の probe 引数）は
  他端末側のコミット由来で未修正 → 次の作業で直すこと。
- **Task Scheduler に `M2P-daily-publish`（毎日 09:30・対話ログオン時のみ・`scripts/daily-publish-task.cmd`）を登録**し、
  本日分は `schtasks /Run` で手動起動した（ログ = `scripts/daily-publish.log`, `scripts/daily-publish-task.log`）。
- **Kobo の保存セッションは失効**（`rakutenkwl.kobo.com` が全 89 UUID で 403 → ログイン画面へリダイレクト）。
  テスト 1 冊の結果確認・残 87 冊の再送信判断は、運営者が `/kobo` タブから手動ログイン→セッション再保存してから。
- **Railway CLI 注意（本機）**: フォルダが `railway link` されていないため、素の `railway up/logs/deployment list` は
  「No linked project found」で**何もせず exit 0**。必ず `export RAILWAY_TOKEN=$(grep '^RAILWAY_TOKEN=' .env.local | cut -d= -f2-)`
  を先に通す（`pb-env.sh` と同じ）。
- 収益確認（DB）: 9 月売上 ¥279（2 冊）・KENP 3,931 頁、AI コスト ¥91,617（9/1〜16）。`monthly_budget_exceeded=true`
  （赤ライン ¥30,000 超過）だがパイプラインは止まらない設計。テーマ方針は 9/11 の実績方針のまま。

### 復旧結果（2026-09-16 昼）
- 対象 20 冊（running 17 / judging 3）を修正版 worker デプロイ後 11:43 JST に再投入。内訳: **judge 直行 14**（editor 再キック後の凍結、retry_count=1 引継ぎ）/
  **editor 再投入 3**（writer.chapter 全章再キック後の凍結、競馬 3 冊、feedback 引継ぎ）/ **export 再投入 2**（旧 done 本を ops-watch 修復が再校閲して
  running に戻していた残骸、未出版なので出力ファイルを作り直し）/ **status=done 復元 1**（同残骸だが KDP 出版済み「今日のわたしをいたわる100の言葉」）。
  **11:52 JST 時点の結果**: judge 14 冊中 **6 冊合格（80〜84 点）→ thumbnail 自動採用 → seo → export へ進行中**、**8 冊は不合格（retry 上限）→ needs_human_review**
  （運営者の判断待ち: 乙女ゲー/宮廷薬師/極道の娘/転生皇帝/モテる男/透明な共犯者/最後のオーケストラ/ファンダムの神殿）。export 2 冊は done。
  editor 3 冊（競馬）は実行中 → 完了後に judge 直行。needs_human_review 8 冊の通知メールは下記 4 の既存バグで失敗（本の状態は正しい）。
  4 の修正で 11:52 に worker を再デプロイした際、実行中だった editor 3 / seo 1 / blog 生成 1 が旧コンテナごと死亡（graphile 行は旧 worker のロック持ち、
  public.jobs は running のまま、book_locks 残留）→ 11:55 に手動で解放（graphile unlock＋jobs を queued に戻す＋book_locks 削除）し新 worker が再開。
  **教訓: 長時間ジョブ実行中の  は避ける**（memory  ⑥ と同じ罠。org.ops.watch の 6 時間毎自己修復でも直るが時間を失う）。
- judge は RETRY_LIMIT=1 のため、今回 80 点未満なら `needs_human_review` で止まる（再々キックはしない）。翌朝 `books.status` を確認。
- blog 育成投稿の生成ジョブを 1 件だけ再投入（graphile job 150030）。成功すれば `promotion_posts(channel=blog, kind=value)` に 12 件入る。

## ⚠️ 最重要の運用ルール（2026-09-15 に判明）
- **Railway デプロイは必ず `railway up --service <A2P|A2P-Worker|ANP> --detach`**（本機では `RAILWAY_TOKEN` を export してから）。
  `railway redeploy --from-source` は**新コードを反映しない**（既存イメージ再起動のみ、exit 0 で成功に見える）。
  9/4〜9/15 の「デプロイ済み」は全てこれで未反映だった → 9/15 08:35 に `railway up` で一括反映済み。
- Windows Task Scheduler に `scripts/daily-publish-task.cmd`（日次出版ルーティン）を **`M2P-daily-publish` として登録済み（本機、09:30 毎日）**。
  別端末では未登録（登録は `schtasks /Create /SC DAILY /ST 09:30 /TN M2P-daily-publish /TR C:\DEV\M2P\scripts\daily-publish-task.cmd /IT /F`）。
- KDP スクリプトは `scripts/paperback/out/` が無いと全滅（新 clone では mkdir が必要）。

## チャネル別 現況

### KDP eBook / ペーパーバック
- `publish_status`: published=59 / submitted・unlisted 残あり。本棚同期 `bash scripts/kdp-sync-shelf.sh` で DB を実態に合わせる。
- 日次ルーティン `bash scripts/daily-publish.sh` = 本棚同期→下書き resume（枠非消費）→新規作成5冊→BW 再申請→PB 出版。
- **creation_limit** は「1日5冊」ではなく審査滞留に応じたアカウント制限。resume は非消費。PB 枠は別。
- PB 価格 = `scripts/paperback/pb-price.mjs`：`max(¥980, ロイヤリティ¥150 確保価格)`（方針B）。
- PB のプレビュー承認ゲート（GUTTER_ISSUE 等）は react-pdf の CJK 改行修正（`cjkSoftBreak`/ZWSP/kinsoku）で解決。
  全 114 冊 PDF 再生成済み（R2 に `.bak-<ts>` バックアップあり）。
- KDP 表紙は 9.5mm セーフゾーン対応済み。

### BOOK☆WALKER
- 申請枠は**月約3件のローリング**（日次ではない）。`scripts/bookwalker/retry-queue.txt` の 5 冊は枠が開き次第 daily-publish が自動再申請。
- 却下本の編集は取り下げ（`POST /api/books/drop`）後のみ。シリーズ情報は `#sereis_selector`（typo そのまま）。
- 「AI生成」タイトル接頭辞は**存在しない**（bw-shelf-enum のバッジ抽出バグだった。修正済み）。
- 本文の AI 開示文は全書籍から除去済み（`remove-ai-disclosure.mjs`）。

### 楽天Kobo
- 88 冊却下 → 1 冊テスト再送信中（作成中）。結果を見てから残りを判断。作品一覧は `rakutenkwl.kobo.com/v2/ebooks`（SPA）。
- **2026-09-16: 保存セッション失効を確認**（API 全件 403、サインインへリダイレクト）。hCaptcha のため自動再ログイン不可 →
  運営者が `/kobo` タブの手動ログイン→セッション保存をやり直すまで状態確認・再送信ともに不可。

### Booth
- 主力12冊の下書き作成済み（`scripts/booth/booth-drafts.md`）。ファイルUP＋公開は手動。

### 販促（SNS）
- ペルソナ「ことは」（20代読書女子）で x/instagram/tiktok/note/blog 統一、2 投稿/日/チャネル。content_creator v5（実在良書紹介のみ）。
- 9/15 に停滞していた 71 投稿を再スケジュール済み。

### 収益・コスト（9月）
- 売上 ¥0（KENP 2,542）、AI コスト ¥81,974/11日 → 今月黒字は不可能、損益分岐が現実目標。
- 対策済み: judge リトライ `RETRY_LIMIT=1`、prompt caching 有効化（editor/writer/chapter）、テーマ方向を
  light_novel(古典翻案)/競馬/AI/健康 に寄せ self_help/novel/lifestyle から離脱、autopass 一時停止。

## ANP（note 自動出版ツール）— Phase 1〜3 実装・デプロイ済み
- 設計 = `docs/11-anp-design.md`（実 DOM・制約・移行記録は全てここ）。アプリ = `apps/anp`、Railway サービス `ANP`。
- Phase 1: theme→outline→body→editor→eyecatch→judge（本番 E2E 検証済み、記事 4,242 字 ¥78.97、judge 74 点）。
- Phase 2: note エディタへの下書き作成（`pipeline.note.publish`）。**現在 dry-run**（`app_settings.anp_publish_dry_run=true`, `anp_auto_publish_enabled=false`）。
- Phase 3: X/Instagram 告知（3/日/チャネル上限, TikTok は Phase 4）、`note.sales.fetch`（ダッシュボード READ-ONLY・select 実操作で THIS_MONTH）、ホーム KPI。
- **人手待ち**:
  1. note 本人情報登録（KYC）→ 有料記事解放。完了後に価格/有料ライン UI を偵察して有料公開を実装。
  2. dry-run 下書き `https://editor.note.com/notes/n800cf6101fa9/edit/` を手動で投稿 → 公開 URL パターン確認 → `anp_publish_dry_run=false`。
  3. 検証用下書き削除: n6845533ebcf7 / n9c510facf4dc / n1d09eea651e3 / ne071421d3e1d。
- 既知の罠: `note.theme.generate` は `job_id`（app jobs 行）必須。judge の `score_total` は LLM が合計 400 を返すため `.catch(0)` で緩め再計算。

## 実行環境の注意
- 本機 RAM 13.8GB。Docker Desktop＋WSL で ~2.5GB 消費するとブラウザ自動化がフリーズ → `wsl --shutdown` 推奨。
- `TaskStop` で子 node/chrome が生き残る → 明示 taskkill。KDP Chrome プロファイルは同時実行不可（daily-publish と create を並走させない）。
- graphile-worker の残骸掃除は `graphile_worker._private_jobs`（`jobs` はビュー）。

## 次にやること（優先順）
0. **翌朝の確認**: (a) `pipeline.theme.generate` が 9/16 22:00 JST に done になったか、(b) 復旧した 20 冊が judge→export まで進んだか
   （`books.status in ('running','judging')` で 1 日以上更新の無い本が残っていないか）、(c) blog の育成投稿が生成されたか
   （`promotion_posts where channel='blog' and kind='value' and status='scheduled'`）、(d) daily-publish のログ。
1. ANP: 上記の人手待ち 1〜3 → 自動公開 ON → 有料記事対応（Phase 3.5）→ TikTok（Phase 4）。
2. KDP: daily-publish は本機 Task Scheduler で毎日 09:30 に自動実行（PC がログオン状態のときのみ）。
3. Kobo: **運営者が手動ログイン→セッション再保存** → テスト 1 冊の結果確認 → 残 87 冊の再送信可否判断。
4. Booth 12 冊の手動公開。
5. 収益: 週次で `docs/05` の KPI を見てテーマ方向を調整。
6. 残っている無関係テスト 3 件（上記）の修正。
