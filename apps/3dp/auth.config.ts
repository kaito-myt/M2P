/**
 * Auth.js v5 設定 (3DP) — 共通ファクトリ @a2p/auth.buildAuthConfig を利用 (docs/10 §4)。
 *
 * ルート `/`（ホーム）を含め全画面が認証必須。公開は `/login` のみ。
 * SSO: `AUTH_COOKIE_DOMAIN`（例 `.m2p.tools`）をポータル/A2P/ANP と揃えると、
 * ポータルでのログインセッションをそのまま共有する（ツール側で再ログイン不要）。
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
