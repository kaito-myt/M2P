/**
 * Header — A2P (`apps/web/components/layout/header.tsx`) と同構造 (docs/11-anp-design.md §5.1)。
 * 高さ 64px・`bg-cream-light`・下端に `border-warm` 1px。A2P 固有の CostMeter/AlertBadge/
 * CommentBadge は持ち込まない (ANP に対応する計器が無いため)。
 */
import Link from 'next/link';
import Image from 'next/image';
import { LayoutGrid } from 'lucide-react';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import { MobileNav } from './mobile-nav';
import { UserMenu } from './user-menu';

/** M2P ポータル（ツール選択画面）の URL。未設定なら導線は非表示（壊れたリンクを出さない）。 */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ||
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:3002' : '');

export async function Header() {
  const session = await auth();
  const username = session?.user?.username ?? session?.user?.name ?? undefined;

  return (
    <header className="z-10 flex h-16 shrink-0 items-center gap-space-relaxed border-b border-border-warm bg-cream-light px-space-relaxed md:px-space-loose">
      <MobileNav />
      <Link
        href="/"
        aria-label={messages.brand.appName}
        className="flex shrink-0 items-center gap-2 no-underline"
      >
        {/* ワードマーク (2026-09-21 運営者支給ロゴ、1200x437)。狭幅では正方形マーク (anp-mark.png) に切替。 */}
        <Image
          src="/anp-mark.png"
          alt={messages.brand.appName}
          width={36}
          height={36}
          priority
          className="h-9 w-9 rounded-card border border-border-warm bg-white object-contain p-0.5 sm:hidden"
        />
        <Image
          src="/anp-logo.png"
          alt={messages.brand.appName}
          width={99}
          height={36}
          priority
          className="hidden h-9 w-auto object-contain sm:block"
        />
      </Link>

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
        <UserMenu username={username} />
      </div>
    </header>
  );
}
