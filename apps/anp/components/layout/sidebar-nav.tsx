'use client';

/**
 * SidebarNav — サイドバーのナビ本体 (デスクトップ常駐 aside とモバイルドロワーで共用)。
 * A2P (`apps/web/components/layout/sidebar-nav.tsx`) と同構造。A2P 固有の JobTicker は
 * 持ち込まない (docs/11-anp-design.md §5.1)。`onNavigate` はモバイルドロワーでリンク
 * 押下時に閉じるためのコールバック。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { navSections } from './nav-items';
import { cn } from '@/lib/cn';

/** href が現在パスにマッチするか (完全一致 or サブパス)。ホームは完全一致のみ。 */
function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';

  return (
    <nav className="scrollbar-none flex-1 overflow-y-auto px-3 py-space-loose">
      {navSections.map((section) => (
        <div key={section.key} className="mb-space-relaxed last:mb-0">
          <div className="px-2 pb-1.5 text-caption font-medium uppercase tracking-wide text-charcoal-40">
            {section.label}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = item.enabled && isActivePath(pathname, item.href);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={onNavigate}
                    className={cn(
                      'block rounded-snug px-2.5 py-1.5 text-button-sm no-underline transition-colors',
                      active
                        ? 'bg-accent-bg font-medium text-accent'
                        : 'text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
