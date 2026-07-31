/**
 * `/` ルート — 認証状態で振り分け。
 *
 * - 認証済み(運営者): S-002 ダッシュボードへ。
 * - 未認証(外部訪問者・審査レビュアー等): 公開サイト /shop へ。
 *   → ドメイン直打ちがログイン画面に落ちず「作り込まれた公開サイト」を提示できる
 *     (TikTok 等の外部審査要件対応)。
 */
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage(): Promise<never> {
  const session = await auth();
  redirect(session?.user ? '/dashboard' : '/shop');
}
