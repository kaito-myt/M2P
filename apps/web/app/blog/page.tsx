/**
 * 所有ブログ 一覧 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 「良書の要点を紹介する」ブックジャーナル。名作・話題書のレビュー/要約記事が並び、
 * 各記事末で関連する A2P の書籍へ導線する（他 SNS と同じ戦略）。/shop と同一ブランド
 * (A2P) のヘッダ/フッタ・favicon で統一。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'A2P Books Journal — 良書の要点ブログ',
  description:
    '実用書・ビジネス書・自己啓発の名作や話題書を、要点をしぼって紹介するブックジャーナル。忙しいあなたが「読む前に価値がわかる」記事をお届けします。',
  openGraph: {
    title: 'A2P Books Journal — 良書の要点ブログ',
    description: '名作・話題書の要点を紹介するブックジャーナル。',
    images: ['/logo-mark.png'],
  },
};

function excerpt(md: string, n = 120): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[#*_>`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > n ? plain.slice(0, n) + '…' : plain;
}

export default async function BlogIndexPage() {
  const posts = await prisma.blogPost.findMany({
    where: { status: 'published' },
    orderBy: [{ published_at: 'desc' }],
    take: 100,
    select: { slug: true, title: true, published_at: true, body_md: true },
  });

  const [featured, ...rest] = posts;

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      {/* ブランドヘッダ */}
      <header className="border-b border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Link href="/blog" className="no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="A2P Books Journal" className="h-9 w-auto" />
          </Link>
          <nav className="flex items-center gap-4 text-caption text-muted">
            <Link href="/blog" className="hover:text-charcoal">記事</Link>
            <Link href="/shop" className="hover:text-charcoal">書籍一覧</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        {/* ヒーロー */}
        <section className="mb-10 flex flex-col items-center gap-3 text-center">
          <p className="text-caption font-medium uppercase tracking-widest text-accent">Books Journal</p>
          <h1 className="text-3xl font-bold tracking-tight text-charcoal">良書の要点を、あなたに。</h1>
          <p className="max-w-2xl text-body text-muted">
            実用書・ビジネス書・自己啓発の名作や話題書を、要点をしぼって紹介します。
            「読む前に価値がわかる」一本を、毎日お届け。
          </p>
        </section>

        {posts.length === 0 ? (
          <p className="py-12 text-center text-muted">まもなく記事を公開します。</p>
        ) : (
          <div className="flex flex-col gap-8">
            {/* 注目記事(最新) */}
            {featured && (
              <Link
                href={`/blog/${featured.slug}`}
                className="group flex flex-col gap-2 rounded-card border border-border-warm bg-cream-light p-6 no-underline shadow-l1 transition hover:shadow-l2"
              >
                <span className="text-caption font-medium text-accent">最新記事</span>
                <h2 className="text-2xl font-bold leading-snug text-charcoal group-hover:text-accent">
                  {featured.title}
                </h2>
                <span className="text-caption text-muted">
                  {featured.published_at ? new Date(featured.published_at).toLocaleDateString('ja-JP') : ''}
                </span>
                <p className="mt-1 line-clamp-3 text-body text-charcoal-82">{excerpt(featured.body_md, 160)}</p>
                <span className="mt-2 text-button-sm font-medium text-accent">続きを読む →</span>
              </Link>
            )}

            {/* 記事グリッド */}
            {rest.length > 0 && (
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {rest.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/blog/${p.slug}`}
                      className="group flex h-full flex-col gap-2 rounded-card border border-border-warm bg-cream-light p-5 no-underline shadow-l1 transition hover:shadow-l2"
                    >
                      <h3 className="line-clamp-2 text-button-sm font-bold leading-snug text-charcoal group-hover:text-accent">
                        {p.title}
                      </h3>
                      <span className="text-caption text-muted">
                        {p.published_at ? new Date(p.published_at).toLocaleDateString('ja-JP') : ''}
                      </span>
                      <p className="line-clamp-3 text-caption text-charcoal-82">{excerpt(p.body_md, 110)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>

      {/* フッタ */}
      <footer className="border-t border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 px-5 py-6 text-caption text-muted sm:flex-row sm:justify-between">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="A2P" className="h-5 w-5 rounded" />
            <span>© {new Date().getFullYear()} A2P — Amazon Auto Publisher</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/shop" className="hover:text-charcoal">書籍一覧</Link>
            <Link href="/legal/privacy" className="hover:text-charcoal">プライバシー</Link>
            <Link href="/legal/terms" className="hover:text-charcoal">利用規約</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
