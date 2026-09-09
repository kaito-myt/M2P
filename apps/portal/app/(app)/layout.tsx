/**
 * ポータル認証エリアの共通シェル。左サイドの常設メニューバー（将来の経営ダッシュボード等）
 * ＋モバイル用トップバーを提供する。各ページは <main> の中身だけを描画すればよい。
 */
import { auth } from '@/auth';
import { logout } from '@/app/actions';
import { NavLinks } from '@/components/nav-links';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl border border-white/10 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/m2p-logo.png" alt="M2P" className="h-full w-full object-contain p-0.5" />
      </span>
      {!compact && (
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-white">
            M<span className="brand-gradient">2</span>P
          </div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
            Money-Making Platform
          </div>
        </div>
      )}
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const username = session?.user?.username ?? session?.user?.name ?? '';
  const initial = (username.slice(0, 1) || 'M').toUpperCase();

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* ===== サイドメニュー（lg+） ===== */}
      <aside className="sticky top-0 hidden h-screen w-[252px] shrink-0 flex-col border-r border-white/[0.07] px-4 py-6 lg:flex">
        <div className="px-2">
          <Brand />
        </div>

        <nav className="mt-9 flex-1 px-0">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/30">
            メニュー
          </p>
          <NavLinks />
        </nav>

        <div className="mt-4 border-t border-white/[0.07] pt-4">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] font-semibold text-white/80">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-white/85">{username || 'ゲスト'}</div>
              <div className="text-[11px] text-white/35">サインイン中</div>
            </div>
          </div>
          <form action={logout} className="mt-2">
            <button type="submit" className="btn-ghost w-full rounded-xl px-3 py-2 text-[13px] font-medium">
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      {/* ===== メイン ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* モバイルトップバー */}
        <div className="border-b border-white/[0.07] px-5 py-4 lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Brand compact />
            <form action={logout}>
              <button type="submit" className="btn-ghost rounded-full px-3.5 py-1.5 text-[12.5px] font-medium">
                ログアウト
              </button>
            </form>
          </div>
          <nav className="mt-3">
            <NavLinks orientation="horizontal" />
          </nav>
        </div>

        <main className="flex-1 px-6 py-8 sm:px-8 lg:px-12 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
