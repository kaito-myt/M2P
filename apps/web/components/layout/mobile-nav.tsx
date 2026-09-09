'use client';

/**
 * MobileNav — 狭幅(md 未満)向けのハンバーガー → 左ドロワーのナビ。
 * デスクトップ常駐サイドバー(Sidebar)は md 未満で非表示になるため、モバイルはここから開く。
 * ナビ本体は SidebarNav を共用し、リンク押下でドロワーを閉じる。
 */
import { useState } from 'react';
import { Menu } from 'lucide-react';

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SidebarNav } from './sidebar-nav';
import { messages } from '@/lib/messages';

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={messages.nav.sidebarAriaLabel}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-default border border-border-warm bg-cream-light text-charcoal hover:bg-charcoal-04 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        data-testid="mobile-nav-trigger"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SheetTitle className="sr-only">{messages.nav.sidebarAriaLabel}</SheetTitle>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
