import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ツール選択 | M2P',
  description: 'M2P (Money-Making Platform) — 各ツールへのハブ。ログインは一度だけ。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
