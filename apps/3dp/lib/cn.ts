/**
 * `cn()` — 軽量 className composer。apps/anp と同じ理由で `clsx` のみ
 * (`tailwind-merge` が要るほどのクラス競合がまだ無く、新規依存を増やさない)。
 */
import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
