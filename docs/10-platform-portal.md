# 10. M2P プラットフォーム・ポータル設計（ツール選択＋SSO）

> **プラットフォーム名: M2P（Money-Making Platform）**（2026-08-20 命名）。A2P はその第1ツール。
> フォルダ/リポジトリは `M2P`（旧 `A2P`）にリネーム。ポータルパッケージは `@m2p/portal`。
> A2P ツール固有のパッケージ（`@a2p/web` `@a2p/worker` `@a2p/agents` 等）は `@a2p/*` のまま。

> 位置づけ: A2P は「複数ツールを束ねるプラットフォーム構想」の**第1ツール**にすぎない。
> 本ドキュメントは、A2P のログインの**上位**に「ツール選択画面（ハブ）」を置き、今後ツールを
> 増やしていくための土台（`apps/portal` ＋ 共有認証 `packages/auth` ＋ SSO）を定義する。
> 導入日: 2026-08-20。CLAUDE.md rule #3（新トップレベル概念は docs 先行）に基づく。

## 10.1 なぜ / ゴール

- 運営者は将来、A2P 以外のツール（note 記事自動化 等）も同じ基盤で増やしたい。
- そのため **ハブ（ツール選択画面）** を用意し、**1回のログインで全ツールへ**入れるようにする（SSO）。
- 単一運営者前提は不変（CLAUDE.md hard rule #1）。マルチテナントは導入しない。ハブは
  「1人の運営者が複数ツールを切り替える入口」であって、組織/テナントの概念ではない。

## 10.2 リポジトリ構成（親フォルダへは移動しない）

このリポジトリは既に pnpm モノレポ（`apps/*` ＋ 共有 `packages/*`）であり、
**複数ツール＋共有基盤を載せる器そのもの**。したがって親フォルダへ移す（＝モノレポの入れ子）
必要はなく、**この repo 自体をプラットフォームと捉え直し**、ポータルを1アプリとして足す。

```
M2P/ (旧 A2P。C:\DEV\M2P にリネーム — 構造とは無関係の見た目上の変更)
  apps/
    portal/   ← 新規 @m2p/portal: 共通ログイン + ツール選択（ハブ）。port 3002
    web/      ← A2P（現状のまま）。port 3001
    worker/   ← A2P worker
  packages/
    auth/     ← 新規: 共有認証（buildAuthConfig + 認証コアロジック）＝SSO の要
    ui/ db/ contracts/ crypto/ …  ← 全ツール共有
```

- 却下案: 親フォルダ（`C:\DEV`）を新ワークスペースルートにする → 既存モノレポの入れ子になり
  pnpm workspace が噛み合わず設定が複雑化。得るものが無いため却下。
- 却下案: portal を完全別リポジトリ → 共有 packages を使えず UI/認証を二重管理、SSO も困難。却下。
- フォルダ/リポジトリ名の "A2P → <platform>" リネームは**任意・後回し可**（構造とは独立の見た目の問題）。

## 10.3 認証（SSO）設計

Auth.js v5（JWT セッション）を全アプリで共有する。SSO の成立条件は次の2点のみ:

1. **同一シークレット**: 全アプリで `AUTH_SECRET`（= `NEXTAUTH_SECRET`）を揃える → JWT を相互検証可能。
2. **同一 session cookie（名＋ドメイン）**: cookie 名を明示固定し、`AUTH_COOKIE_DOMAIN`（例
   `.example.com`）を全アプリで揃える → ポータルが発行した cookie を各ツールが読める。

### 共有パッケージ `@a2p/auth`（`packages/auth`）

- `buildAuthConfig({ publicPathPrefixes, rootPublic, signedInRedirect, cookieDomain, useSecureCookies })`
  → Auth.js v5 の `NextAuthConfig` を生成するファクトリ。session=jwt/30日、`authorized` コールバック
  （公開パス以外は未認証で `/login` へ）、`jwt`/`session` コールバック（`id`/`username` 付与）、
  **cookie 名の明示固定＋ドメイン設定**を含む。**bcrypt を含まず Edge 互換**。
  - サブパス `@a2p/auth/config` で公開。middleware（Edge Runtime）はこのサブパスのみ import する
    こと（バレル `@a2p/auth` を import すると bcrypt が Edge バンドルに混入し警告＋肥大化する）。
- `authorizeWithPrisma` / `verifyCredentialsAndUpdateCounters`（`auth-service.ts`）
  → Credentials 検証コア（bcrypt 照合＋5回失敗15分ロック[F-043]）。**Node ランタイム専用**。
    各アプリの `auth.ts`（Credentials Provider）から使う。バレル `@a2p/auth` で公開。
- 同一 `users` 表（`@a2p/db`）を全ツールが照合 → アカウントは1つ。

### 各アプリの配線

| ファイル | 役割 | import 元 |
|---|---|---|
| `auth.config.ts` | Edge 互換 config（middleware が使う） | `@a2p/auth/config`（bcrypt 非依存） |
| `auth.ts` | Credentials Provider（Node） | `@a2p/auth`（authorizeWithPrisma） |
| `middleware.ts` | 認可 redirect | `./auth.config` のみ |

- A2P(`apps/web`) は既存挙動を維持（公開パス `/`,`/blog`,`/shop`,`/legal`）。実装を共通ファクトリへ
  差し替えただけ（`buildAuthConfig({ publicPathPrefixes:['/blog','/shop','/legal'], rootPublic:true })`）。
- ポータル(`apps/portal`) は `/`（ツール選択）を認証必須、公開は `/login` のみ。

### 遷移フロー

```
[portal] /login で1回ログイン
   ↓（AUTH_COOKIE_DOMAIN 配下に session cookie 発行）
[portal] / ツール選択（認証済）
   ↓ ツールのカードをクリック（外部 URL 遷移）
[A2P] 同一 cookie を検証 → 素通り（再ログイン不要）
```

- ローカル開発では cookie ドメインを跨げない（portal=:3002 / web=:3001 は別オリジン扱い）ため、
  完全な SSO 素通りは**本番（同一親ドメイン + `AUTH_COOKIE_DOMAIN` 設定）で成立**する。ローカルでは
  各アプリで個別にログインして確認する。

## 10.4 ツールレジストリ

- `apps/portal/lib/tools.ts` の `getTools()` が唯一の登録簿。ツール追加は配列に1件足すだけ。
- 各ツールの URL は環境変数で差し替え（本番=独自ドメイン、ローカル=各 dev ポート）。
  - A2P: `NEXT_PUBLIC_TOOL_A2P_URL`（未設定時 `http://localhost:3001`）。
- `status: 'coming_soon'`（or URL 未設定）は「準備中」バッジでカード無効表示。

## 10.4b 設定（API キーの一元管理）— 2026-09-21 追加

運営者要望「各サービサーの API キー情報を管理できるようにして」「API 管理は全部 M2P 側に集約しよう」への対応。
A2P / ANP / worker は同じ DB（`api_credentials`）を共有し、各プロセスは `@a2p/agents/lib/get-api-key`
（DB 優先 → env フォールバック、60 秒 LRU）で読むため、ポータルで保存すれば 1 分以内に全ツールへ反映される。
**AI モデルの割当はポータルに持たせない**（運営者判断: 役割がツールごとに異なる。A2P `/settings/models`、
ANP `/settings` の「AI モデル設定」で各ツールが扱う。ハブ画面から各ツールへのリンクのみ）。

- 画面: `/settings`（ハブ: 設定済みキー数・環境変数のみのキー・各ツールのモデル設定へのリンク）、`/settings/api-keys`。
  サイドメニュー「設定」を有効化（`components/nav-links.tsx`）。
- **API キー** (`app/(app)/settings/api-keys`): Anthropic / OpenAI / Google / Tavily の 4 サービサー。
  `@a2p/crypto.encryptApiKey`（`API_CRED_KEY`、A2P と同じ鍵 → **M2P-Portal サービスにも同じ `API_CRED_KEY` を設定済み**）で
  暗号化して `api_credentials` に upsert、`key_mask` だけ表示。疎通テストは各社の models 一覧 API（Tavily は最小検索）を
  fetch で叩く（apps/web と同じエンドポイント）。削除は `delete`。全て `audit_log`（`api_credential.set/revoke`、
  `after_json.source='portal'`）に記録。
- **環境変数にて設定済み**: ポータル自身の env（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
  `GOOGLE_GENERATIVE_AI_API_KEY` / `TAVILY_API_KEY`、`lib/settings-core.ts` `API_PROVIDER_ENV`）に値があり DB 未登録の
  サービサーは「環境変数にて設定済み」と表示し、「環境変数のキーを DB に取り込む」（`importApiKeyFromEnv`）で
  `api_credentials` へ移せる（取り込み後は DB が優先されるので worker/web の env は削除してよい）。表示のために
  worker と同じ 3 つの env を M2P-Portal にも設定した（2026-09-21）。
- **A2P 側**: `/settings` の API キーフォーム（`api-credentials-list.tsx`）は画面から外し、状態表示＋
  「M2P で API キーを管理する」リンク（`api-credentials-portal-notice.tsx`、`NEXT_PUBLIC_PORTAL_URL`）に置き換えた。
  Server Action 本体は残置。
- Server Action は `app/actions/settings.ts`。純関数（provider メタ・テスト用リクエスト・env 判定）は
  `lib/settings-core.ts`（Vitest `lib/__tests__/settings-core.test.ts`）。

### 10.4b-2 サービス連携（R2 / LINE / Amazon Ads）の接続情報 — 2026-09-21 追加

運営者要望「R2 の API 情報も M2P で管理できるようにしましょうか。モデル管理じゃなくて API 管理として、API 関連は
全部そこで管理できるようにしましょう」への対応。画面名を「API 管理」に改め、同じ `/settings/api-keys` の下段に
**サービス連携** セクションを追加した。

- **共通パッケージ `packages/credentials`（`@a2p/credentials`）**:
  - `spec.ts`（DB 非依存の正本）: `SERVICE_PROVIDERS = ['r2','line','amazon_ads']`、各プロバイダの項目仕様
    `SERVICE_PROVIDER_META[p].fields = { key, env, label, secret, required, hint?, options? }`
    （r2: account_id / access_key_id / secret_access_key / bucket、line: channel_access_token / channel_secret(任意) /
    allowed_user_id、amazon_ads: client_id / client_secret / refresh_token / profile_id / region）、
    入力スキーマ `serviceFieldsSchema(p)`、env からの組立 `serviceFieldsFromEnv(p)`、マスク
    `maskServiceFields` / 要約 `summarizeServiceFields`、既存値マージ `mergeServiceFields`（秘密項目の空欄＝変更なし）。
  - `store.ts`: **同じ `api_credentials` テーブル**に `provider='r2'|'line'|'amazon_ads'`、`key_enc` = 項目 JSON を
    `encryptApiKey`（`API_CRED_KEY`）で暗号化、`key_mask` = 要約文字列。`resolveServiceCredentials(p)`（DB 優先 →
    env フォールバック、復号失敗は throw、DB 障害は env へ、60 秒 TTL キャッシュ）と型付き
    `resolveR2Credentials` / `resolveLineCredentials` / `resolveAmazonAdsCredentials`、同期参照 `peekLineCredentials`
    （worker の `isLineRelayConfigured()` 用）、`invalidateServiceCredentialCache`。
  - `test.ts`: 疎通テスト `testServiceCredentials(p, fields)` — r2: HeadBucket（`@a2p/storage.testR2Connection`）、
    line: `GET /v2/bot/info`（bot 名を表示）、amazon_ads: LwA refresh → `/v2/profiles` で profile_id の存在確認。
  - `register.ts`: `installServiceCredentialProviders()` が `@a2p/storage.setR2ConfigProvider` に DB リゾルバを登録
    （storage は DB 非依存のまま）。`primeServiceCredentials({ refreshMs })` は起動時に全件解決してキャッシュを温め、
    以後周期的に再解決（worker は 65 秒）。
- **各プロセスの配線**: worker `src/index.ts` main（install ＋ prime）、web / anp / portal は `instrumentation.ts`
  `register()`（nodejs ランタイムのみ）。`@a2p/storage/operations` は `getR2Runtime()`（async、DB → env、設定不変なら
  S3Client 再利用）を使う。LINE: worker `tasks/lib/line-auth-relay.ts` の `pushLine` は `resolveLineCredentials` →
  env、`isLineRelayConfigured` は `peekLineCredentials` → env。web `/api/line/webhook` は `resolveLineCredentials` →
  env（channel secret が DB に無ければ env で補う）。Amazon Ads: worker `ads-spend-fetch.ts` は
  `resolveAmazonAdsCredentials` → `adsCredsFromEnv`。
- **env の扱い**: `R2_*` は `packages/contracts/env.ts` で optional 化（DB 設定が優先、env はフォールバック）。
  LINE_* / AMAZON_ADS_* は従来どおり任意。ポータルに「環境変数にて設定済み」を出すため、M2P-Portal にも
  worker と同じ R2_* / LINE_* / AMAZON_ADS_* を設定した（2026-09-21）。
- **UI** (`service-credentials-panel.tsx`): プロバイダごとに多項目フォーム（非秘密項目は現在値を表示、秘密項目は
  パスワード入力でマスクをプレースホルダ表示・空欄なら変更なし、region は選択式）、保存 / 環境変数の設定を DB に
  取り込む / 疎通テスト / 削除。Server Action は `setServiceCredentials` / `revokeServiceCredentials` /
  `testServiceCredentials` / `importServiceCredentialsFromEnv`（`audit_log` に `api_credential.set/revoke`）。

## 10.5 デプロイ / 環境変数（Railway）

- ポータルは**新しい Web サービス**として追加（web/worker と別サービス）。
- SSO を本番で成立させるための必須 env（**全アプリ共通で同値**）:
  - `AUTH_SECRET`（=`NEXTAUTH_SECRET`）: 全アプリ同一。
  - `AUTH_COOKIE_DOMAIN`: 例 `.example.com`。portal と各ツールを同一親ドメインのサブドメインに
    配置（例 `app.example.com`=portal, `a2p.example.com`=A2P）。
- ポータル側のみ: `NEXT_PUBLIC_TOOL_A2P_URL`=A2P の本番 URL、`NEXT_PUBLIC_TOOL_ANP_URL`=ANP の本番 URL。
- ポータルの設定画面（§10.4b）には `API_CRED_KEY`（A2P と同値）が必要（2026-09-21 に M2P-Portal へ設定済み）。
- DNS（サブドメイン割当）と各 Railway サービスのカスタムドメイン設定は運営者作業。

## 10.6 現状と残タスク

- 実装済み（2026-08-20）: `packages/auth`、`apps/portal`（login/ツール選択/SSO 配線）、A2P の共通認証化。
  全て typecheck / build 通過。
- 2026-08-22: Railway `M2P-Portal` サービスとして `https://m2p.tools` に本番デプロイ済み（ANP も `tools.ts` に登録済み）。
- 2026-09-21: 設定（API キーの一元管理）を実装（§10.4b）。AI モデル割当は各ツール側。同日、サービス連携
  （R2 / LINE / Amazon Ads）も「API 管理」として一元化（§10.4b-2、`@a2p/credentials`）。
- 残: 経営ダッシュボードの実データ接続（全ツール横断の売上・コスト集計コネクタ）。
