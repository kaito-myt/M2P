---
name: reference_storefront_seo_favicon
description: 栞ストアフロントのSEO/favicon構成＋public/icon.pngがapp/icon.pngを影で上書きするNext.js罠
metadata: 
  node_type: memory
  type: reference
  originSessionId: 564e49b2-c0dd-4b00-9636-c3a000b835f6
  modified: 2026-08-27T04:56:35.610Z
---

apps/web は1ドメイン `a2p.m2p.tools` に **公開ストアフロント(栞)** と **A2P管理ツール** が同居する。ルート `/` は認証状態で振り分け（未認証→`/shop`、運営者(認証済)→`/dashboard`）。

**SEO方針（F-052b/F-092）**: 検索結果を「リダイレクトするルート」でなく本棚 `/shop`・レビュー `/blog` 自体に向けるため、各ページに **self-canonical** (`alternates.canonical`) を付与し、`sitemap.ts` からルート `/` を除外（`/shop` priority1, `/blog` 0.9）。robots は `/dashboard`・`/api/`・`/login` を disallow。metadataBase はルート layout に設定。

**⚠️ Next.js の罠（実際にハマった）**: `apps/web/public/icon.png` のような **public/ 配下の静的ファイルは `app/icon.png`(メタデータ規約)と同じ `/icon.png` を取り合い、public/ 側が実バイトを上書き**する。app/icon.png を差し替えても `<link rel=icon>` タグは更新されるのに **実体は古い public/icon.png のまま**（＝favicon が変わらない）。対処＝ **public/icon.png を削除**して app/icon.png を唯一のソースにする。また **route group `app/(app)/icon.png` は URL 透過なので `/icon.png` に化けて衝突**する（route groupでadmin専用faviconは作れない）。

**favicon 方針（運営者指示: 栞にするのはブログ側だけ、ツールはA2Pのまま）**: ルート/既定 `app/icon.png` = **A2Pロゴ**(256px, ツール/dashboard/legal が継承)。`/blog`・`/shop` セグメントだけ `app/blog/icon.png`・`app/shop/icon.png` = **栞**(512px)。ドメイン全体を栞にすると管理ツールのタブも栞になり不可。検索/タブ表示はGoogleのfaviconキャッシュ更新（数日〜数週）待ち。

**サブドメイン化（栞専用ドメイン, 2026-08-27着手）**: 栞ストアフロントを `shiori.m2p.tools` で提供。同一 A2P web サービスに相乗り。
- 実装済(コード): `app/page.tsx` が host=STOREFRONT_HOSTS(既定 `shiori.m2p.tools`)ならルート`/`→`/blog`へ（認証問わず）。`lib/site.ts` の `STOREFRONT_URL`(=`NEXT_PUBLIC_STOREFRONT_URL`||`NEXT_PUBLIC_SITE_URL`)を /blog /shop /blog/[slug] の canonical と sitemap/robots に使用。
- **運営者作業(未)**: ① Railway → A2P サービス → Settings → Networking → Custom Domain に `shiori.m2p.tools` 追加（Railwayが証明書発行＋CNAME先を提示。A2Pの現行 target は `fejfqglp.up.railway.app`）。② Cloudflare(m2p.tools) に CNAME `shiori`→その target（a2p/anpと同設定）。③ 解決確認後に A2P へ env `NEXT_PUBLIC_STOREFRONT_URL=https://shiori.m2p.tools` を設定＆再デプロイ→canonical/sitemapが栞ドメインへ。**DNS解決前にenv設定するとcanonicalが死URLになりGoogleが索引を落とすので順番厳守**。
関連: [[project_blog_covers]], [[project_home_dashboard]], [[project_platform_portal]]。
