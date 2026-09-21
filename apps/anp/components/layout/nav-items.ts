/**
 * Sidebar navigation — A2P (`apps/web/components/layout/nav-items.ts`) と同構造。
 * ANP は画面数が少ないため単一セクションにまとめる (docs/11-anp-design.md §5.1)。
 */
import { messages } from '@/lib/messages';

export interface NavItem {
  key: string;
  label: string;
  href: string;
  enabled: boolean;
}

export interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
}

const m = messages.nav;

export const navSections: readonly NavSection[] = [
  {
    key: 'main',
    label: m.sectionMain,
    items: [
      { key: 'home', label: m.itemHome, href: '/', enabled: true },
      { key: 'accounts', label: m.itemAccounts, href: '/accounts', enabled: true },
      { key: 'themes', label: m.itemThemes, href: '/themes', enabled: true },
      { key: 'articles', label: m.itemArticles, href: '/articles', enabled: true },
      { key: 'promotion', label: m.itemPromotion, href: '/promotion', enabled: true },
    ],
  },
  {
    key: 'analytics',
    label: m.sectionAnalytics,
    items: [
      { key: 'sales', label: m.itemSalesDashboard, href: '/analytics/sales', enabled: true },
      { key: 'cost', label: m.itemCostDashboard, href: '/analytics/cost', enabled: true },
    ],
  },
  {
    key: 'system',
    label: m.sectionSystem,
    items: [{ key: 'settings', label: m.itemSettings, href: '/settings', enabled: true }],
  },
];
