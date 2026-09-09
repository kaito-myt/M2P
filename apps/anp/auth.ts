/**
 * Auth.js v5 — Credentials Provider + Prisma (Node ランタイム, portal)。
 *
 * 認証コアは @a2p/auth.authorizeWithPrisma に集約（A2P と同一ロジック・同一 `users` 表）。
 * Edge ランタイム(middleware)からは auth.config.ts のみを import する。
 */
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@a2p/db';
import { authorizeWithPrisma } from '@a2p/auth';
import { authConfig } from './auth.config';

class PortalCredentialsError extends CredentialsSignin {
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        username: { label: 'username', type: 'text' },
        password: { label: 'password', type: 'password' },
      },
      async authorize(rawCredentials) {
        const result = await authorizeWithPrisma(
          {
            username: rawCredentials?.username,
            password: rawCredentials?.password,
          },
          prisma,
        );

        switch (result.kind) {
          case 'ok':
            return { id: result.user.id, username: result.user.username };
          case 'invalid_credentials':
            throw new PortalCredentialsError(`invalid_credentials:${result.remaining}`);
          case 'locked':
            throw new PortalCredentialsError(`locked:${result.unlockAt.toISOString()}`);
          case 'missing_fields':
            throw new PortalCredentialsError('missing_fields');
          default: {
            const _exhaustive: never = result;
            throw _exhaustive;
          }
        }
      },
    }),
  ],
});
