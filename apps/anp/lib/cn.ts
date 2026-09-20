/**
 * `cn()` — 軽量 className composer。A2P (`apps/web/lib/cn.ts`) は `tailwind-merge` +
 * カスタムトークンのグループ登録までしているが、ANP はそこまでの競合を起こす組み合わせ
 * (`text-button-sm` と `text-charcoal` の同時指定等) が今のところ無いため、新規依存を
 * 増やさず `clsx` のみで実装する (CLAUDE.md ハードルール: 新規 npm 依存は宣言のみ→pnpm install
 * 承認が要るため、既存依存で足りる限り増やさない)。
 */
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
