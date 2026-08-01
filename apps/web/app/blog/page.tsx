/**
 * ブログ一覧 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 独立ブランド「栞 -SHIORI-」= 良書の要点を紹介するブックジャーナル。
 * A2P ブランドとは意図的に切り離し、読者向けの高いデザイン性(エディトリアル/マガジン風)で
 * 構成する。ファビコンは app/blog/icon.png (Next.js route-segment icon) で栞マークを使用。
 * 各記事末で関連する A2P 書籍へ導線する（他 SNS と同じ戦略）。
 *
 * 配色は A2P デザイントークンに依存せず、当ブログ独自のパレットを arbitrary value で定義:
 *   paper #F7F1E3 / ink #1B1714 / green #1E5B49 / terracotta #C6572E / line #E6DECB
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { genreLabel, type Genre } from '@a2p/contracts/agents';
import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '栞 -SHIORI- | 良書の、要点だけ。',
  description:
    '実用書・ビジネス書・自己啓発の名作や話題書を、要点をしぼって紹介するブックジャーナル「栞 -SHIORI-」。「読む前に価値がわかる」レビューを毎日お届けします。',
  openGraph: {
    title: '栞 -SHIORI- | 良書の、要点だけ。',
    description: '名作・話題書の要点を紹介するブックジャーナル。',
    images: ['/blog-og.png'],
    type: 'website',
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

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
}

/** 表紙が無い記事の上品なプレースホルダ (罫囲みの紙面 + 栞マーク + ジャンル)。 */
function Placeholder({ genre, tall }: { genre: string | null; tall?: boolean }) {
  return (
    <div
      className={`relative flex ${tall ? 'aspect-[16/10]' : 'aspect-[16/10]'} w-full items-center justify-center overflow-hidden bg-[#EFE7D4]`}
    >
      {/* 罫囲み */}
      <div className="absolute inset-3 rounded-sm border border-[#1E5B49]/25" />
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <span className="font-serif text-3xl leading-none text-[#1E5B49]">栞</span>
        <span className="font-serif text-lg tracking-wide text-[#1B1714]">Book Review</span>
        {genre && <span className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A45]">{genre}</span>}
      </div>
    </div>
  );
}

export default async function BlogIndexPage() {
  const posts = await loadPosts();
  const [featured, ...rest] = posts;

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F1E3] text-[#1B1714] antialiased">
      {/* ── ヘッダ ── */}
      <header className="sticky top-0 z-20 border-b border-[#E6DECB] bg-[#F7F1E3]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/blog" className="flex items-baseline gap-2 no-underline">
            <span className="font-serif text-2xl font-bold tracking-tight text-[#1B1714]">栞</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#C6572E]">SHIORI</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-[#5C554A] md:flex">
            {CATEGORY_GENRES.slice(0, 5).map((g) => (
              <Link key={g} href="/blog" className="no-underline transition-colors hover:text-[#1E5B49]">
                {genreLabel(g)}
              </Link>
            ))}
          </nav>
          <Link
            href="/shop"
            className="rounded-full border border-[#1B1714] px-4 py-1.5 text-xs font-medium text-[#1B1714] no-underline transition-colors hover:bg-[#1B1714] hover:text-[#F7F1E3]"
          >
            書籍一覧
          </Link>
        </div>
      </header>

      {/* ── ヒーロー (インパクト重視・ダーク) ── */}
      <section className="w-full bg-[#141210] text-[#F3ECDC]">
        <div className="mx-auto max-w-6xl px-5 py-14 md:py-20">
          {featured ? (
            <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[1.4fr_1fr]">
              <div>
                <div className="mb-5 flex items-center gap-3">
                  <span className="inline-block h-px w-8 bg-[#C6572E]" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#C6572E]">
                    Featured — 今日の一冊
                  </span>
                </div>
                <Link href={`/blog/${featured.slug}`} className="no-underline">
                  <h1 className="font-serif text-4xl font-bold leading-[1.15] tracking-tight text-[#F3ECDC] transition-colors hover:text-[#E6B98A] md:text-6xl">
                    {featured.title}
                  </h1>
                </Link>
                <p className="mt-5 max-w-xl text-base leading-relaxed text-[#B9B2A4]">
                  {excerpt(featured.body_md, 150)}
                </p>
                <div className="mt-6 flex items-center gap-4 text-sm text-[#8B8577]">
                  {featured.genre && (
                    <span className="rounded-full border border-[#3A342C] px-3 py-1 text-[#C9C1B1]">{featured.genre}</span>
                  )}
                  <span>{fmtDate(featured.published_at)}</span>
                </div>
                <Link
                  href={`/blog/${featured.slug}`}
                  className="mt-8 inline-flex items-center gap-2 border-b-2 border-[#C6572E] pb-1 text-sm font-semibold text-[#F3ECDC] no-underline transition-colors hover:text-[#E6B98A]"
                >
                  この本の要点を読む
                  <span aria-hidden>→</span>
                </Link>
              </div>
              {/* カバー(縦) or 大きな見出し */}
              <div className="flex justify-center md:justify-end">
                <Link href={`/blog/${featured.slug}`} className="no-underline">
                  {featured.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={featured.coverUrl}
                      alt={featured.title}
                      className="aspect-[10/16] w-52 rotate-[2deg] rounded-sm object-cover shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-transform duration-300 hover:rotate-0 md:w-60"
                    />
                  ) : (
                    <div className="flex aspect-[10/16] w-52 rotate-[2deg] flex-col items-center justify-center gap-3 rounded-sm bg-gradient-to-br from-[#1E5B49] to-[#0F332A] px-6 text-center shadow-2xl md:w-60">
                      <span className="font-serif text-5xl text-[#F3ECDC]">栞</span>
                      <span className="text-[11px] uppercase tracking-[0.3em] text-[#9FD3C2]">Book Review</span>
                    </div>
                  )}
                </Link>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center">
              <h1 className="font-serif text-5xl font-bold text-[#F3ECDC]">栞 -SHIORI-</h1>
              <p className="mt-4 text-[#B9B2A4]">良書の、要点だけ。まもなくレビューを公開します。</p>
            </div>
          )}
        </div>
      </section>

      {/* ── カテゴリ帯 ── */}
      <div className="border-b border-[#E6DECB] bg-[#F7F1E3]">
        <div className="mx-auto max-w-6xl overflow-x-auto px-5 py-3">
          <ul className="flex items-center gap-2 whitespace-nowrap text-sm">
            <li className="pr-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8A6A45]">Genre</li>
            {CATEGORY_GENRES.map((g) => (
              <li key={g}>
                <Link
                  href="/blog"
                  className="inline-block rounded-full border border-[#E0D6BF] bg-[#FCF8EE] px-3.5 py-1 text-[#5C554A] no-underline transition-colors hover:border-[#1E5B49] hover:text-[#1E5B49]"
                >
                  {genreLabel(g)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── 記事グリッド ── */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12">
        {posts.length === 0 ? (
          <p className="py-16 text-center text-[#8B8577]">まもなく記事を公開します。</p>
        ) : (
          <>
            <div className="mb-8 flex items-end justify-between">
              <h2 className="font-serif text-2xl font-bold text-[#1B1714]">最新のレビュー</h2>
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A45]">Latest</span>
            </div>
            <ul className="grid grid-cols-1 gap-x-7 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}`} className="group flex h-full flex-col no-underline">
                    <div className="overflow-hidden rounded-sm shadow-[0_10px_30px_-18px_rgba(0,0,0,0.4)] transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.5)]">
                      {p.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.coverUrl}
                          alt={p.title}
                          className="aspect-[16/10] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <Placeholder genre={p.genre} />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col pt-4">
                      <div className="mb-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.15em] text-[#8A6A45]">
                        {p.genre && <span className="font-semibold text-[#1E5B49]">{p.genre}</span>}
                        <span>{fmtDate(p.published_at)}</span>
                      </div>
                      <h3 className="font-serif text-xl font-bold leading-snug text-[#1B1714] transition-colors group-hover:text-[#1E5B49]">
                        {p.title}
                      </h3>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[#5C554A]">{excerpt(p.body_md, 90)}</p>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#C6572E]">
                        続きを読む <span aria-hidden>→</span>
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {/* ── 書籍導線バンド ── */}
      <section className="w-full border-t border-[#E6DECB] bg-[#EFE7D4]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-12 text-center">
          <span className="font-serif text-3xl text-[#1E5B49]">栞</span>
          <h2 className="font-serif text-2xl font-bold text-[#1B1714]">読んだあとは、次の一冊へ。</h2>
          <p className="max-w-lg text-sm leading-relaxed text-[#5C554A]">
            レビューで紹介する名作に加え、要点をぎゅっとまとめた電子書籍もお届けしています。Kindle Unlimited 対象も。
          </p>
          <Link
            href="/shop"
            className="mt-2 rounded-full bg-[#1E5B49] px-6 py-2.5 text-sm font-semibold text-[#F3ECDC] no-underline transition-colors hover:bg-[#164838]"
          >
            出版書籍を見る →
          </Link>
        </div>
      </section>

      {/* ── フッタ ── */}
      <footer className="w-full bg-[#141210] text-[#B9B2A4]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-8 text-sm sm:flex-row sm:justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-bold text-[#F3ECDC]">栞</span>
            <span className="text-[10px] uppercase tracking-[0.35em] text-[#C6572E]">SHIORI</span>
            <span className="ml-2 text-xs text-[#7A7469]">© {new Date().getFullYear()} 良書の要点ブログ</span>
          </div>
          <nav className="flex items-center gap-5 text-xs">
            <Link href="/blog" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">記事一覧</Link>
            <Link href="/shop" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">書籍一覧</Link>
            <Link href="/legal/privacy" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">プライバシー</Link>
            <Link href="/legal/terms" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">利用規約</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
