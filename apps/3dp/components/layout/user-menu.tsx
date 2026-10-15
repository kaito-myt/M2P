'use client';

/**
 * ヘッダー右のユーザーメニュー。A2P (`apps/web/components/layout/user-menu.tsx`) と同構造。
 * 依存を増やさないため <details>/<summary> による軽量ドロップダウンで実装。
 */
import Link from 'next/link';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';

import { logout } from '@/app/actions';
import { messages } from '@/lib/messages';

export function UserMenu({ username }: { username?: string }) {
  const name = username && username.length > 0 ? username : messages.header.settingsLabel;
  return (
    <details className="group relative [&_summary::-webkit-details-marker]:hidden">
      <summary
        className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-pill border border-border-warm bg-cream-light px-3 text-button-sm text-charcoal-82 hover:bg-charcoal-04 hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={messages.header.userMenuLabel}
      >
        <User className="h-4 w-4" aria-hidden="true" />
        <span className="max-w-[8rem] truncate">{name}</span>
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-default border border-border-warm bg-cream-light py-1 shadow-sm">
        <Link
          href="/settings"
          className="flex items-center gap-2 px-3 py-2 text-button-sm text-charcoal-82 no-underline hover:bg-charcoal-04 hover:text-charcoal"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          {messages.header.settingsMenuLabel}
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-button-sm text-destructive hover:bg-charcoal-04"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {messages.header.logoutLabel}
          </button>
        </form>
      </div>
    </details>
  );
}
