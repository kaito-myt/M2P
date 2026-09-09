/**
 * Auth.js v5 middleware (Edge ランタイム互換, portal)
 *
 * `/login` 以外を未ログインで叩いたら `/login` へ redirect（auth.config.ts の
 * callbacks.authorized）。重要: ここで auth.ts を import すると Edge に乗らないため
 * auth.config.ts のみを使う。https://authjs.dev/guides/edge-compatibility
 */
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // /api/auth/* / Next 内部 / 静的アセットは除外。
  matcher: ['/((?!api/auth|_next/static|_next/image|.*\\..*).*)'],
};
