/**
 * Sidebar navigation — A2P / ANP と同構造。
 *
 * Inc-1 の時点では docs/12 §9 の 6 画面のうち 3 画面 (ホーム / 商品 / 設定) だけを置く。
 * 商品詳細 (S-3DP-03) / 承認 (S-3DP-04) / リサーチ (S-3DP-05) は、それぞれ生成 (Inc-2)・
 * プレビュー (Inc-4)・リサーチ (Inc-3) が入ってから。**中身の無い画面をナビに並べない。**
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
      { key: 'products', label: m.itemProducts, href: '/products', enabled: true },
    ],
  },
  {
    key: 'system',
    label: m.sectionSystem,
    items: [{ key: 'settings', label: m.itemSettings, href: '/settings', enabled: true }],
  },
];
