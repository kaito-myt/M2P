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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/blog" className="flex items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/blog-mark.png" alt="栞 -SHIORI-" className="h-8 w-8 rounded-md object-cover" />
            <span className="flex items-baseline gap-1.5">
              <span className="font-serif text-xl font-bold tracking-tight text-[#1B1714]">栞</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#C6572E]">SHIORI</span>
            </span>
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

      {/* ── ヒーロー (ブログのコンセプト = 良い本を読む習慣) ── */}
      <section className="w-full bg-[#141210] text-[#F3ECDC]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 py-16 md:grid-cols-[1.35fr_1fr] md:py-24">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-[#C6572E]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#C6572E]">
                A Reading Habit — 良い本を読む習慣
              </span>
            </div>
            <h1 className="font-serif text-4xl font-bold leading-[1.2] tracking-tight text-[#F3ECDC] md:text-[3.4rem]">
              良い本を読む習慣は、
              <br className="hidden sm:block" />
              <span className="text-[#E6B98A]">「要点」</span>から始まる。
            </h1>
            <p className="mt-6 max-w-xl text-base leading-[1.9] text-[#C9C1B1]">
              積ん読が増える毎日でも、良書との出会いはあきらめたくない。
              <strong className="font-semibold text-[#F3ECDC]">栞 -SHIORI-</strong> は、
              名作・話題のビジネス書や実用書・自己啓発を、忙しいあなたのために
              <strong className="font-semibold text-[#F3ECDC]">要点だけ</strong>に絞ってお届けするブックジャーナルです。
            </p>
            <p className="mt-4 max-w-xl text-base leading-[1.9] text-[#B9B2A4]">
              1記事5分。「読んだ気」で終わらせず、明日から使える学びを一つ持ち帰る——
              そんな読書習慣を、栞のように毎日そっと差し込んでいきます。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {featured && (
                <Link
                  href={`/blog/${featured.slug}`}
                  className="inline-flex items-center gap-2 rounded-full bg-[#C6572E] px-6 py-2.5 text-sm font-semibold text-[#F3ECDC] no-underline transition-colors hover:bg-[#a8461f]"
                >
                  最新のレビューを読む <span aria-hidden>→</span>
                </Link>
              )}
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 border-b-2 border-[#3A342C] pb-1 text-sm font-medium text-[#C9C1B1] no-underline transition-colors hover:border-[#C6572E] hover:text-[#F3ECDC]"
              >
                出版書籍を見る
              </Link>
            </div>
          </div>
          {/* 栞イラスト (gpt-image 生成) を額装 */}
          <div className="flex justify-center md:justify-end">
            <div className="overflow-hidden rounded-2xl bg-[#F3ECDC] p-2 shadow-[0_30px_70px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/blog-mark-source.png"
                alt="栞 -SHIORI- のシンボル"
                className="h-56 w-56 rounded-xl object-cover md:h-72 md:w-72"
              />
            </div>
          </div>
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
            {/* 最新の一冊 (横長ハイライト) */}
            {featured && (
              <Link
                href={`/blog/${featured.slug}`}
                className="group mb-14 grid grid-cols-1 overflow-hidden rounded-lg border border-[#E6DECB] bg-[#FCF8EE] no-underline shadow-[0_14px_40px_-22px_rgba(0,0,0,0.4)] transition-shadow hover:shadow-[0_22px_50px_-22px_rgba(0,0,0,0.5)] md:grid-cols-[1.1fr_1fr]">
                <div className="overflow-hidden">
                  {featured.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={featured.coverUrl}
                      alt={featured.title}
                      className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] md:h-full"
                    />
                  ) : (
                    <Placeholder genre={featured.genre} tall />
                  )}
                </div>
                <div className="flex flex-col justify-center p-7 md:p-9">
                  <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-[#8A6A45]">
                    <span className="rounded-full bg-[#C6572E] px-2.5 py-0.5 font-semibold text-[#F3ECDC]">最新</span>
                    {featured.genre && <span className="font-semibold text-[#1E5B49]">{featured.genre}</span>}
                    <span>{fmtDate(featured.published_at)}</span>
                  </div>
                  <h3 className="font-serif text-2xl font-bold leading-snug text-[#1B1714] transition-colors group-hover:text-[#1E5B49] md:text-3xl">
                    {featured.title}
                  </h3>
                  <p className="mt-3 line-clamp-3 text-[15px] leading-relaxed text-[#5C554A]">
                    {excerpt(featured.body_md, 130)}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#C6572E]">
                    この本の要点を読む <span aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            )}

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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/blog-mark.png" alt="栞" className="h-12 w-12 rounded-lg object-cover shadow-sm" />
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
