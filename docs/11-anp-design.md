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

### 2.1 エディタの実DOM（2026-09-15 偵察 `scripts/anp/note-editor-recon.mjs`）

- **新規記事**: `https://note.com/notes/new` へ遷移すると **`https://editor.note.com/notes/<noteId>/edit/`** へリダイレクトされ、
  その時点で下書き ID が採番される（URL の `n…` が note の記事 ID）。エディタは別オリジン `editor.note.com`。
  **⚠️ 既存下書きを開き直す resume は行わない**（2026-09-16 code review #4 で実機検証し、本文が
  末尾ではなく既存ブロックの途中に重複挿入される事故を確認、詳細は §7 参照）— `pipeline.note.publish`
  は毎回この URL から新規下書きを作る。
- **タイトル**: `textarea[placeholder="記事タイトル"]`（クラス名は styled-components のハッシュで不安定・使わない）。
- **本文**: `div.ProseMirror[contenteditable="true"]`（ProseMirror）。Markdown は貼り付けでは解釈されないため、
  見出し/箇条書き/画像/有料エリア指定はツールバー左の「+」ボタン(`button[aria-label="メニューを開く"]`)を
  開いてから配下の項目（textContent で特定: 大見出し・小見出し・箇条書きリスト・画像・有料エリア指定など、
  aria-label は無い）をクリックする、または `page.keyboard.type` と Enter で段落を作る（詳細は下記および
  §7）。`input[type=file]` は初期 DOM に存在せず、「画像」クリック後の filechooser イベントで受ける
  （= BW/KDP と同型）。
- **フッター操作**: 「下書き保存」「公開に進む」はボタンの**テキスト**で特定する。
  **タイトル・本文が空だと「公開に進む」は無効**（ツールチップ「タイトル、本文を入力してください」）。
- **セッション**: `promotion_channel_settings.config_json.note_session_enc`（`API_CRED_KEY` で AES-256-GCM）に
  保存済みの storageState で `note.com` / `editor.note.com` 双方にログイン状態で入れることを確認。
  ANP マルチアカウントでは **`note_accounts.session_state_enc` にアカウント別に保存**し、この共通セッションは
  Phase 2 の初期アカウント（1 件目）へ移行する。
- **公開設定画面（2026-09-15 Phase2 実装時に `scripts/anp/note-editor-recon2〜5.mjs` で採取）**:
  タイトル/本文を入力してから「公開に進む」を押すと `https://editor.note.com/notes/<noteId>/publish/`
  へ遷移する。ヘッダーのボタンは **「キャンセル」/「投稿する」**（下書き編集画面の「下書き保存」/
  「公開に進む」とは文言が異なるので注意）。左サイドバーは「ハッシュタグ／記事タイプ／記事の追加／
  クーポン／詳細設定」のタブ構成。
  - ハッシュタグ: `input[placeholder="ハッシュタグを追加する"]`（`role=combobox`）。本文中の単語から
    自動サジェストが並ぶ（クリックで追加）。
  - 記事タイプ（有料/無料）: `input#free[name=is_paid]` / `input#paid[name=is_paid]` の radio。
    ラジオ自体は視覚的に隠されており、祖先の `<label>`（`cursor:pointer`）をクリックする必要がある
    （BW の非表示チェックボックスと同型の罠）。**⚠️ さらに evaluate 内の synthetic `el.click()`
    では note の React ハンドラが発火せず切り替わらない(2026-09-16 code review #5 で判明) —
    `<label>` の `getBoundingClientRect()` を取得し `page.mouse.click(x, y)` する trusted click
    が必要（`scripts/anp/note-editor-recon5.mjs` で実証）。**
  - **⚠️ 重大な発見: 有料記事を初めて選択すると note が「本人情報の登録」モーダル（個人/法人・氏名・
    住所等の KYC）を要求する。** このモーダルは同一 UI 内で完結せず追加情報の入力が必要で、
    運営者が note 管理画面で一度手動登録するまで有料記事の公開設定（価格/ライン）画面へ進めない。
    そのため **価格入力欄・有料ライン位置指定 UI のセレクタは Phase 2 時点で未採取**
    （KYC 完了後に追加の dry-run 偵察で採取し本節を更新すること）。**2026-09-16 code review #2 の
    結論として、価格 UI 実装までは有料記事の実公開自体を `pipeline.note.publish` 側で禁止した
    （§7 `shouldBlockPaidPublish`）。上記の KYC モーダル検知ロジック(`selectPaidAndCheckKyc`)は
    現状のフローには到達しないが、価格 UI 実装時に備えてコードは残置している。**
  - 有料ラインは公開設定画面側の機能ではなく、**本文ツールバー(「+」挿入メニュー)の
    「有料エリア指定」ボタン**（textContent、aria-label 無し）でカーソル位置に区切りを挿入する方式
    と判明（`packages/agents/src/anp/writer.ts` が生成する `<<<PAYWALL>>>` マーカー位置と対応させ、
    本文流し込み時にこのボタンをクリックする実装にした — `apps/worker/src/tasks/note-publish/`）。
  - 本文ツールバー左の**「+」挿入メニューを開くボタン**: `button[aria-label="メニューを開く"]`
    （2026-09-16 `scripts/anp/note-editor-recon6.mjs` で採取。カーソルが置かれた行の左に表示される）。
    見出し/箇条書き/画像/有料エリア指定ボタンはこのメニュー配下にあり、**確実にクリックさせるため
    実装では必ず先にこのボタンを押してからメニュー項目をクリックする**(未展開でも textContent
    クリックが効くケースを確認したが、タイミング依存の疑いがあり再現性が不確実なため)。
  - 本文ツールバーの「+」挿入メニュー項目（すべて `textContent` で特定、aria-label 無し）:
    `AIアシスタント, 画像, 音声, 埋め込み, ファイル, コミック, 目次, 大見出し, 小見出し,
    箇条書きリスト, 番号付きリスト, 引用, コード, 区切り線, 有料エリア指定`。
  - テキスト選択時のバブルツールバー（aria-label あり）: `見出し, 太字, 取り消し線, リスト,
    文章の配置, リンク, 引用, コード`。
  - 「詳細設定」に `クリエイターページに表示 / 記事の自動翻訳 / AI学習対価還元プログラムに参加する /
    コメントの受けつけ(プレミアム) / 予約投稿(プレミアム)` のトグルがあるが Phase 2 では未使用
    （既定値のまま投稿する）。
  - 投稿後の公開 URL パターンは `https://note.com/<handle>/n/<noteId>` と想定しているが、
    KYC 未完了のため実際の投稿到達は Phase 2 時点で未検証（無料記事のみ検証可能。運営者の
    本アカウントで無料記事を 1 本テスト公開して確定させることを推奨）。

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

- **`note_accounts`**: `id, niche, display_name, handle, target_reader, tone, monetization_policy_json({free_ratio, price_band, membership:bool}), genre_policy_json, session_state_enc, status(active|paused|archived), created_at`。
  **`session_state_enc` は `KDP_CRED_KEY` で暗号化**（`bw_session_state_enc`/`kdp_session_state_enc` と同じ鍵。
  `API_CRED_KEY` ではない — Phase 1 の暫定共有セッション `promotion_channel_settings.config_json.note_session_enc`
  は `API_CRED_KEY` だったため、`scripts/anp/note-session-migrate.mjs` で再暗号化して移行する）。
- **`note_themes`**（= theme_candidates 相当）: `id, note_account_id, title, hook, target_reader, recommend_paid:bool, suggested_price, competitors_json, genre, status(pending|accepted|rejected), rejected_reason, created_at`
- **`note_articles`**（= books 相当）: `id, note_account_id, theme_id?, title, lead, body_md, paid:bool, price_jpy?, paywall_line_pos?, membership_magazine?, eyecatch_r2_key?, status(queued|writing|editing|eyecatch|judging|ready|published|failed|cancelled|needs_human_review), publish_status(draft|published|unlisted), note_url?, cost_jpy_total, has_pending_comments, quality_score?, published_at, created_at, updated_at`。
  `publish_status='unlisted'` は Phase 2 `note.publish.status.sync` が追加した状態（公開後に非公開化/404 を検知）。
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
  → judge 合格 (score_total >= 80) → NoteArticle.status='ready' (公開ゲート待ち)
  → [Phase 2 未実装] 価格/公開ゲート: 人間承認 or AI自動 (現状は UI の「公開(dry-run)/公開」ボタン手動起動、または dispatcher 自動)
  → [Phase 2 実装済み] pipeline.note.publish (Playwright アシスト。UI ボタン or note.publish.dispatch) → note.publish.status.sync (6h毎)
  → [Phase 3] 販促: promotion.note.* (SNS 告知・アカウント別導線)
  → [Phase 3] note.sales.fetch (定期)
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

### Phase 2 実装済みタスク — note 公開オートメーション (`apps/worker/src/tasks/`)

| タスク名 | ペイロード | 処理概要 | 完了後の遷移/状態 |
|---|---|---|---|
| `pipeline.note.publish` | `{ note_article_id, job_id, dry_run? }` | `NoteArticle(status='ready')` を Playwright ヘッドレスで note へ送信（`apps/worker/src/tasks/note-publish/playwright-note-publish-port.ts`）。①**毎回 `note.com/notes/new` で新規下書きを作成**して noteId を採番(resume はしない。理由は下記「本文重複バグ」参照)、失敗しても即 `NoteArticle.note_url` に保存。②タイトル/本文(`buildNoteBlocks` で見出し/箇条書き/段落+有料ラインに分解)/見出し画像を流し込み(見出し/箇条書き/画像/有料エリア指定は必ず「+」挿入メニューを開いてから項目クリック — 下記参照)。③「下書き保存」必須(dry_run はここで終了、`publish_status='draft'`)。④`dry_run=false`: **有料記事(`paid=true`)はこの時点で必ず `blocked` にして中断**(価格/有料ライン設定 UI 未実装、`shouldBlockPaidPublish`。有料エリア指定マーカーの挿入自体に失敗した場合も同様に中断し有料本文の誤・無料公開を防ぐ)。無料記事のみ「公開に進む」→ 公開設定画面 →「投稿する」→ 完了確認は `note.com/<handle>/n/<noteId>` への遷移。各段で R2 `debug/note-publish/<article>-<step>-<ts>.png` にスクショ保存 | 成功(公開): `status='published'`, `publish_status='published'`, `published_at`, `note_url`確定 + LINE通知(アカウント`display_name`込み)。成功(dry-run): `publish_status='draft'`のみ。`not_logged_in`: `NoteAccount.status='paused'`+LINE通知、記事は`ready`のまま保持。`blocked`/`error`: 記事は`ready`のまま、`note_url`は保持し次回再試行可能(ただし次回も新規下書きになるため note 上に下書きが積み残る — 運営者が適宜整理) |
| `note.publish.dispatch` | (cron, payload無し) | `AppSettings.anp_auto_publish_enabled=true` のとき、`note_articles.status='ready' AND publish_status='draft' AND paid=false` をアカウントごとに1件(`note_accounts.status='active'`のみ)選び `pipeline.note.publish` を enqueue(`dry_run=AppSettings.anp_publish_dry_run`)。1 tick 最大3件。`job_key='note-publish-<article_id>'`で重複防止。**`paid=false` に限定**(有料記事は価格 UI 未実装のため自動運用対象外 — 手動 dry-run のみ) | 対象記事があるアカウント分だけ enqueue。次回tickまで待機 |
| `note.publish.status.sync` | (cron, payload無し) | READ-ONLY。`publish_status='published'`の記事の`note_url`を開き、404/非公開文言を検知したら`unlisted`に降格。セッション失効検知時はそのアカウントを`paused`+LINE通知して走査打ち切り(dispatcher と同じ扱い) | `publish_status='unlisted'`への降格 or 変更なし |

**排他/冪等性**: `pipeline.note.publish` は Phase 1 の `pipeline.note.*` と同じ内部 `Job` CAS + `NoteLock`(`pipeline:<job_id>`, TTL 30分) パターン。`maxAttempts=2`(dispatcher/UI 双方の enqueue で指定)。

**dry-run の二重強制 (2026-09-16 code review #1)**: 実公開事故を防ぐため、dry-run 判定は worker/UI の両方で安全側に倒す。
- `pipeline.note.publish`: payload の `dry_run` 省略時は `true` 扱い。かつ `effectiveDryRun = (dry_run ?? true) || AppSettings.anp_publish_dry_run` — グローバル設定が ON の間は呼出側が `dry_run:false` を渡しても強制的にドライランにする。
- `apps/anp` の `publishArticle` Server Action: `dry_run:false` 要求は `AppSettings.anp_publish_dry_run=true` の間サーバー側で拒否する。UI の `PublishArticleButton` も同設定を見て「公開する」ボタン自体を無効化する。

**「+」挿入メニュー (2026-09-16 code review #3, `scripts/anp/note-editor-recon6〜9.mjs` で追加採取)**: 見出し/箇条書き/画像/有料エリア指定ボタンは本文ツールバー左の「+」ボタン(`button[aria-label="メニューを開く"]`)配下にある。実機では「+」を開かずに直接 textContent クリックしても動作するケースを確認したが(タイミング依存の可能性があり再現性が不確実)、確実性のため実装では必ず先に `openPlusMenu()` で開いてから項目をクリックする。項目が見つからない場合は `log.warn` し、見出し/箇条書きはプレーンテキストとして続行、有料エリア指定は失敗時に処理を中断する(上記参照)。実際に dry-run で見出し(H2/H3相当)・箇条書き(UL)が正しく反映されることをスクリーンショットで確認済み。

**本文重複バグと resume 廃止 (2026-09-16 code review #4)**: 当初は `NoteArticle.note_url` (前回試行の下書き URL) があれば `editor.note.com/.../edit/` を再度開いて resume する設計だったが、実機検証で `Control+A`→`Delete` による全消去が確実に効かず(カーソル位置がドキュメント全体でなく特定のブロック内に留まり、新規本文が既存リストの途中に挿入される事故を確認)、**resume を廃止し毎回新規下書きを作成する方式に変更**した。note には KDP のような日次作成数上限が無いため、失敗時に下書きが積み残る方を安全側として選んでいる。`NoteArticleInput.existingNoteUrl` は公開処理では使わずログ用にのみ保持する。

**`#paid` ラジオの trusted click (2026-09-16 code review #5)**: 記事タイプの `#free`/`#paid` (name=`is_paid`) は視覚的に隠された `<input>` で、`el.click()` による synthetic click では note の React ハンドラが切り替わらない(BW の非表示チェックボックスと同型の罠)。祖先 `<label>` の `getBoundingClientRect()` を evaluate で取得し、Node 側から `page.mouse.click(x, y)` する trusted click で切り替える(`selectPaidAndCheckKyc`、`scripts/anp/note-editor-recon5.mjs` で実証 — 実際に切り替わると note が「本人情報の登録」KYC モーダルを要求することを確認済み)。**上記の有料記事ブロックにより現状の実公開フローはこの関数に到達しない**(価格 UI 実装時に有効化する下準備として実装のみ残置)。

**セッション運用 (§6 の移行方針の実装)**:
- 移行: `scripts/anp/note-session-migrate.sh <note_account_id>`（`config_json.note_session_enc`(`API_CRED_KEY`)→復号→`KDP_CRED_KEY`で再暗号化→`note_accounts.session_state_enc`）。2026-09-15 に初回アカウント(`note-acc-1`)へ実施し疎通確認済み。
- 新規取り込み: `scripts/anp/note-session-capture.sh <note_account_id>`（ローカル専用・headful Chrome で手動ログイン→`note_accounts.session_state_enc`へ暗号化保存）。note のログインは reCAPTCHA によりデータセンターIP(Railway worker)からは不可だが、**保存済みセッションの再利用(Playwright storageState)は通る**（note-engage で実証済み、Phase 2 でも `pipeline.note.publish`/`note.publish.status.sync` の dry-run 下書き保存で再確認済み）。

**設定 (`AppSettings`, migration `20260915000000_anp_publish_dispatch`)**: `anp_auto_publish_enabled`(既定false) / `anp_publish_dry_run`(既定true)。`apps/anp` の `/settings` 画面(`app/actions/settings.ts`)から切替可能。

### Phase 3+ (未実装)

`promotion.note.*`（SNS 告知・アカウント別導線）/ `note.sales.fetch`（売上スクレイプ）は §8 ロードマップの Phase 3 で実装する。

---

## 8. 段階的ロードマップ

- **Phase 0（設計・雛形）**: 本ドキュメント／`apps/anp` スキャフォールド（SSO で起動する骨格＋ホーム骨格）／portal タイル（済）。
- **Phase 1（MVP・実装済み）**: 単一〜複数アカウントで theme→outline→writer.body→editor→eyecatch→judge→**status='ready' (下書き相当)** まで自動連結。`apps/anp` に `/accounts`・`/accounts/[id]` UI（アカウント作成・テーマ生成/承認/却下・記事一覧）を実装。note 公開はアシスト手動（Phase 2）。売上手入力。
- **Phase 2（一部実装済み・2026-09-15）**: note 公開オートメーション（`pipeline.note.publish`/`note.publish.dispatch`/`note.publish.status.sync`、§7）＋マルチアカウント別セッション（`note_accounts.session_state_enc`、移行/取込スクリプト）を実装。**未実装・要フォロー**: 有料記事の価格/有料ライン設定 UI 自動化（note の KYC 要件により本人確認完了後に追加実装が必要、§2.1 参照）、認証リレー(`note_auth_requests`＋LINE)、売上スクレイプ(`note.sales.fetch`)、価格自動決定(F-ANP-16)。
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
3. note の実挙動（ログイン/エディタ/価格設定/公開のセレクタ・再認証ルール）を実装時に本ドキュメント §2/§7 へ追記（CLAUDE.md ルール #8）。— **Phase 2 で公開エディタ/公開設定画面/ハッシュタグ/有料選択のセレクタまで採取・実装済み**（§2.1）。価格入力欄/有料ラインの具体的な UI（KYC 完了後にのみ到達可能）は次項で継続。
4. 本番: Railway に ANP サービス追加＋`anp.m2p.tools`＋`NEXT_PUBLIC_TOOL_ANP_URL` を portal に設定（`docs/10` の SSO 手順を流用）。— **完了**（`anp.m2p.tools` 稼働中、Railway サービス名 `ANP`）。
5. **[Phase 1 実装で新規発見]** `eval_results` は `book_id` NOT NULL FK のため ANP では使えない（§6 参照）。Phase 2 で判定内訳の永続化が要件化する場合、専用 `note_eval_results` テーブルの新設を検討すること。
6. **[Phase 1 未実装・要フォロー]** `pipeline.note.judge` の再試行後 (`retry_count>=1` で不合格) の `status='needs_human_review'` は UI 側での「要確認」一覧・再実行導線が未実装（`/accounts/[id]` の記事一覧にステータス表示のみ）。Phase 2 でも未対応のまま継続（`publishArticle` は `needs_human_review` からも起動可にしたので手動公開は可能）。
7. **[Phase 1 実装メモ・解消済]** `apps/anp/package.json` に `@a2p/contracts`・`graphile-worker` を追加。ワークスペースリンクは `pnpm exec` 実行時に自動反映され、`pnpm --filter @anp/web exec tsc --noEmit` で clean を確認済み（`pnpm-lock.yaml` にも反映済み）。
8. **[Phase 2 新規発見・最重要]** note は**有料記事を初めて設定する際に「本人情報の登録」(KYC: 個人/法人・氏名・住所等)モーダルを要求**する。未登録アカウントでは `pipeline.note.publish` が `blocked: kyc_required` を返し、有料記事は公開設定画面から先に進めない（§2.1）。**運営中の各 note アカウントで一度は運営者が手動で本人情報登録を完了させる必要がある**（自動化不可・法令/決済上の要件のため意図的に人手を挟む設計が妥当）。完了後、価格/有料ライン入力欄のセレクタを追加の dry-run 偵察で採取し、`apps/worker/src/tasks/note-publish/playwright-note-publish-port.ts` の `selectPaidAndCheckKyc` 以降(価格設定 TODO コメント箇所)を実装すること。
9. **[Phase 2 実装メモ]** 初回アカウント `note-acc-1`(display_name「AI副業ラボ」)を本番 DB に作成し、Phase 1 の暫定共有セッションを `note-session-migrate.sh` で移行済み。実装検証のため dry-run(下書き保存)を計4回実行し(code review 対応での再検証含む)、note 上に検証用下書き記事(`n6845533ebcf7`, `n9c510facf4dc`, `n1d09eea651e3`, `ne071421d3e1d`)が残っている — **運営者が note 管理画面から手動削除すること**（実際の公開は一度も行っていない）。resume 廃止(§7 #4)により今後の再試行でも下書きが積み残るため、定期的な整理を検討すること。
10. **[Phase 2 未確定・要検証]** `resolvePublicUrl` の公開後 URL パターン `note.com/<handle>/n/<noteId>` は §2.1 の想定に基づく実装であり、KYC 未完了のため実際の「投稿する」クリックによる遷移は未検証。運営者が無料記事を 1 本実際に公開して URL パターンと `checkPublished` の 404/非公開判定を確認し、齟齬があれば本節と実装を更新すること。
