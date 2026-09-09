import type { MetadataRoute } from 'next';

import { prisma } from '@a2p/db';

import { STOREFRONT_URL } from '@/lib/site';

/**
 * sitemap.xml (App Router 生成)。ブログ/ショップ＋公開済みブログ記事の全URLを列挙し、
 * Google が良書紹介ブログの各記事を発見できるようにする [SEO]。1時間ごとに再生成。
 * 栞専用ドメインが有効ならその URL で列挙する（正規ドメインに一致させる）。
 */
const BASE = STOREFRONT_URL;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let posts: Array<{ slug: string; published_at: Date | null; updated_at: Date }> = [];
  try {
    posts = await prisma.blogPost.findMany({
      where: { status: 'published' },
      select: { slug: true, published_at: true, updated_at: true },
      orderBy: [{ published_at: 'desc' }],
      take: 5000,
    });
  } catch {
    posts = [];
  }

  // ルート `/` は認証状態で /dashboard(管理ツール) か /shop へ転送するリダイレクトなので
  // sitemap には載せない。公開サイトの入口は本棚(/shop)とレビュー(/blog)を最上位に据える。
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE}/shop`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/blog`, changeFrequency: 'daily', priority: 0.9 },
  ];

  const blogRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: p.updated_at ?? p.published_at ?? undefined,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  return [...staticRoutes, ...blogRoutes];
}
