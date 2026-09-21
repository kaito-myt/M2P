'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, LineChart, Settings, type LucideIcon } from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** 準備中（クリック可だが機能はこれから）。 */
  soon?: boolean;
  /** 未実装（クリック不可）。 */
  disabled?: boolean;
}

/**
 * ポータル共通メニュー。将来ここに「経営ダッシュボード（全体売上/コスト）」等を増やす。
 * 現状は ツール(ハブ) と 設定 (AI モデル割当 / API キー) がライブ、経営ダッシュボードは雛形。
 */
const ITEMS: NavItem[] = [
  { href: '/', label: 'ツール', icon: LayoutGrid },
  { href: '/dashboard', label: '経営ダッシュボード', icon: LineChart, soon: true },
  { href: '/settings', label: '設定', icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const pathname = usePathname() || '/';
  const wrap =
    orientation === 'vertical'
      ? 'flex flex-col gap-1'
      : 'flex flex-row gap-1 overflow-x-auto';

  return (
    <ul className={wrap}>
      {ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        const base =
          'group/nav flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors';

        const content = (
          <>
            <Icon
              className={`h-[18px] w-[18px] shrink-0 ${
                active ? 'text-emerald-300' : 'text-white/45 group-hover/nav:text-white/75'
              }`}
              style={active ? { color: '#6ee7b7' } : undefined}
            />
            <span className="flex-1">{item.label}</span>
            {item.soon && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-white/45">
                準備中
              </span>
            )}
          </>
        );

        if (item.disabled) {
          return (
            <li key={item.href}>
              <span
                className={`${base} cursor-not-allowed text-white/30`}
                aria-disabled="true"
                title="準備中"
              >
                {content}
              </span>
            </li>
          );
        }

        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`${base} ${
                active
                  ? 'bg-white/[0.06] text-white'
                  : 'text-white/60 hover:bg-white/[0.04] hover:text-white'
              }`}
              style={
                active
                  ? { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }
                  : undefined
              }
            >
              {content}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
