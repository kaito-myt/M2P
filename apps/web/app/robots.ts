import type { MetadataRoute } from 'next';

import { STOREFRONT_URL } from '@/lib/site';

/**
 * robots.txt (App Router 生成)。公開ブログ/ショップをクロール可にし、管理画面は明示的に除外。
 * 検索インデックス対策 [F-052b/SEO]。sitemap/host は栞ストアフロントの正規ドメインに合わせる。
 */
const BASE = STOREFRONT_URL;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/blog', '/shop', '/legal'],
        disallow: ['/dashboard', '/api/', '/login'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
