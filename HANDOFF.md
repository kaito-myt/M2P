# A2P/M2P 作業引き継ぎ（2026-09-16 時点）

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

## ⚠️ 最重要の運用ルール（2026-09-15 に判明）
- **Railway デプロイは必ず `railway up --service <A2P|A2P-Worker|ANP> --detach`**。
  `railway redeploy --from-source` は**新コードを反映しない**（既存イメージ再起動のみ、exit 0 で成功に見える）。
  9/4〜9/15 の「デプロイ済み」は全てこれで未反映だった → 9/15 08:35 に `railway up` で一括反映済み。
- Windows Task Scheduler に `scripts/daily-publish-task.cmd`（日次出版ルーティン）は**未登録**。登録は任意。
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
1. ANP: 上記の人手待ち 1〜3 → 自動公開 ON → 有料記事対応（Phase 3.5）→ TikTok（Phase 4）。
2. KDP: daily-publish を毎日回して残りを消化（Task Scheduler 登録で自動化可）。
3. Kobo テスト 1 冊の結果確認 → 残 87 冊の再送信可否判断。
4. Booth 12 冊の手動公開。
5. 収益: 週次で `docs/05` の KPI を見てテーマ方向を調整。
