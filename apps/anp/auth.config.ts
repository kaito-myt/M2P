/**
 * Auth.js v5 設定 (portal) — 共通ファクトリ @a2p/auth.buildAuthConfig を利用。
 *
 * ポータルのルート `/`（ツール選択）は認証必須。公開は `/login` のみ。
 * SSO: `AUTH_COOKIE_DOMAIN`（例 `.example.com`）を A2P 等と揃えると、ここでの
 * ログインセッションを各ツールが同一 cookie で共有する（ツール側で再ログイン不要）。
 */
// Edge 互換: bcrypt を含む auth-service を巻き込まないよう、config サブパスから直接 import する。
import type { NextAuthConfig } from 'next-auth';
import { buildAuthConfig } from '@a2p/auth/config';

export const authConfig: NextAuthConfig = buildAuthConfig({
  publicPathPrefixes: [],
  rootPublic: false,
  signedInRedirect: '/',
  cookieDomain: process.env.AUTH_COOKIE_DOMAIN,
});
