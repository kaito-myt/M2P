/**
 * Sidebar — docs/04 §3.3 (cool-neutral SaaS リフレッシュ)。
 *
 * デスクトップ(md 以上)常駐の縦ナビ。固定幅 240px、白サーフェス、右端に 1px 縦罫線。
 * 狭幅(md 未満)では非表示にし、モバイルはヘッダの MobileNav(ハンバーガー→ドロワー)で開く。
 * ナビ本体は SidebarNav に集約し、デスクトップ/ドロワーで共用する。
 */
import { SidebarNav } from './sidebar-nav';
import { messages } from '@/lib/messages';

export function Sidebar() {
  return (
    <aside
      aria-label={messages.nav.sidebarAriaLabel}
      data-testid="sidebar-nav"
      className="hidden h-full w-60 shrink-0 flex-col border-r border-border-warm bg-cream-light md:flex"
    >
      <SidebarNav />
    </aside>
  );
}
