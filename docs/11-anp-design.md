# 11. ANP — Automated Note Publishing Tool 設計

> **ANP は M2P プラットフォームの第2ツール**（第1ツール = A2P）。`apps/anp`（`@anp/web` 予定）として
> A2P と横並びに配置し、ポータル（`apps/portal`）から SSO で遷移する。共通認証は `packages/auth`、
> 共通の DB / ストレージ / 通知 / LLM クライアント基盤は既存パッケージを再利用する。
> A2P が「Amazon KDP 書籍」を自動化するのに対し、**ANP は「note 記事」を企画〜執筆〜出版〜販促〜収益化まで自動化**する。

このドキュメントは A2P の設計資産（`docs/01`〜`docs/09`）を土台に、note 固有の差分だけを新規定義する。
A2P と同一で流用できる箇所は「A2P 準拠」と明記し、重複記述を避ける。

---

## 0. ポジショニングと狙い

- **新たな収益基盤**: KDP（買い切り書籍）に対し、note は「有料記事の都度販売＋メンバーシップ（定期購読）＋サポート（投げ銭）」という**継続課金・少額多頻度**の収益モデル。M2P の収益源を分散し、黒字化を加速する。
- **テーマ別マルチアカウント運用（最重要前提）**: note は**テーマ/ニッチごとに複数アカウントを持って運用する**のが前提。1アカウント＝1ニッチ（例: 「副業×AI」「投資初心者」「メンタルケア」…）とし、記事生成・価格戦略・販促・収益追跡をすべて**アカウント単位**で回す。A2P の `accounts`（複数KDPアカウント）＋ org の多アカウント販促戦略の延長線上にある。
- **人間は承認と戦略だけ**: A2P 同様、運営者は「アカウント方針の承認」「公開ゲートの承認」「価格の最終確認」等の要所だけを見る。日次の企画・執筆・出版・販促は自律で回す。

---

## 1. 業務要件（A2P `docs/01` 準拠 + note 差分）

| 項目 | 内容 |
|---|---|
| 誰が | 運営者（シングルユーザー。マルチテナント抽象は作らない＝A2P ルール #1 準拠） |
| 何のために | note を新たな収益基盤にし、テーマ別に複数アカウントを育てて有料記事/メンバーシップ収益を最大化する |
| 何を得る | 「テーマ選定→記事量産→有料/無料の最適化→SNS販促→フォロワー/売上」までの自律ループと、その可視化ダッシュボード |
| 成功指標 (KPI) | アカウント別: フォロワー数、記事本数、有料記事売上、メンバーシップ課金者数、スキ/ビュー、1記事あたり収益、月次純利益（売上−コスト） |

---

## 2. note プラットフォーム制約（新規調査事項・A2P の KDP 知見を適用）

> ⚠️ note には公式の記事投稿 API が（一般提供として）無い。A2P の KDP 自動出版で得た知見
> （認証ウォール・Playwright アシスト・LINE 認証リレー）をそのまま適用する。実装時に確定した
> セレクタ・挙動・再認証ルールは本節と `docs/05` 相当（後述 §7）に必ず追記する（CLAUDE.md ルール #8）。

- **投稿手段**: Playwright による note エディタ自動操作（下書き作成→本文流し込み→見出し画像→価格設定→公開）。KDP と同じく**運営者アシスト型**を基本とし、再認証が要る操作は LINE 認証リレー（`kdp_auth_requests` と同型の `note_auth_requests`）で通す。
- **認証**: note ログイン（メール/パスワード or Google/X 連携）。セッション cookie を暗号化保存し再利用（A2P の `KDP_CRED_KEY` / セッション再利用と同型）。デバイス信頼で OTP を抑制。
- **収益モデル（3種を扱う）**:
  1. **有料記事**（100〜数万円の都度課金。一部無料＋続き有料の「ライン設定」あり）
  2. **メンバーシップ**（月額定期購読。マガジン単位）
  3. **サポート**（任意投げ銭）
- **記事形態**: Markdown 相当のリッチテキスト＋見出し画像（アイキャッチ）＋本文中画像＋埋め込み。文字数は数千字が主。KDP 書籍（数万字）より短く高頻度。
- **規約順守**: note の利用規約・AI 生成物の扱い・過度な自動化/スパム的投稿の禁止に配慮（A2P の「本文にAI開示文を入れない／プラットフォーム開示欄で対応」方針を踏襲。投稿頻度は自然な範囲に制御）。

---

## 3. 機能要件（A2P の F-xxx 体系に対応づけ）

ANP の機能は A2P の対応機能を note 向けに写像したもの。**太字＝note 固有で新規設計が必要**な機能。

### 3.1 アカウント & 戦略
- **F-ANP-01 テーマ別マルチアカウント台帳**: `note_accounts`（複数）。各アカウントに niche/ターゲット/トーン/収益方針（無料比率・有料価格帯・メンバーシップ有無）/リンク SNS を保持。作成・接続（cookie 取り込み）は運営者が一度だけ。
- **F-ANP-02 アカウント別ジャンル/テーマ方針**: A2P の `genre_policy` に相当。29+ジャンル体系（`@a2p/contracts` の genres を流用）＋note向けの追加ニッチ。
- **F-ANP-03 マルチアカウント戦略立案（org連携・任意）**: どのニッチで何アカウント持つか、各アカウントの投稿頻度・価格戦略を org（CEO+本部長）が立案（A2P org の多アカウント販促戦略を流用）。

### 3.2 記事生成パイプライン（A2P の書籍パイプラインを短尺・高頻度化）
- **F-ANP-10 テーマ候補生成（Marketer）**: アカウントのニッチ＋トレンド（Web検索）から記事テーマ候補を生成。A2P Marketer 準拠、出力は「記事タイトル/フック/想定読者/有料無料の推奨/想定価格/競合note」。
- **F-ANP-11 構成生成（Outline）**: 記事の見出し構成。A2P Writer/outline 準拠（短尺）。
- **F-ANP-12 本文執筆（Writer）**: note 記事本文（数千字）。**無料パート＋有料パートの「ライン」構造**（続きは有料）に対応。
- **F-ANP-13 校閲（Editor）**: A2P Editor 準拠。note の読みやすさ（短段落・強調・リード文）に最適化。
- **F-ANP-14 アイキャッチ画像（Eyecatch）**: 見出し画像を生成（A2P の Thumbnail Designer 準拠、`gpt-image` 系）。note の推奨比率（横長 1280×670 目安）で出力。
- **F-ANP-15 品質判定（Quality Judge）**: A2P 準拠。note向け評価軸（フック強度/可読性/有料転換見込み/SEO・検索流入見込み）。
- **F-ANP-16 価格・公開設定の自動決定**: 無料/有料/価格/ラインの位置/メンバーシップ収録可否を自動提案（人間が最終承認するゲートあり）。
- **F-ANP-17 パイプライン自動パス設定**: A2P の `/pipeline/settings`（各工程のAI自動パス＋日次自動テーマ生成）を流用。アカウント別に設定可能に拡張。

### 3.3 出版（note 公開）
- **F-ANP-20 note 公開オートメーション（Playwright, アシスト型）**: 下書き作成→本文/画像流し込み→価格/ライン設定→予約 or 即時公開。KDP アシスト（`scripts/kdp-publish.mjs --assist`）と同型で `scripts/note-publish.mjs` を用意。
- **F-ANP-21 認証リレー**: `note_auth_requests` ＋ LINE webhook（A2P の `kdp_auth_requests` / `/api/line/webhook` を流用・拡張）。
- **F-ANP-22 公開ステータス同期**: 公開済み/下書き/売上を定期スクレイプで同期（KDP publish.status.sync と同型の self-heal 再ログイン付き）。

### 3.4 販促（A2P promotion を流用）
- **F-ANP-30 SNS 自動販促**: 各 note アカウントに紐づく X/Instagram/TikTok へ、記事の告知投稿を自動生成・投稿（A2P の promotion チャンネル基盤・content_creator・動画パイプラインを流用）。**アカウント単位で導線（note記事URL）を差し込む**。
- **F-ANP-31 相互流入設計**: 同一運営者の A2P 書籍 ⇄ note 記事の相互送客（書籍LPに note、note に書籍リンク）。

### 3.5 収益・コスト・運用
- **F-ANP-40 売上/KPI 取得**: note ダッシュボードから 記事別売上・ビュー・スキ・フォロワー・メンバーシップ課金者数をスクレイプ取得（A2P の KDP 売上取得 `docs/09` と同型）。
- **F-ANP-41 コスト/トークン可観測性**: 全 LLM/画像生成呼び出しを `token_usage` に記録（A2P ルール #5 準拠。ANP 分は `tool='anp'` 等で識別）。
- **F-ANP-42 ホーム（ミッションコントロール）**: A2P の S-002 再実装版を流用。当月純利益/売上/コスト/公開記事数/アカウント別成長を集約。
- **F-ANP-43 org 自律運用連携**: A2P の org（CEO+本部長+担当者・自律ループ）に「note 出版本部」「note 販促本部」を追加、または ANP 独立の org を持つ（§5 で選択）。

---

## 4. プロンプトは DB が正（A2P ルール #4 準拠）

runtime エージェント（Marketer/Writer/Editor/Eyecatch/Judge/PriceOptimizer）のシステムプロンプトは
`prompts` テーブルが source of truth。ANP 用の役割（role）とジャンル別プロンプトを seed で投入する。
A2P と DB を共有する場合は `role` 名を `anp.*` で名前空間分離する。

---

## 5. アーキテクチャ

### 5.1 配置（monorepo）
```
apps/
  portal/   ← ハブ（ANP タイル追加済み。SSO）
  web/      ← A2P
  anp/      ← ★ANP の UI + API routes（Next.js 15 / App Router）  ← 新規
  worker/   ← 既存 worker を拡張 or anp-worker を追加（§5.3）
packages/
  auth/     ← 共通認証（そのまま流用）
  db/       ← Prisma（ANP のモデルを追加。§6）
  agents/   ← runtime エージェント基盤を流用し ANP 役割を追加（or packages/anp-agents）
  contracts/ storage/ notify/ output/ kdp-report/ ← 流用
```
> A2P 固有パッケージは `@a2p/*` のまま。ANP 固有を切り出す場合のみ `@anp/*` を新設。
> **判断**: まずは既存 `packages/*` を共有し、ANP 固有ロジックは `apps/anp` + `packages/agents` 内の
> `anp/` サブディレクトリに置く（過度なパッケージ分割を避ける）。

### 5.2 認証・SSO（A2P と同一）
`buildAuthConfig`（`@a2p/auth/config`）を利用。`AUTH_SECRET`/`AUTH_COOKIE_DOMAIN=.m2p.tools` を
A2P・portal と揃えれば SSO 素通り（`docs/10` 準拠）。ANP の本番サブドメイン案 = `anp.m2p.tools`。

### 5.3 ジョブ/ワーカー
graphile-worker を流用。ANP のタスクは `pipeline.note.*`（marketer/outline/writer/editor/eyecatch/judge/publish/export）＋ `note.sales.fetch` / `note.publish.status.sync`。
既存 `apps/worker` にタスクを追加する（サービス増を避ける）。並列度・BookLock 相当（`note_locks`）を用意。

### 5.4 LLM/画像/検索（A2P `docs/03` 準拠）
`AISdkClient`（Vercel AI SDK）＋ `AgentSdkClient`（Web検索付き Marketer）。model_assignments でロール×ジャンル別にモデル割当（A2P と同じルーティング。各 role に active 1件必須の運用も踏襲）。画像 = `gpt-image` 系。

---

## 6. DB スキーマ（新規モデル・A2P 命名規約準拠）

A2P の `books` 系を note 記事系に写像。**マルチアカウントを主キー動線に組み込む**。

- **`note_accounts`**: `id, niche, display_name, handle, target_reader, tone, monetization_policy_json({free_ratio, price_band, membership:bool}), genre_policy_json, session_state_enc, status, created_at`
- **`note_themes`**（= theme_candidates 相当）: `id, note_account_id, title, hook, target_reader, recommend_paid:bool, suggested_price, competitors_json, genre, status(pending|accepted|rejected), rejected_reason, created_at`
- **`note_articles`**（= books 相当）: `id, note_account_id, theme_id?, title, lead, body_md, paid:bool, price_jpy?, paywall_line_pos?, membership_magazine?, eyecatch_r2_key?, status(queued|writing|editing|eyecatch|judging|ready|published|failed|cancelled|needs_human_review), publish_status(draft|published), note_url?, cost_jpy_total, has_pending_comments, quality_score?, published_at, created_at, updated_at`
- **`note_jobs`** / **`note_locks`**: A2P の jobs/book_locks 相当（or 既存 `jobs` を `tool` 列で共用）
- **`note_sales`**（= sales_records 相当）: `id, note_article_id, year_month, revenue_jpy, views, likes, buyers, source, fetched_at`
- **`note_membership_stats`**: `id, note_account_id, year_month, subscribers, mrr_jpy, fetched_at`
- **`note_auth_requests`**: KDP と同型（LINE 認証リレー）
- **`token_usage` / `prompts`**: 既存を `role` 名前空間 (`anp.*`) で共用
- **`jobs` / `book_locks`**: Phase 1 実装で確定 — `book_locks` は流用せず専用 `note_locks`（`note_article_id` を主キー）を新設。`jobs` は共用し `book_id` は常に `null`（`Job.book_id` は `Book` への FK 制約があり NoteArticle を指せないため。記事 ID は `Job.payload_json` に格納する）。

> ⚠️ **実装時の発見・訂正 (2026-09-15)**: `eval_results` は `book_id` が **NOT NULL FK to `Book`** (`onDelete: Cascade`) のため ANP では使えない（当初想定の「共用」は誤り）。代わりに判定結果は `NoteArticle.quality_score`（最終スコアのみ）に保持し、軸別内訳・コメントは `Job.result_json` に残す（Phase 1 の簡略化）。`token_usage`/`prompts` は当初想定通り `role='anp.*'` で共用できる。

---

## 7. パイプライン & シーケンス（A2P `docs/05` 準拠）

```
note.theme.generate (アカウント別・手動起動。UI の「テーマ生成」ボタン)
  → [運営者がテーマ承認 (UI) — NoteArticle 作成]
  → pipeline.note.writer.outline → writer.body → editor → eyecatch → judge (自動連結)
  → judge 合格 (score_total >= 80) → NoteArticle.status='ready' (公開ゲート待ち。Phase 1 はここで停止)
  → [Phase 2] 価格/公開ゲート: 人間承認 or AI自動
  → [Phase 2] pipeline.note.publish (Playwright アシスト) → note.publish.status.sync
  → [Phase 3] 販促: promotion.note.* (SNS 告知・アカウント別導線)
  → [Phase 2] note.sales.fetch (定期)
```

### Phase 1 実装済みタスク (`apps/worker/src/tasks/`)

| タスク名 | ペイロード | 処理概要 | 完了後の遷移 |
|---|---|---|---|
| `note.theme.generate` | `{ note_account_id, job_id, count? }` | note Marketer (`@a2p/agents/anp/theme`, role=`anp.theme`) がニッチ/トーン/直近採用済タイトル (90日除外) を入力にテーマ候補を生成し `NoteTheme(status='pending')` を `createMany` | 次タスクなし (UI 承認待ちで停止) |
| `pipeline.note.writer.outline` | `{ note_article_id, job_id }` | note Writer/Outline (role=`anp.outline`) がリード文+見出し構成 (2〜12) を生成。`NoteArticle.lead` 確定、`status='writing'` | `pipeline.note.writer.body` を自動 enqueue（`lead`/`headings` は子 Job の `payload_json` で forward — `NoteArticle` に永続列を持たないため） |
| `pipeline.note.writer.body` | `{ note_article_id, job_id, lead, headings, feedback? }` | note Writer/Body (role=`anp.writer`) が本文 (目標 4,000 字) を執筆。有料記事は本文中に `<<<PAYWALL>>>` マーカーを 1 回挿入させ、呼出側でマーカー位置を `paywall_line_pos` として抽出・除去。`NoteArticle.body_md`/`paywall_line_pos` 確定、`status='editing'` | `pipeline.note.editor` を自動 enqueue |
| `pipeline.note.editor` | `{ note_article_id, job_id, feedback?, retry_count? }` | note Editor (role=`anp.editor`) が短段落・リード文中心に校閲。`paywall_line_pos` 指定時はマーカーを再挿入して LLM に渡し「保持したまま校閲」を指示、新しい位置を再抽出。`status='eyecatch'` | `pipeline.note.eyecatch` を自動 enqueue（`retry_count` を forward） |
| `pipeline.note.eyecatch` | `{ note_article_id, job_id, retry_count? }` | note Eyecatch (`@a2p/agents/anp/eyecatch`, role=`anp.eyecatch`) が **文字を含まない**挿絵を gpt-image で生成（note 側 UI がタイトルを別途表示するため、A2P のような日本語タイポグラフィ合成レイヤーは Phase 1 では持たない）。R2 `note/{note_article_id}/eyecatch.jpg` に保存、`NoteArticle.eyecatch_r2_key` 確定、`status='judging'`。**`retry_count > 0` かつ既に `eyecatch_r2_key` が設定済みなら再生成をスキップ**（judge 差し戻しは本文のみ変わるため、画像コストの重複を避ける） | `pipeline.note.judge` を自動 enqueue（`retry_count` を forward） |
| `pipeline.note.judge` | `{ note_article_id, job_id, retry_count }` | note Judge (role=`anp.judge`) が 4 軸 (フック強度/可読性/有料転換見込み/検索流入見込み) で採点。`NoteArticle.quality_score` に最終スコアを保持（内訳/コメントは `Job.result_json`） | 合格 (>=80): `status='ready'`。不合格 かつ `retry_count < 1`: `pipeline.note.editor` へ差し戻し (`retry_count+1` を payload に forward、`status='editing'`)。不合格 かつ `retry_count >= 1`: `status='needs_human_review'` |

### 排他制御・冪等性・エラー方針

- `NoteLock`（`@a2p/agents/lib/note-lock` の `acquireNoteLock`/`releaseNoteLock`/`sweepExpiredNoteLocks`）が `BookLock` と完全対称の実装で `pipeline.note.*` の排他を担う（holder 規約 `pipeline:<job_id>`、TTL 30 分）。
- 各タスクは内部 `Job`（既存 `jobs` テーブル、`book_id=null`）を `queued/failed → running → done/failed` で CAS 遷移させる、A2P と同型の冪等性パターン（`Job.status==='done'` は skip）。
- コスト計上: ANP のエージェント呼出は `withTokenLogging`/`withImageLogging` に `bookId` を渡さない（`NoteArticle` は `Book` と無関係の別テーブルのため FK 混線を避ける）。代わりに各タスクが呼出直後に `applyNoteArticleCostFromJob`（`apps/worker/src/tasks/lib/note-article-cost.ts`）で「自分の内部 `Job.id` に紐づく `token_usage.cost_jpy` 合計」を `NoteArticle.cost_jpy_total` に加算する（失敗時は warn のみでタスク自体は継続）。
- `note.theme.generate` は Phase 1 では **cron 化せず** UI の手動起動のみ（`/accounts/[id]` の「テーマ生成」ボタン → `note.theme.generate` を enqueue）。
- ⚠️ **`pipeline.note.*` は `org.ops.watch`（孤児ジョブ検知・自己修復, docs/06）の対象外** — `ops.watch` は `Job.book_id` を起点に停止書籍を検知するが、ANP の `Job.book_id` は常に `null`（`Book` FK 制約のため）。孤児化した note パイプラインは `locks.sweep`（`NoteLock` の TTL 掃除、§7 実装表参照）と `sweepStaleJobs`（`running/queued` かつ 120 分超過の内部 `Job` を `failed` に降格、`apps/worker/src/tasks/locks-sweep.ts`）のみが救済する。Phase 2 で `note_account_id`/`note_article_id` を軸にした専用の自己修復ジョブが必要になった場合はここに追記する。

### Phase 2+ (未実装)

`pipeline.note.publish`（Playwright アシスト）/ `note.publish.status.sync` / `promotion.note.*` / `note.sales.fetch` は §8 ロードマップの Phase 2/3 で実装する。

---

## 8. 段階的ロードマップ

- **Phase 0（設計・雛形）**: 本ドキュメント／`apps/anp` スキャフォールド（SSO で起動する骨格＋ホーム骨格）／portal タイル（済）。
- **Phase 1（MVP・実装済み）**: 単一〜複数アカウントで theme→outline→writer.body→editor→eyecatch→judge→**status='ready' (下書き相当)** まで自動連結。`apps/anp` に `/accounts`・`/accounts/[id]` UI（アカウント作成・テーマ生成/承認/却下・記事一覧）を実装。note 公開はアシスト手動（Phase 2）。売上手入力。
- **Phase 2**: マルチアカウント台帳／価格自動決定／note 公開オートメーション（Playwright アシスト）＋認証リレー／売上スクレイプ。
- **Phase 3**: SNS 自動販促（A2P promotion 流用・アカウント別導線）／メンバーシップ運用／org 自律連携。
- **Phase 4**: A2P⇄note 相互送客、note→書籍化などクロスツール収益最適化。

---

## 9. 技術スタック（A2P `docs/03` と同一）

Next.js 15 + TypeScript / Railway（web + worker + Postgres）/ Prisma / graphile-worker /
Vercel AI SDK + Anthropic SDK / gpt-image / Cloudflare R2 / NextAuth(共有) / Tailwind + shadcn/ui / Vitest + Playwright。

---

## 10. ブランド

- 名称: **ANP（Automated Note Publishing Tool）**
- ロゴ: `apps/portal/public/tools/anp.png`（深緑 #1f4d3f × チャコール #1f2933、書類＋出版フローの矢印）。アクセント = `#1f4d3f`。
- ポータル表示: A2P と横並びのタイル（ロゴ画像）。本番サブドメイン案 `anp.m2p.tools`。

---

## 申し送り（後続作業）

1. `apps/anp` スキャフォールド（portal と同じ SSO 配線・`buildAuthConfig`・Edge 用 `@a2p/auth/config`）。— **完了**
2. Prisma に §6 モデル追加＋マイグレーション＋seed（prompts の `anp.*` role）。— **完了**（モデルは本番 DB にテーブル済み。seed は `packages/db/seed-anp.ts`＝`pnpm --filter @a2p/db run seed:anp` で `prompts`/`model_assignments` の `anp.*` 5 role を投入。Phase 1 パイプライン本体（§7 記載の 6 タスク）も実装済み）。
3. note の実挙動（ログイン/エディタ/価格設定/公開のセレクタ・再認証ルール）を実装時に本ドキュメント §2/§7 へ追記（CLAUDE.md ルール #8）。— Phase 1 は note 公開自体を実装しないため未着手（Phase 2 の申し送りとして継続）。
4. 本番: Railway に ANP サービス追加＋`anp.m2p.tools`＋`NEXT_PUBLIC_TOOL_ANP_URL` を portal に設定（`docs/10` の SSO 手順を流用）。
5. **[Phase 1 実装で新規発見]** `eval_results` は `book_id` NOT NULL FK のため ANP では使えない（§6 参照）。Phase 2 で判定内訳の永続化が要件化する場合、専用 `note_eval_results` テーブルの新設を検討すること。
6. **[Phase 1 未実装・要フォロー]** `pipeline.note.judge` の再試行後 (`retry_count>=1` で不合格) の `status='needs_human_review'` は UI 側での「要確認」一覧・再実行導線が未実装（`/accounts/[id]` の記事一覧にステータス表示のみ）。Phase 2 で対応。
7. **[Phase 1 実装メモ・解消済]** `apps/anp/package.json` に `@a2p/contracts`・`graphile-worker` を追加。ワークスペースリンクは `pnpm exec` 実行時に自動反映され、`pnpm --filter @anp/web exec tsc --noEmit` で clean を確認済み（`pnpm-lock.yaml` にも反映済み）。
