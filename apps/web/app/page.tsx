/**
 * `/` ルート — ホスト＆認証状態で振り分け。
 *
 * - 栞ストアフロント専用ホスト(例 shiori.m2p.tools): 認証に関わらずブックレビュー /blog へ。
 *   → 独自ブランドの入口。運営者がログイン済でもツールでなく公開サイトを見せる。
 * - それ以外(a2p.m2p.tools 等):
 *   - 認証済み(運営者): S-002 ダッシュボードへ。
 *   - 未認証(外部訪問者・審査レビュアー等): 公開サイト /shop へ。
 *     → ドメイン直打ちがログイン画面に落ちず「作り込まれた公開サイト」を提示できる
 *       (TikTok 等の外部審査要件対応)。
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

/** 栞ストアフロント専用ホスト（カンマ区切りで複数可、既定 shiori.m2p.tools）。 */
const STOREFRONT_HOSTS = (process.env.STOREFRONT_HOSTS ?? 'shiori.m2p.tools')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export default async function HomePage(): Promise<never> {
  const host = (await headers()).get('host')?.split(':')[0]?.toLowerCase() ?? '';
  if (STOREFRONT_HOSTS.includes(host)) redirect('/blog');

  const session = await auth();
  redirect(session?.user ? '/dashboard' : '/shop');
}
