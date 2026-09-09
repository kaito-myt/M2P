---
name: project-platform-portal
description: プラットフォーム化 — apps/portal(共通ログイン+ツール選択ハブ)＋packages/auth(共有認証)＋SSO
metadata: 
  node_type: memory
  type: project
  originSessionId: dbaf6a1f-f78c-456b-b7a9-4a5f4fae6ebf
  modified: 2026-08-22T15:01:24.589Z
---

**A2Pは「プラットフォーム構想の第1ツール」**という位置づけに転換(2026-08-20)。A2Pのログイン上位に「ツール選択画面(ハブ)」を置き、今後ツールを増やす土台を構築。**設計=docs/10-platform-portal.md**。

**プラットフォーム名=M2P (Money-Making Platform)** (2026-08-20命名)。ポータルパッケージは`@m2p/portal`、UI表示も「M2P」。A2Pツール固有のパッケージ(@a2p/web,worker,agents等)は`@a2p/*`のまま。**フォルダ C:\DEV\A2P → C:\DEV\M2P リネーム完了(2026-08-20)**。リネーム後は`pnpm install`でnode_modulesシンボリックリンク再構築が必須(切れてpg-types等が解決不能になる)。git/Railwayはパス非依存で影響なし。

**A2P→ポータルの戻り導線(2026-08-20実装)**: A2Pヘッダー右に「M2Pポータル」リンク(LayoutGridアイコン)を追加。URL=`NEXT_PUBLIC_PORTAL_URL`。**本番はまだportal未デプロイのため未設定=リンク非表示**(NODE_ENV=production時、env無しなら壊れリンクを出さない設計)。ローカルdevは既定localhost:3002で常時表示。→**portal本番デプロイ時にA2P(web)サービスへ`NEXT_PUBLIC_PORTAL_URL`を設定すると本番でも点灯する**。

**方針決定(ユーザー選択)**: ①リポジトリ構成=「このモノレポ内に`apps/portal`追加」(親フォルダへは移さない=モノレポ入れ子回避)。既にpnpmモノレポ=複数ツール+共有packagesの器。フォルダ名"A2P→<platform>"リネームは任意・後回し可(構造と無関係)。②認証=**共通ログイン(SSO)**。

**実装済み(typecheck/build全通過)**:
- `packages/auth`(@a2p/auth): `buildAuthConfig()`ファクトリ(Auth.js v5 config, jwt/30日, authorized/jwt/session callback, **cookie名明示固定+AUTH_COOKIE_DOMAIN**)＋認証コア(`authorizeWithPrisma`/`verifyCredentialsAndUpdateCounters`=bcrypt照合+5回失敗15分ロック[F-043])。
  - **重要**: `buildAuthConfig`はサブパス`@a2p/auth/config`で公開(bcrypt非依存/Edge互換)。middleware・auth.config.tsは必ず`@a2p/auth/config`からimport(バレル`@a2p/auth`だとbcryptがEdgeバンドルに混入し警告+肥大化)。認証コアはバレル`@a2p/auth`でNode専用。
- `apps/portal`(@a2p/portal, port3002): auth.config/auth/middleware/api route、`/login`(自己完結フォーム)、`/`=ツール選択(認証必須)。ツールレジストリ=`lib/tools.ts` `getTools()`(追加は配列1件)。A2P URL=`NEXT_PUBLIC_TOOL_A2P_URL`(既定localhost:3001)。
- A2P(apps/web)を共通認証化: auth.config.tsを`buildAuthConfig({publicPathPrefixes:['/blog','/shop','/legal'],rootPublic:true})`に、lib/auth-service.tsは`@a2p/auth`再エクスポート。挙動維持。

**SSO成立条件(2点のみ)**: 全アプリで①`AUTH_SECRET`(=NEXTAUTH_SECRET)同値、②`AUTH_COOKIE_DOMAIN`(例`.example.com`)同値+同一親ドメインのサブドメイン配置。→ローカルは別オリジンで跨げない=各自ログイン、**SSO素通りは本番のみ**。

**本番SSOカットオーバー完了(2026-08-21)**: 3ツール全て独自ドメイン＋共有cookieで稼働。**m2p.tools(portal)／a2p.m2p.tools(A2P)／anp.m2p.tools(ANP)** すべて証明書VALID・HTTPS 307→/login 応答OK。
- **SSL停滞の根本原因＝TXT所有権レコード欠落**(RailwayサポートQ&Aで判明)。RailwayカスタムドメインはCNAMEに加え **`_railway-verify[.sub]` host の TXT `railway-verify=<token>`** が必須。tokenは GraphQL `customDomain{status{verificationDnsHost verificationToken}}` で取得。TXT追加で即 verified=true→cert発行(数分でVALID)。CNAME/CAA/グレー雲が完璧でもTXT無しだと VALIDATING_OWNERSHIP で無限停滞するのが真因(発行遅延ではなかった)。
- **最終env**: 3アプリとも NEXTAUTH_SECRET同値(sha256[0:16]=448a7bdd47d980e9で照合済)・`AUTH_COOKIE_DOMAIN=.m2p.tools`・NEXTAUTH_URL=各独自ドメイン・NEXT_PUBLIC_PORTAL_URL=https://m2p.tools。portalの NEXT_PUBLIC_TOOL_A2P_URL=https://a2p.m2p.tools／NEXT_PUBLIC_TOOL_ANP_URL=https://anp.m2p.tools。**NEXT_PUBLIC_*はビルド時インライン化されるので env変更後は必ず `railway up`(フルビルド)再デプロイ**(redeployでは反映されない)。
- **ANPカスタムドメイン**: id 2ad14fd3、CNAME先 c2q0z32h.up.railway.app、TXT host `_railway-verify.anp`。a2p.m2p.tools は再登録でCNAME先が fejfqglp.up.railway.app(TXT host `_railway-verify.a2p`)。cookie名は3アプリ共通 `__Secure-authjs.session-token`(csrf/callback-urlは__Host-/__Secureで各ホスト固有=SSOには無関係、session-tokenだけDomain=.m2p.tools付与でSSO成立)。
- **未実施の最終確認**: 実クレデンシャルでのブラウザ素通りテスト(m2p.toolsで1回ログイン→A2P/ANPタイル→再ログインなし)。設定・コードは全条件充足を確認済だが、実ログインはパスワード必要のためユーザー手動クリック検証待ち。

**Railway操作メモ**: GraphQLは `https://backboard.railway.app/graphql/v2` に **`Project-Access-Token: $RAILWAY_TOKEN`** ヘッダ(Bearerは不可)。project=c4001a55、本番env=4f8f4624、web(A2P)=90eb3b41、worker=2e80c6d5、portal=46820ff5。サービス作成=`serviceCreate`、ビルド/起動=`serviceInstanceUpdate`、ドメイン=`customDomainCreate`(projectId必須・DNS/cert状況を返す)。CLI `railway variable delete`に--skip-deploys/--yesは無い。**.env.localは絶対パスで読む**(cwdがapps/webだと読めずtoken空)。

**ポータルUI全面刷新(2026-08-22)**: ダサい淡色フラット→**プレミアムなダーク"管制室"ルック**に刷新・本番反映済。
- テーマ=`apps/portal/app/globals.css`をportal専用ダーク化(bg #07080c＋violet/emerald/goldの放射グラデ"オーロラ"＋微ノイズ)。再利用クラス=`.glass`(ガラスパネル)・`.brand-gradient`(M2Pグラデ文字)・`.tool-card`(ホバーで浮遊＋accent色グロー、color-mix使用)・`.btn-primary/.btn-ghost/.field`・`.live-dot`(パルス)・`.fade-up`。prefers-reduced-motion対応。※webトークンには非干渉。
- **常設メニューバー新設**(ユーザー要望=将来の全体売上/コスト表示に備え): `app/(app)/layout.tsx`シェル(左サイドナビ lg+／モバイルは上部横スクロール)＋`components/nav-links.tsx`(client, usePathnameでactive)。項目=ツール(/ ライブ)・**経営ダッシュボード(/dashboard 雛形=全ツール横断P&Lプレビュー、集計コネクタ未実装)**・設定(準備中/無効)。ハブは`app/(app)/page.tsx`へ移設(ヒーロー＋ツールグリッド、旧トップバー廃止)。
- **公式ロゴ/ファビコン設定**: `apps/portal/public/m2p-logo.png`(チャコール＋エメラルドMP↑ロックアップ、830KB)＝ログイン中央/サイドバー/dashboardで白タイル表示。`app/favicon.ico`(94KB, 16/32/48)=portal・ANP両方に配置。tool-cardのaccentはダーク映えにA2P=#f59e0b(amber)・ANP=#2dd4bf(teal)へ変更。
- 検証: m2p.tools/login=200・/と/dashboardは未ログイン307→login・favicon/logo資産200。tsc/build通過。

**⚠️ ダーク化は撤回(2026-08-22 同日)**: ユーザー意図は「ダーク化」ではなく「元の明るいベースのまま全体を洗練」だった。ダーク変更は全て巻き戻し済(tokens.ts/globals.cssはHEADへ復帰、混在WIPファイルは外科的に色クラスのみ逆変換、ヘッダーはロゴ画像に復元)。**新方針=エディトリアル/機能美**: 明るいベース維持＋(1)アクセントを indigo→**vermilion #b23a1e(朱)1色**へ(tokens.ts/globals.css、青紫アクセント禁止のため)、(2)表示用セリフ**Fraunces**を`--font-display`/`font-display`で追加(数値ヒーロー・大見出しのみ。Inter/Roboto一辺倒回避)、(3)**ホームS-002(/dashboard)を再設計**=カード囲み全廃→余白＋極細ヘアライン＋文字サイズ強弱で階層化、装飾バッジ/pill廃止、マストヘッド＋当月純利益ヒーロー(巨大セリフ数字)＋補助4指標(縦罫区切り)＋要対応リストを上位に。docs/04 §6.3.1のダーク追記も要修正(未)。**禁止事項(ユーザー指定)**: 紫/青グラデ・定番アクセント、角丸多用・全部カード囲み、過剰シャドウ/アニメ/装飾バッジ、Inter/Roboto頼りの単調タイポ。**本番は今ダークのまま(要 railway up で明るい版を再デプロイ)**。ホーム以外への横展開は未(ホーム承認後)。

---以下は撤回済の旧ダーク記録(参考)---
**A2P(apps/web)もポータルと同じダークデザインに刷新(2026-08-22)**: 手法=`packages/ui/src/tokens.ts`の色トークン**値だけ**をダーク化(名前cream/charcoal/border-warm据え置き→`bg-cream`/`text-charcoal`等を使う全画面が一括ダーク化。warm→cool と同じ実績手法)。`apps/web/app/globals.css`もダーク:root＋body オーロラ＋portal再利用クラス(.glass/.brand-gradient/.btn-primary/.btn-ghost/.field/.live-dot/.fade-up)移植。cream=#0a0c12(canvas)/cream-light=#14161f(elevated面)/charcoal=#f4f6fb(=明色ink。charcoal-NNは同light RGBのalpha段階でtext/bg両立)/accent=#6ee7b7(emerald,ナビactive)/destructive=#ff6b6b等。ヘッダー/サイドバー/ログインはトークンで自動ダーク化＋ロゴが濃紺で沈むためワードマーク"A**2**P"(2=brand-gradient)＋loginはロゴをライトタイル。shadcn primitives(Button/Card/Input/Tabs/Badge)は全部トークン参照で自動ダーク化(Cardをbg-cream-lightへ持ち上げ・secondaryボタンに枠追加)。ハードコード色の尾(status pill `bg-*-100`等46ファイル)は並列サブエージェント5体で`<色>-500/15 bg + <色>-300 text`へ一括変換。モーダルscrim `bg-charcoal/40`→`bg-black/60`・`bg-foreground/charcoal text-white`の不可視文字→`text-cream`修正済。**公開ページ(/blog,/shop,/legal=栞/SHIORIブランド)は独自warm編集ブランドを保持=非対象**(自前hex使用でトークン非依存のため無影響)。typecheck通過。設計docs/04 §6.3.1更新済。**本番デプロイ済(2026-08-22, `railway up`でweb=A2P＋portal両方)**: a2p.m2p.tools/login=200で新ダークマーカー(btn-primary/backdrop blur/--panel/ライトタイルlogo)配信確認。※デプロイは作業ツリー全体(未コミット220ファイル=schema.prisma変更＋他WIP含む)を`railway up`で一括投入(ユーザー承認済)。デプロイ方式=`railway up --service <A2P|M2P-Portal> --environment production --ci`(RAILWAY_TOKEN=.env.local, service名で指定, 作業ツリー丸ごとアップロード)。

**ポータルのツールカードは新タブで開く(target=_blank)**: `apps/portal/components/tool-card.tsx`のライトリンクは既に`target="_blank" rel="noopener noreferrer"`実装済(2026-08-22確認)。本番が同一タブ挙動なら**古いビルドが原因→railway up再デプロイで反映**。

**残タスク**: (1)ユーザーによるブラウザSSO素通り実クリック検証 (2)経営ダッシュボードの実データ化(全ツールDB横断で売上/コスト/純利益を集計するコネクタ) (3)3つ目ツール追加時tools.tsへ登録＋独自ドメイン(CNAME+TXT) (4)A2Pダークテーマ＆ポータル新タブの本番反映(railway up)＋ブラウザ実機の見た目確認。

関連: [[project-line-auth-relay]] [[project-prod-deploy]] [[project-home-dashboard]]
