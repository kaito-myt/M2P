'use server';

/**
 * 認証系サーバーアクション。
 * ログアウト導線がこれまでUIに存在しなかったため追加（ヘッダーのユーザーメニューから利用）。
 */
import { signOut } from '@/auth';

/** セッションを破棄してログイン画面へ戻す。 */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' });
}
