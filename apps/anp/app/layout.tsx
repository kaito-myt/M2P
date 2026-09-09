import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ANP — Automated Note Publishing',
  description: 'note 記事の企画〜執筆〜出版〜販促〜収益化をテーマ別マルチアカウントで自動化する M2P ツール。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
