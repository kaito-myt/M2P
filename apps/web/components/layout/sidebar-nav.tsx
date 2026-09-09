'use client';

/**
 * SidebarNav — サイドバーのナビ本体（デスクトップ常駐 aside とモバイルドロワーで共用）。
 * docs/04 §3.3。`onNavigate` はモバイルドロワーでリンク押下時に閉じるためのコールバック。
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { navSections } from './nav-items';
import { JobTicker } from './job-ticker';
import { messages } from '@/lib/messages';
import { cn } from '@/lib/cn';

/** href が現在パスにマッチするか (完全一致 or サブパス)。ダッシュボードは完全一致のみ。 */
function isActivePath(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';

  return (
    <>
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
                    {item.enabled ? (
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        onClick={onNavigate}
                        {...(item.external
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                        className={cn(
                          'block rounded-snug px-2.5 py-1.5 text-button-sm no-underline transition-colors',
                          active
                            ? 'bg-accent-bg font-medium text-accent'
                            : 'text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal',
                        )}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span
                        aria-disabled="true"
                        title={messages.nav.notImplemented}
                        className="block cursor-not-allowed rounded-snug px-2.5 py-1.5 text-button-sm text-charcoal-40"
                      >
                        {item.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-border-warm px-3 py-space-snug">
        <JobTicker />
      </div>
    </>
  );
}
