import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { inter, notoJp, fraunces } from '@a2p/ui/fonts';
import { messages } from '@/lib/messages';
import './globals.css';

/** 公開サイト(栞)/管理ツール共通のベース URL。canonical/OG の絶対 URL 解決に使う。 */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://a2p.m2p.tools').replace(/\/$/, '');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: messages.brand.appName,
  description: messages.brand.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoJp.variable} ${fraunces.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
