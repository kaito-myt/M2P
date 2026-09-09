'use server';

import { signOut } from '@/auth';

/** ログアウト（ポータルのセッション破棄 → /login へ）。 */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
