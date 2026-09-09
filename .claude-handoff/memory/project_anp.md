---
name: project-anp
description: M2P第2ツール ANP (note版A2P) — note記事の出版＋販促をテーマ別マルチアカウントで自動化
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-21T09:56:18.795Z
---

**ANP = Automated Note Publishing Tool**（M2Pの第2ツール、A2Pのnote版）。2026-08-21着手。noteを新たな収益基盤に、**記事の企画→執筆→出版→販促→収益化を自動化**。設計=**docs/11-anp-design.md**。

**最重要前提: note はテーマ別に複数アカウントを持つ**（1アカウント=1ニッチ）。記事生成・価格戦略・販促・収益追跡をすべて`note_accounts`単位で回す（A2Pのaccounts＋org多アカウント販促戦略の延長）。

**note収益モデル3種**: 有料記事(都度課金・無料+続き有料の「ライン」)／メンバーシップ(月額定期)／サポート(投げ銭)。

**設計方針(A2P資産を全面流用)**: apps/anp(新規Next.js)＋共通packages流用(@a2p/auth[SSO]・db・agents・contracts・storage・notify)。runtimeエージェントはMarketer/Writer/Editor/Eyecatch/Judge/PriceOptimizerをroleを`anp.*`名前空間で追加。パイプライン=`pipeline.note.*`(既存worker拡張)。**note公式投稿APIは無い→KDPと同型のPlaywrightアシスト出版＋認証リレー(`note_auth_requests`+LINE webhook)**。売上はnoteダッシュボードスクレイプ(docs/09と同型・self-heal再ログイン)。プロンプトはDB(prompts)が正。token_usage記録必須。

**新規DBモデル**: note_accounts/note_themes/note_articles/note_sales/note_membership_stats/note_auth_requests/note_locks。既存token_usage/prompts/eval_results等はrole名前空間で共用。

**進捗(2026-08-21)**:
- ①設計doc(docs/11)作成。②ポータルにロゴ付きタイル追加(tool-cardをlogo画像対応化)。
- ③**apps/anp スキャフォールド完了**(portal複製ベース。@anp/web・port3003。SSO配線=buildAuthConfig+@a2p/auth/config・middleware・login・ホーム骨格app/page.tsx[実装予定6セクション提示]。型チェック通過)。
- ④**Prisma に note_* 7モデル追加＆本番DBに適用済**(note_accounts/note_themes/note_articles/note_sales/note_membership_stats/note_auth_requests/note_locks)。適用は`prisma migrate diff --from-url <PUBLIC_URL> --to-schema-datamodel`で生成→**note_を含む文だけawk抽出**(既存テーブルのdrift除外が肝)→txでCREATE。schema=packages/db/schema.prisma(migrationsは実SQL無=db push運用)。
- ⑤**ANP本番稼働**=Railwayサービス「ANP」(id 13ea91d3、build/start=`pnpm --filter @anp/web`、一時ドメイン`anp-production-5e61.up.railway.app`、env=DATABASE_URL/NEXTAUTH_SECRET[A2Pからコピー]/NEXTAUTH_URL/NEXT_PUBLIC_PORTAL_URL)。portalに`NEXT_PUBLIC_TOOL_ANP_URL`設定→**タイルがA2Pと横並びでライブ**。

**SSO本番化完了(2026-08-21)**: ANPも独自ドメイン **anp.m2p.tools**(Railwayカスタムドメイン id 2ad14fd3、CNAME先 c2q0z32h.up.railway.app、TXT `_railway-verify.anp`)＋`AUTH_COOKIE_DOMAIN=.m2p.tools`＋NEXTAUTH_URL=https://anp.m2p.tools で稼働・証明書VALID。portalのANPタイルも https://anp.m2p.tools にライブ。A2P/portalと同一cookieで1回ログイン素通り。詳細=[[project-platform-portal]]。

**未着手(次)**: MVP実装=note_accounts管理UI・記事パイプライン(theme→writer→editor→eyecatch→judge→下書き)runtimeエージェント(role `anp.*`)＋worker task `pipeline.note.*`＋seed prompts。現状ホームは実装予定6セクションの骨格のみ。

関連: [[project-platform-portal]] [[project-home-dashboard]] [[reference-pipeline-stuck-books]]
