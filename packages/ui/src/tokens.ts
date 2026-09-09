/**
 * A2P design tokens — implementation of `docs/04 §6.3` (the design-token source of truth).
 *
 * These tokens are the single source of truth for:
 *   - `apps/web/tailwind.config.ts`     (via `theme.extend`)
 *   - `apps/web/app/globals.css`        (via CSS variables in `:root`)
 *   - React components in `packages/ui/components/`
 *
 * Adding new colors / radii / shadows here is the only sanctioned way to expand
 * the palette. Hard-coded hex values elsewhere violate `docs/04 §6.5 Do/Don't`.
 */

/**
 * Cool-neutral SaaS palette (Linear / Vercel / Notion 系)。
 * warm-parchment から冷たいニュートラルへ刷新。名前 (cream/charcoal/border-warm)
 * は既存コンポーネント互換のため据え置き、値だけをクール系に差し替える。
 *   cream        = アプリ背景キャンバス (ごく薄いクールグレー)
 *   cream-light  = カード/サーフェス (純白)
 *   charcoal     = インク (near-black slate)。派生グレーは同 RGB の alpha。
 */
export const colors = {
  // Base
  cream: '#f6f7f9', // app canvas — cool light grey
  'cream-light': '#ffffff', // cards / surfaces — pure white
  charcoal: '#101828', // ink — cool near-black slate
  'border-warm': '#e6e8ec', // hairline border — cool grey
  muted: '#667085', // secondary text — cool slate-500

  // Charcoal (ink) opacity scale — cool greys derive from ink RGB (16,24,40)
  'charcoal-100': '#101828',
  'charcoal-83': 'rgba(16, 24, 40, 0.83)',
  'charcoal-82': 'rgba(16, 24, 40, 0.72)',
  'charcoal-40': 'rgba(16, 24, 40, 0.40)',
  'charcoal-04': 'rgba(16, 24, 40, 0.04)',
  'charcoal-03': 'rgba(16, 24, 40, 0.025)',

  // Semantic colors (crisp SaaS tones)
  destructive: '#d92d20', // red-600
  'destructive-bg': '#fef3f2', // red-50
  warning: '#b54708', // amber-700
  'warning-bg': '#fffaeb', // amber-50
  success: '#067647', // emerald-700
  'success-bg': '#ecfdf3', // emerald-50
  // The single editorial accent — a warm vermilion (朱). Used sparingly for the
  // one thing that matters on a view (active state, a link, an attention signal).
  // Replaces the former indigo so the UI reads as monotone-ink + one accent.
  accent: '#b23a1e', // vermilion
  'accent-bg': '#f8efeb', // faint warm tint

  // Focus ring (vermilion tint)
  'ring-blue': 'rgba(178, 58, 30, 0.30)',
} as const;

export const spacing = {
  'space-tight': '8px',
  'space-snug': '12px',
  'space-relaxed': '16px',
  'space-loose': '24px',
  'space-section-sm': '40px',
  'space-section': '80px',
  'space-hero': '128px',
  'space-display': '208px',
} as const;

export const borderRadius = {
  micro: '4px',
  default: '6px',
  snug: '8px',
  card: '10px', // crisper SaaS card radius
  container: '14px',
  pill: '9999px',
} as const;

export const boxShadow = {
  // L2 Inset — dark primary button signature (subtle cool)
  'l2-inset':
    'inset 0 1px 0 0 rgba(255,255,255,0.08), 0 1px 2px 0 rgba(16,24,40,0.10), 0 1px 3px 0 rgba(16,24,40,0.06)',
  // L3 Focus — clean cool elevation for cards / active state
  'l3-focus': '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px -6px rgba(16,24,40,0.10)',
  // Keyboard focus ring (indigo)
  ring: '0 0 0 3px rgba(79,70,229,0.28)',
} as const;

export const fontFamily: Record<'sans' | 'jp' | 'display', string[]> = {
  sans: ['var(--font-inter)', 'var(--font-noto-jp)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  jp: ['var(--font-noto-jp)', 'var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  // Editorial display serif for figures / large headings (latin & numerals only).
  display: ['var(--font-display)', 'ui-serif', 'Georgia', 'Times New Roman', 'serif'],
};

/**
 * Typography roles. Each entry returns Tailwind's `fontSize` tuple format:
 *   [size, { lineHeight, letterSpacing, fontWeight }]
 *
 * docs/04 §6.3.2 specifies role-based scale (display-hero ... button-sm).
 * Weights are 400 / 480 / 600 only — no 700 (Do/Don't).
 */
type FontSizeTuple = [string, { lineHeight: string; letterSpacing: string; fontWeight: string }];

export const fontSize: Record<string, FontSizeTuple> = {
  'display-hero': ['3.75rem', { lineHeight: '1.05', letterSpacing: '-1.5px', fontWeight: '600' }],
  'display-alt': ['3.75rem', { lineHeight: '1.00', letterSpacing: '0', fontWeight: '480' }],
  'section-heading': ['3rem', { lineHeight: '1.00', letterSpacing: '-1.2px', fontWeight: '600' }],
  // page-title — 密度の高い業務ツール向けに 36px→28px へ縮小（全画面の H1 に波及）。
  'sub-heading': ['1.75rem', { lineHeight: '1.15', letterSpacing: '-0.5px', fontWeight: '600' }],
  // section-title — ページ内セクション見出し。card-title(20px) と sub-heading(28px) の間を埋め、
  // 「囲まずに」節を分けるための役割（設定・経営などの節見出しに使う）。
  'section-title': ['1.125rem', { lineHeight: '1.30', letterSpacing: '-0.2px', fontWeight: '600' }],
  'card-title': ['1.25rem', { lineHeight: '1.25', letterSpacing: '0', fontWeight: '400' }],
  'body-large': ['1.125rem', { lineHeight: '1.38', letterSpacing: '0', fontWeight: '400' }],
  body: ['1rem', { lineHeight: '1.50', letterSpacing: '0', fontWeight: '400' }],
  button: ['1rem', { lineHeight: '1.50', letterSpacing: '0', fontWeight: '400' }],
  'button-sm': ['0.875rem', { lineHeight: '1.50', letterSpacing: '0', fontWeight: '400' }],
  caption: ['0.875rem', { lineHeight: '1.50', letterSpacing: '0', fontWeight: '400' }],
};

export const letterSpacing = {
  tighter: '-1.5px',
  tight: '-0.9px',
  normal: '0',
  // Japanese headings: per §6.3.2, Tailwind's tracking-tight equivalent
  'jp-tight': '-0.025em',
} as const;

/**
 * Aggregated default export — Tailwind config consumes this directly.
 * Keeping a single object makes `tailwind.config.ts` a 1-line import.
 */
export const tokens = {
  colors,
  spacing,
  borderRadius,
  boxShadow,
  fontFamily,
  fontSize,
  letterSpacing,
} as const;

export type Tokens = typeof tokens;
