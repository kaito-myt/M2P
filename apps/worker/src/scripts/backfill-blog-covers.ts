/**
 * 既存の栞ブログ記事に、紹介対象書籍の実表紙 URL をバックフィルする一回性スクリプト。
 *
 * 対象: status='published' かつ cover_image_url 未設定の記事。
 *   - book_id あり(自社本)の記事はスキップ（一覧/詳細は本棚の R2 書影を優先するため）。
 *   - それ以外(外部良書紹介)は resolveBookCoverUrl で openBD 検証→Amazon 書影を解決。
 *
 * 実行:
 *   ANTHROPIC_API_KEY / DATABASE_URL 等を環境に用意して
 *   pnpm --filter @a2p/worker exec tsx src/scripts/backfill-blog-covers.ts
 */
import { resolveBookCoverUrl } from '@a2p/agents';
import { prisma } from '@a2p/db';

async function main(): Promise<void> {
  const posts = await prisma.blogPost.findMany({
    where: { status: 'published', cover_image_url: null, book_id: null },
    select: { id: true, slug: true, title: true, body_md: true },
    orderBy: { published_at: 'desc' },
  });
  console.log(`target posts: ${posts.length}`);

  let hit = 0;
  for (const p of posts) {
    await new Promise((r) => setTimeout(r, 4000)); // Amazon スロットリング回避の間合い
    let url: string | null = null;
    try {
      url = await resolveBookCoverUrl(
        { title: p.title, body: p.body_md },
        // 一回性バックフィル: API キーは DB を介さず env から（public proxy の DB 断を回避）。
        { getApiKey: async () => process.env.ANTHROPIC_API_KEY ?? '' },
      );
    } catch (e) {
      console.log(`  [ERR] ${p.slug}: ${(e as Error).message}`);
    }
    if (url) {
      await prisma.blogPost.update({ where: { id: p.id }, data: { cover_image_url: url } });
      hit++;
      console.log(`  [OK ] ${p.title.slice(0, 28)} -> ${url}`);
    } else {
      console.log(`  [--- ] ${p.title.slice(0, 28)} (no cover resolved)`);
    }
  }
  console.log(`done: ${hit}/${posts.length} covers resolved`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
