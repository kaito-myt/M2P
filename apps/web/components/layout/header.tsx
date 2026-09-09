/**
 * Header — docs/04 §3.2。
 *
 * - 高さ 64px、`bg-cream`、下端に `border-warm` 1px (L1 Bordered §6.3.5)。
 * - 左: A2P ワードマーク
 * - 中央: グローバル検索 placeholder (SP-09 で本実装)
 * - 右: CostMeter / AlertBadge / CommentBadge / 設定 / ユーザーメニュー
 *
 * SP-06/SP-07 で 3 つのバッジに本値が接続される。本タスクではすべて 0 / "—"
 * のプレースホルダ表示で「常に視界に入る」レイアウトだけ確保する。
 */
import Link from 'next/link';
import Image from 'next/image';
import { LayoutGrid } from 'lucide-react';
import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import { CostMeter } from './cost-meter';
import { AlertBadge } from './alert-badge';
import { CommentBadgeHeader } from './comment-badge-header';
import { MobileNav } from './mobile-nav';
import { UserMenu } from './user-menu';

/**
 * M2P ポータル（ツール選択画面）の URL。
 * - 本番: `NEXT_PUBLIC_PORTAL_URL`（apps/portal デプロイ後に設定）。未設定なら導線は非表示（壊れたリンクを出さない）。
 * - ローカル dev: 未設定でも localhost:3002 を既定にして常に導線を出す。
 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : '');

export async function Header() {
  const session = await auth();
  const username = (session?.user as { username?: string } | undefined)?.username;

  return (
    <header className="z-10 flex h-16 shrink-0 items-center gap-space-relaxed border-b border-border-warm bg-cream-light px-space-relaxed md:px-space-loose">
      {/* モバイル: ハンバーガー → ドロワー(md 未満のみ表示) */}
      <MobileNav />
      <Link
        href="/dashboard"
        aria-label={messages.brand.appName}
        className="flex shrink-0 items-center no-underline"
      >
        <Image
          src="/logo-mark.png"
          alt={messages.brand.appName}
          width={600}
          height={200}
          priority
          sizes="150px"
          style={{ height: 40, width: 'auto' }}
        />
      </Link>

      <div className="hidden flex-1 md:block">
        <input
          type="search"
          placeholder={messages.header.searchPlaceholder}
          aria-label={messages.header.searchPlaceholder}
          disabled
          className="w-full max-w-xl rounded-default border border-border-warm bg-cream-light px-3 py-2 text-button-sm text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="ml-auto flex items-center gap-space-snug">
        {PORTAL_URL && (
          <Link
            href={PORTAL_URL}
            aria-label={messages.header.portalTitle}
            title={messages.header.portalTitle}
            className="flex h-8 items-center gap-1.5 rounded-pill border border-border-warm bg-cream-light px-3 text-button-sm font-medium text-charcoal-82 no-underline hover:bg-charcoal-04 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="header-portal-link"
          >
            <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{messages.header.portalLabel}</span>
          </Link>
        )}
        {/* 計器群は狭幅で折返し崩壊するため md 以上でのみ表示（モバイルは各ページで確認できる）。 */}
        <div className="hidden items-center gap-space-snug md:flex">
          <CostMeter />
          <AlertBadge />
          <CommentBadgeHeader />
        </div>
        <Link
          href="/help"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={messages.header.helpLabel}
          title={messages.header.helpLabel}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border-warm bg-cream-light text-button-sm font-medium text-charcoal no-underline hover:bg-charcoal-04 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="header-help-link"
        >
          ?
        </Link>
        <UserMenu username={username} />
      </div>
    </header>
  );
}
