/**
 * Next.js self-hosted Google Fonts per `docs/03 §K` UI-02 / UI-03.
 *
 * - Inter: English / latin / numerics — weights 400/500/600
 * - Noto Sans JP: 日本語 — weights 400/500/600
 *
 * Both are variable fonts; `display: 'swap'` avoids FOIT for long bodies of
 * Japanese text where Noto Sans JP can take ~600 KB to download.
 *
 * The exported objects expose `.variable` (CSS variable class name) which
 * `apps/web/app/layout.tsx` applies to `<html>`.
 */
import { Inter, Noto_Sans_JP, Fraunces } from 'next/font/google';

export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Fraunces — 表示用の "old-style" エディトリアルセリフ。数値ヒーロー・大見出しにだけ使う
 * (本文/日本語は Inter / Noto Sans JP のまま)。定番 (Inter/Roboto) 一辺倒の単調さを避け、
 * 人の手による誌面のような品位を数字に与えるための限定使用フォント。latin/数字のみ。
 */
export const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal'],
  variable: '--font-display',
  display: 'swap',
});

export const notoJp = Noto_Sans_JP({
  // Noto Sans JP requires the 'latin' subset declaration; CJK glyphs are auto-bundled.
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-noto-jp',
  display: 'swap',
});
