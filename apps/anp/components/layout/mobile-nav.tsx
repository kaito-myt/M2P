'use client';

/**
 * MobileNav — 狭幅(md 未満)向けのハンバーガー→左ドロワーのナビ。
 *
 * A2P (`apps/web/components/layout/mobile-nav.tsx`) は `@radix-ui/react-dialog` ベースの
 * `Sheet` を使うが、ANP はその依存を持たない (CLAUDE.md ハードルール: 新規 npm 依存は
 * 宣言のみ→pnpm install 承認が要るため、既存依存 (react/lucide-react) だけで賄える
 * 軽量な自前ドロワーにする)。挙動 (md: 以上でサイドバー常駐・未満はハンバーガー→ドロワー) は同一。
 */
import { useEffect } from 'react';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

import { SidebarNav } from './sidebar-nav';
import { messages } from '@/lib/messages';

export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={messages.nav.sidebarAriaLabel}
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-default border border-border-warm bg-cream-light text-charcoal hover:bg-charcoal-04 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        data-testid="mobile-nav-trigger"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label={messages.common.cancel}
            className="absolute inset-0 bg-charcoal/40"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-cream-light shadow-lg">
            <div className="flex h-14 shrink-0 items-center justify-end border-b border-border-warm px-3">
              <button
                type="button"
                aria-label={messages.common.cancel}
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-default text-charcoal hover:bg-charcoal-04"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
