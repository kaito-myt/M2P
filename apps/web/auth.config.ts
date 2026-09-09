/**
 * Auth.js v5 設定 (A2P web) — 共通ファクトリ @a2p/auth.buildAuthConfig を利用。
 *
 * middleware.ts は Edge 互換のため **この auth.config.ts のみ** を import する。
 * providers は apps/web/auth.ts で Credentials Provider を足して Node ランタイムで動かす。
 *
 * 公開パス（未認証で閲覧可）:
 * - `/`          : page.tsx が「未認証→/shop / 認証済→/dashboard」に振り分ける（rootPublic）
 * - `/blog(/*)`  : 販促用の公開ブログ [F-052b]
 * - `/shop(/*)`  : SNS プロフィール導線先の書籍カタログ
 * - `/legal(/*)` : プライバシー/利用規約（外部審査の URL 提出用）
 *
 * SSO: `AUTH_COOKIE_DOMAIN`（例 `.example.com`）を全アプリで揃えると、ポータルの
 * ログインセッションを A2P が同一 cookie で共有する（再ログイン不要）。
 */
// Edge 互換: bcrypt を含む auth-service を巻き込まないよう、config サブパスから直接 import する。
import type { NextAuthConfig } from 'next-auth';
import { buildAuthConfig } from '@a2p/auth/config';

export const authConfig: NextAuthConfig = buildAuthConfig({
  publicPathPrefixes: ['/blog', '/shop', '/legal'],
  rootPublic: true,
  signedInRedirect: '/',
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
});
