/**
 * 所有ブログ 一覧 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 「良書の要点」ブックジャーナル。参考: 人気の個人ブログ風レイアウト
 * (サムネイル画像が上のカード + サイドバー + カテゴリ) を A2P ブランド配色で構成。
 * 各記事末で関連する A2P 書籍へ導線する（他 SNS と同じ戦略）。
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { genreLabel, type Genre } from '@a2p/contracts/agents';
import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'A2P Books Journal — 良書の要点ブログ',
  description:
    '実用書・ビジネス書・自己啓発の名作や話題書を、要点をしぼって紹介するブックジャーナル。「読む前に価値がわかる」記事を毎日お届けします。',
  openGraph: {
    title: 'A2P Books Journal — 良書の要点ブログ',
    description: '名作・話題書の要点を紹介するブックジャーナル。',
    images: ['/logo-mark.png'],
  },
};

/** カテゴリ(ジャンル)チップに使う代表ジャンル。 */
const CATEGORY_GENRES: Genre[] = [
  'business',
  'self_help',
  'money_investment',
  'ai_technology',
  'health_lifestyle',
  'study_career',
];

function excerpt(md: string, n = 100): string {
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

interface PostView {
  slug: string;
  title: string;
  published_at: Date | null;
  body_md: string;
  coverUrl: string | null;
  genre: string | null;
}

async function loadPosts(): Promise<PostView[]> {
  const posts = await prisma.blogPost.findMany({
    where: { status: 'published' },
    orderBy: [{ published_at: 'desc' }],
    take: 30,
    select: { slug: true, title: true, published_at: true, body_md: true, book_id: true },
  });
  const bookIds = [...new Set(posts.map((p) => p.book_id).filter((x): x is string => !!x))];
  const books = bookIds.length
    ? await prisma.book.findMany({
        where: { id: { in: bookIds } },
        select: { id: true, theme: { select: { genre: true } }, covers: { where: { status: 'adopted' }, select: { r2_key: true }, take: 1 } },
      })
    : [];
  const bookMap = new Map(books.map((b) => [b.id, b]));
  return Promise.all(
    posts.map(async (p) => {
      const b = p.book_id ? bookMap.get(p.book_id) : undefined;
      const key = b?.covers[0]?.r2_key;
      const coverUrl = key ? await getSignedDownloadUrl(key, 900).catch(() => null) : null;
      const g = b?.theme?.genre;
      return {
        slug: p.slug,
        title: p.title,
        published_at: p.published_at,
        body_md: p.body_md,
        coverUrl,
        genre: g ? genreLabel(g as Genre) ?? null : null,
      };
    }),
  );
}

/** サムネイル: 表紙があれば表紙、無ければブランドのグラデ枠。 */
function Thumb({ coverUrl, title, genre, tall }: { coverUrl: string | null; title: string; genre: string | null; tall?: boolean }) {
  const h = tall ? 'h-48' : 'h-40';
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={coverUrl} alt={title} className={`${h} w-full object-cover`} />;
  }
  return (
    <div className={`${h} flex w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-charcoal to-accent px-4 text-center`}>
      <span className="text-caption font-medium uppercase tracking-widest text-cream-light/80">Book Review</span>
      <span className="line-clamp-2 text-button-sm font-bold text-cream-light">{title}</span>
      {genre && <span className="rounded-full bg-cream-light/20 px-2 py-0.5 text-caption text-cream-light">{genre}</span>}
    </div>
  );
}

export default async function BlogIndexPage() {
  const posts = await loadPosts();
  const [featured, ...rest] = posts;

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      {/* ヘッダ + カテゴリナビ */}
      <header className="border-b border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link href="/blog" className="no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="A2P Books Journal" className="h-9 w-auto" />
          </Link>
          <nav className="flex items-center gap-4 text-caption text-muted">
            <Link href="/blog" className="hover:text-charcoal">記事</Link>
            <Link href="/shop" className="hover:text-charcoal">書籍一覧</Link>
          </nav>
        </div>
        <div className="mx-auto max-w-5xl overflow-x-auto px-5 pb-3">
          <ul className="flex gap-2 whitespace-nowrap">
            {CATEGORY_GENRES.map((g) => (
              <li key={g}>
                <span className="inline-block rounded-full border border-border-warm bg-cream px-3 py-1 text-caption text-charcoal-82">
                  {genreLabel(g)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        {/* ヒーロー */}
        <section className="mb-8 flex flex-col items-center gap-2 text-center">
          <p className="text-caption font-medium uppercase tracking-widest text-accent">Books Journal</p>
          <h1 className="text-3xl font-bold tracking-tight text-charcoal">良書の要点を、あなたに。</h1>
          <p className="max-w-2xl text-body text-muted">
            名作・話題書の「読む前に価値がわかる」要点を、毎日お届け。実用書・ビジネス書・自己啓発を中心に。
          </p>
        </section>

        {posts.length === 0 ? (
          <p className="py-12 text-center text-muted">まもなく記事を公開します。</p>
        ) : (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
            {/* メインカラム */}
            <div className="flex flex-col gap-6">
              {/* 注目(最新) */}
              {featured && (
                <Link
                  href={`/blog/${featured.slug}`}
                  className="group overflow-hidden rounded-card border border-border-warm bg-cream-light no-underline shadow-l1 transition hover:shadow-l2"
                >
                  <Thumb coverUrl={featured.coverUrl} title={featured.title} genre={featured.genre} tall />
                  <div className="flex flex-col gap-2 p-5">
                    <div className="flex items-center gap-2 text-caption text-muted">
                      <span className="rounded bg-accent/10 px-2 py-0.5 font-medium text-accent">最新</span>
                      {featured.genre && <span>{featured.genre}</span>}
                      <span>{featured.published_at ? new Date(featured.published_at).toLocaleDateString('ja-JP') : ''}</span>
                    </div>
                    <h2 className="text-2xl font-bold leading-snug text-charcoal group-hover:text-accent">{featured.title}</h2>
                    <p className="line-clamp-2 text-body text-charcoal-82">{excerpt(featured.body_md, 140)}</p>
                  </div>
                </Link>
              )}

              {/* カードグリッド */}
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {rest.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/blog/${p.slug}`}
                      className="group flex h-full flex-col overflow-hidden rounded-card border border-border-warm bg-cream-light no-underline shadow-l1 transition hover:shadow-l2"
                    >
                      <Thumb coverUrl={p.coverUrl} title={p.title} genre={p.genre} />
                      <div className="flex flex-1 flex-col gap-1.5 p-4">
                        <div className="flex items-center gap-2 text-caption text-muted">
                          {p.genre && <span className="rounded bg-charcoal-04 px-1.5 py-0.5">{p.genre}</span>}
                          <span>{p.published_at ? new Date(p.published_at).toLocaleDateString('ja-JP') : ''}</span>
                        </div>
                        <h3 className="line-clamp-2 text-button-sm font-bold leading-snug text-charcoal group-hover:text-accent">{p.title}</h3>
                        <p className="line-clamp-2 text-caption text-charcoal-82">{excerpt(p.body_md, 80)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* サイドバー */}
            <aside className="flex flex-col gap-6">
              {/* プロフィール */}
              <div className="rounded-card border border-border-warm bg-cream-light p-5 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="A2P" className="mx-auto h-14 w-14 rounded-2xl" />
                <p className="mt-3 text-button-sm font-bold text-charcoal">A2P Books Journal</p>
                <p className="mt-1 text-caption text-muted">
                  実用書・ビジネス書・自己啓発の良書を、要点をしぼって紹介。忙しいあなたの「次の一冊」選びに。
                </p>
                <Link
                  href="/shop"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-card bg-accent px-3 py-2 text-caption font-medium text-cream-light no-underline hover:opacity-80"
                >
                  出版書籍を見る →
                </Link>
              </div>

              {/* 最新記事 */}
              {rest.length > 0 && (
                <div className="rounded-card border border-border-warm bg-cream-light p-5">
                  <p className="mb-3 text-caption font-bold uppercase tracking-wide text-charcoal">最新記事</p>
                  <ul className="flex flex-col divide-y divide-border-warm">
                    {posts.slice(0, 6).map((p) => (
                      <li key={p.slug} className="py-2">
                        <Link href={`/blog/${p.slug}`} className="line-clamp-2 text-caption text-charcoal-82 no-underline hover:text-accent">
                          {p.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ジャンル */}
              <div className="rounded-card border border-border-warm bg-cream-light p-5">
                <p className="mb-3 text-caption font-bold uppercase tracking-wide text-charcoal">ジャンル</p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_GENRES.map((g) => (
                    <span key={g} className="rounded-full border border-border-warm px-3 py-1 text-caption text-charcoal-82">
                      {genreLabel(g)}
                    </span>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      {/* フッタ */}
      <footer className="border-t border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 px-5 py-6 text-caption text-muted sm:flex-row sm:justify-between">
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
