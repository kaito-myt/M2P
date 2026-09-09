/**
 * 認証コアロジック (プラットフォーム共有 / 旧 apps/web/lib/auth-service.ts)
 *
 * Auth.js v5 の Credentials Provider `authorize()` から呼び出される関数を提供する。
 * 副作用 (DB 更新) を含むコアロジックを純関数化し、prisma を DI することで Vitest で
 * mock しやすくしている。ポータル(apps/portal)と各ツール(apps/web…)が同一ロジックで
 * 同一 `users` 表を照合するため、パッケージ化して単一実装に集約した。
 *
 * 仕様:
 * - パスワード誤入力 5 回でロック (15 分) [docs/02 F-043]
 * - ロック中はパスワードが正しくてもログイン不可
 * - 成功時にカウンタとロックをリセット
 * - 不存在ユーザーは存在ユーザーと区別がつかないエラーで返す（列挙攻撃対策）
 */
import bcrypt from 'bcryptjs';
import type { PrismaClient, User } from '@a2p/db';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分

export type VerifyCredentialsResult =
  | { kind: 'ok'; user: { id: string; username: string } }
  | { kind: 'invalid_credentials'; remaining: number }
  | { kind: 'locked'; unlockAt: Date }
  | { kind: 'missing_fields' };

export interface VerifyCredentialsInput {
  username: unknown;
  password: unknown;
}

interface PrismaUserDelegate {
  findUnique(args: { where: { username: string } }): Promise<User | null>;
  update(args: {
    where: { id: string };
    data: { failed_count?: number; locked_until?: Date | null };
  }): Promise<User>;
}

export interface AuthDeps {
  /** prisma.user 互換。テストでは mock を渡す。 */
  userRepo: PrismaUserDelegate;
  /** bcrypt.compare 互換。テストで決定的にするため DI 可能。 */
  compare?: (plain: string, hash: string) => Promise<boolean>;
  /** 現在時刻取得。テストで凍結可能。 */
  now?: () => Date;
}

function deps(d: AuthDeps): Required<AuthDeps> {
  return {
    userRepo: d.userRepo,
    compare: d.compare ?? bcrypt.compare.bind(bcrypt),
    now: d.now ?? (() => new Date()),
  };
}

/**
 * 認証 + 失敗カウンタ・ロック更新を実行する。
 * シングルユーザー運用前提のため failed_count の競合は逐次 update で許容する。
 */
export async function verifyCredentialsAndUpdateCounters(
  input: VerifyCredentialsInput,
  rawDeps: AuthDeps,
): Promise<VerifyCredentialsResult> {
  const { userRepo, compare, now } = deps(rawDeps);

  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!username || !password) {
    return { kind: 'missing_fields' };
  }

  const user = await userRepo.findUnique({ where: { username } });
  if (!user) {
    // 列挙攻撃対策: 不存在ユーザーも存在ユーザーと同じエラー形状で返す。
    return { kind: 'invalid_credentials', remaining: MAX_FAILED_ATTEMPTS };
  }

  const currentTime = now();

  if (user.locked_until && user.locked_until > currentTime) {
    return { kind: 'locked', unlockAt: user.locked_until };
  }

  const passwordOk = await compare(password, user.password_hash);

  if (!passwordOk) {
    const nextFailedCount = user.failed_count + 1;
    if (nextFailedCount >= MAX_FAILED_ATTEMPTS) {
      const unlockAt = new Date(currentTime.getTime() + LOCK_DURATION_MS);
      await userRepo.update({
        where: { id: user.id },
        data: { failed_count: nextFailedCount, locked_until: unlockAt },
      });
      return { kind: 'locked', unlockAt };
    }
    await userRepo.update({
      where: { id: user.id },
      data: { failed_count: nextFailedCount },
    });
    return { kind: 'invalid_credentials', remaining: MAX_FAILED_ATTEMPTS - nextFailedCount };
  }

  // 成功 → カウンタとロックをリセット
  if (user.failed_count !== 0 || user.locked_until !== null) {
    await userRepo.update({
      where: { id: user.id },
      data: { failed_count: 0, locked_until: null },
    });
  }
  return { kind: 'ok', user: { id: user.id, username: user.username } };
}

/**
 * Auth.js v5 の Credentials Provider authorize() から使う薄いアダプタ。
 */
export async function authorizeWithPrisma(
  input: VerifyCredentialsInput,
  prisma: Pick<PrismaClient, 'user'>,
): Promise<VerifyCredentialsResult> {
  return verifyCredentialsAndUpdateCounters(input, { userRepo: prisma.user });
}
