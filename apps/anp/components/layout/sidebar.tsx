/**
 * Sidebar — A2P (`apps/web/components/layout/sidebar.tsx`) と同構造 (docs/11-anp-design.md §5.1)。
 * デスクトップ(md 以上)常駐の縦ナビ。固定幅 240px。狭幅(md 未満)は非表示にし、
 * モバイルはヘッダの MobileNav(ハンバーガー→ドロワー)で開く。
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
