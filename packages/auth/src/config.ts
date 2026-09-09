/**
 * Auth.js v5 共通設定ファクトリ（プラットフォーム全アプリ共有）。
 *
 * ポータル(apps/portal)と各ツール(apps/web…)が **同一シークレット・同一 cookie 名/ドメイン**
 * で JWT セッションを共有することで SSO を実現する（ポータルで1回ログイン→各ツールは
 * 同じ cookie を検証して素通り）。SSO の要は以下2点:
 *   1. 全アプリで同一の `AUTH_SECRET`/`NEXTAUTH_SECRET`（JWT 相互検証）
 *   2. 同一の session cookie 名 + 親ドメイン（`AUTH_COOKIE_DOMAIN=.example.com`）
 *
 * middleware.ts は Edge 互換のためこのファイル(providers 空)のみを import し、
 * 各アプリの auth.ts で Credentials Provider を足して Node ランタイムで動かす。
 * 詳細: https://authjs.dev/guides/edge-compatibility
 */
import type { NextAuthConfig } from 'next-auth';

export interface BuildAuthConfigOptions {
  /** 未認証でも閲覧可のパス（完全一致 or `<prefix>/` 前方一致）。例: ['/blog','/shop','/legal'] */
  publicPathPrefixes?: string[];
  /** ルート `/` を公開するか（既定 false）。A2P は page.tsx 側で振り分けるため true。 */
  rootPublic?: boolean;
  /** ログイン済みで `/login` に来た時のリダイレクト先（既定 '/'）。 */
  signedInRedirect?: string;
  /** SSO 用: session cookie のドメイン（例 '.example.com'）。未指定ならホスト限定。 */
  cookieDomain?: string;
  /** cookie を Secure にするか。既定は NODE_ENV==='production'。 */
  useSecureCookies?: boolean;
}

/**
 * Auth.js v5 の共通 config を組み立てる。providers は各アプリの auth.ts で追加する。
 */
export function buildAuthConfig(options: BuildAuthConfigOptions = {}): NextAuthConfig {
  const {
    publicPathPrefixes = [],
    rootPublic = false,
    signedInRedirect = '/',
    cookieDomain,
    useSecureCookies = process.env.NODE_ENV === 'production',
  } = options;

  // Auth.js v5 既定の session cookie 名を明示的に固定し、全アプリで一致させる（SSO の要）。
  const sessionCookieName = `${useSecureCookies ? '__Secure-' : ''}authjs.session-token`;

  return {
    // リバースプロキシ (Railway 等) 配下で Host ヘッダを信頼する。未設定だと UntrustedHost。
    trustHost: true,
    session: {
      strategy: 'jwt',
      maxAge: 30 * 24 * 60 * 60, // 30 days [F-043]
    },
    pages: {
      signIn: '/login',
    },
    cookies: {
      sessionToken: {
        name: sessionCookieName,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: useSecureCookies,
          ...(cookieDomain ? { domain: cookieDomain } : {}),
        },
      },
    },
    callbacks: {
      /**
       * middleware から呼ばれる認可コールバック。公開パス以外は未認証で false → signIn へ。
       */
      authorized({ auth, request }) {
        const isLoggedIn = Boolean(auth?.user);
        const { pathname } = request.nextUrl;

        if (rootPublic && pathname === '/') return true;

        for (const prefix of publicPathPrefixes) {
          const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
          if (pathname === p || pathname.startsWith(`${p}/`)) return true;
        }

        if (pathname === '/login') {
          if (isLoggedIn) {
            return Response.redirect(new URL(signedInRedirect, request.nextUrl));
          }
          return true;
        }
        return isLoggedIn;
      },
      /** JWT に user.id / user.username を埋め込む。 */
      jwt({ token, user }) {
        if (user) {
          token.id = (user as { id?: string }).id;
          const candidate = (user as { username?: unknown }).username;
          if (typeof candidate === 'string') token.username = candidate;
        }
        return token;
      },
      /** session.user.id / username を露出する。型拡張は各アプリ側の next-auth.d.ts が持つため、
       *  パッケージ内では拡張に依存せずキャストで代入する。 */
      session({ session, token }) {
        if (session.user) {
          const u = session.user as { id?: string; username?: string };
          if (typeof token.id === 'string') u.id = token.id;
          if (typeof token.username === 'string') u.username = token.username;
        }
        return session;
      },
    },
    providers: [], // 実 provider は各アプリの auth.ts で追加
  };
}
