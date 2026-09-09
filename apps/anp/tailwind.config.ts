/**
 * Tailwind v3 config — プラットフォーム共通トークン（packages/ui/tokens.ts）を拡張。
 * apps/web と同一トークンで、ポータルと各ツールの見た目を揃える。
 */
import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';
import { tokens } from '@a2p/ui/tokens';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ...tokens.colors,
        background: tokens.colors.cream,
        foreground: tokens.colors.charcoal,
        border: tokens.colors['border-warm'],
        input: tokens.colors['border-warm'],
        ring: tokens.colors['ring-blue'],
        primary: {
          DEFAULT: tokens.colors.charcoal,
          foreground: tokens.colors['cream-light'],
        },
        secondary: {
          DEFAULT: tokens.colors.cream,
          foreground: tokens.colors.charcoal,
        },
        'destructive-foreground': tokens.colors['cream-light'],
      },
      spacing: tokens.spacing,
      borderRadius: tokens.borderRadius,
      boxShadow: tokens.boxShadow,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.fontSize,
      letterSpacing: tokens.letterSpacing,
    },
  },
  plugins: [typography],
};

export default config;
