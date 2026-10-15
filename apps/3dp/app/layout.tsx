import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '3DP — 3D Products',
  description:
    '3Dモデル商材 (ワールド用プロップ・家具・小物 / アクセサリ / 改変用テクスチャ) を企画・生成・検査し BOOTH で販売する M2P ツール。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
