/**
 * ブログ一覧 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 独立ブランド「栞 -SHIORI-」= 良書の要点を紹介するブックジャーナル。
 * A2P ブランドとは意図的に切り離し、読者向けの高いデザイン性(エディトリアル/マガジン風)で
 * 構成する。ファビコンは app/blog/icon.png (Next.js route-segment icon) で栞マークを使用。
 * 各記事末で関連する A2P 書籍へ導線する（他 SNS と同じ戦略）。
 *
 * 配色は共通クローム (components/storefront/chrome) と同じ栞ブランド独自パレット:
 *   paper #F5EFE1 / raised #FBF6EA / ink #221D18 / body #52493B / caption #8B7E68 /
 *   line #E4DAC6 / green #1E5B49 / terracotta #B4471E / dark #171310 / gold #D8A15E
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { genreLabel, type Genre } from '@a2p/contracts/agents';
import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

import { PseudoCover, SectionHeading, SiteFooter, SiteHeader } from '@/components/storefront/chrome';
import { STOREFRONT_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '栞 -SHIORI- | 実用書・ビジネス書・名作を“要点”で紹介するブックレビュー',
  description:
    '実用書・ビジネス書・自己啓発、そして話題の名作を、〈要点〉をしぼって紹介するブックレビュー・ジャーナル「栞 -SHIORI-」。読む前に価値がわかるレビューを毎日お届けします。',
  alternates: { canonical: `${STOREFRONT_URL}/blog` },
  openGraph: {
    title: '栞 -SHIORI- | 良書を“要点”で紹介するブックレビュー・ジャーナル',
    description: '実用書・ビジネス書・自己啓発・名作を、要点だけで紹介するブックレビュー。読む前に価値がわかる。',
    images: ['/blog-og.png'],
    type: 'website',
  },
};

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
    select: { slug: true, title: true, published_at: true, body_md: true, book_id: true, cover_image_url: true },
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
      // 自社本の書影(R2)を最優先、無ければ book_cover resolver が引き当てた実書籍の表紙 URL。
      const coverUrl = (key ? await getSignedDownloadUrl(key, 900).catch(() => null) : null) ?? p.cover_image_url ?? null;
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

/**
 * 記事カバー: 実書影 (coverUrl) があれば書影を、無ければ書名/ジャンルから起こした
 * 装丁風の擬似カバー (PseudoCover) を全面表示する。親が aspect を決める。
 */
function Cover({ post, hoverScale = 'group-hover:scale-[1.04]', compact }: { post: PostView; hoverScale?: string; compact?: boolean }) {
  if (post.coverUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={post.coverUrl}
        alt={post.title}
        className={`h-full w-full object-cover transition-transform duration-700 ${hoverScale}`}
      />
    );
  }
  return <PseudoCover title={post.title} genre={post.genre} seedKey={post.slug} compact={compact} />;
}

const HEADER_NAV = [
  { label: 'レビュー', href: '/blog' },
  { label: '本棚', href: '/shop' },
  { label: '栞について', href: '/shop#about' },
];
const FOOTER_NAV = [
  { label: '記事一覧', href: '/blog' },
  { label: '書籍一覧', href: '/shop' },
  { label: 'プライバシー', href: '/legal/privacy' },
  { label: '利用規約', href: '/legal/terms' },
];

export default async function BlogIndexPage() {
  const posts = await loadPosts();
  const [featured, ...rest] = posts;
  const leads = rest.slice(0, 2);
  const list = rest.slice(2);

  return (
    <div className="flex min-h-screen flex-col bg-[#F5EFE1] text-[#221D18] antialiased">
      <SiteHeader nav={HEADER_NAV} cta={{ label: '書籍一覧', href: '/shop' }} width="max-w-6xl" />

      {/* ── ヒーロー (dark・左寄せ・非対称) ── */}
      <section className="w-full bg-[#171310] text-[#F1E9D8]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 py-16 sm:px-6 md:grid-cols-[1.55fr_1fr] md:gap-16 md:py-24">
          <div>
            <p className="font-display text-[13px] italic tracking-wide text-[#D8A15E]">Book review journal</p>
            <h1 className="mt-4 font-serif text-[2.6rem] font-semibold leading-[1.16] tracking-tight text-[#F4ECDB] md:text-[3.9rem]">
              良い本は、
              <br className="hidden sm:block" />
              <span className="text-[#E7B667]">要点</span>から始まる。
            </h1>
            <p className="mt-6 max-w-xl text-[17px] font-medium leading-[1.85] text-[#EBE1CC] md:text-[19px]">
              実用書・ビジネス書・自己啓発、そして話題の名作を
              <br className="hidden md:block" />
              〈要点〉だけで紹介する、ブックレビュー・ジャーナル。
            </p>
            <p className="mt-4 max-w-xl text-[14.5px] leading-[1.95] text-[#A79D8B]">
              積ん読が増える毎日でも、良書との出会いはあきらめない。1記事5分、「読んだ気」で終わらせず、
              明日から使える学びをひとつ持ち帰る——それが <strong className="font-semibold text-[#D8C7A6]">栞 -SHIORI-</strong> です。
            </p>
            <p className="mt-5 text-[12px] tracking-[0.14em] text-[#8A8069]">
              実用書 &middot; ビジネス書 &middot; 自己啓発 &middot; 話題の名作
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-7">
              <Link
                href={featured ? `/blog/${featured.slug}` : '/blog'}
                className="inline-flex items-center gap-2 rounded-[2px] bg-[#B4471E] px-7 py-3.5 text-[14px] font-semibold tracking-wide text-[#F4ECDB] no-underline transition-colors hover:bg-[#973914]"
              >
                {featured ? '最新のレビューを読む' : 'レビュー一覧を見る'} <span aria-hidden>→</span>
              </Link>
              <Link
                href="/shop"
                className="border-b border-[#4A4034] pb-1 text-[13px] tracking-wide text-[#C7BCA6] no-underline transition-colors hover:border-[#D8A15E] hover:text-[#F4ECDB]"
              >
                出版書籍を見る
              </Link>
            </div>
          </div>

          {/* 装丁カバーを重ねた書架モンタージュ (脱AI: グロー/リング不使用、実書影 or 擬似カバー) */}
          {featured ? (
            <figure className="justify-self-center md:justify-self-end">
              <div className="relative mx-auto w-[min(78vw,320px)]">
                {leads[0] && (
                  <div className="absolute -right-[3%] top-8 w-[62%] rotate-[7deg] overflow-hidden border border-[#2E2820] bg-[#EBE3D0] shadow-[0_22px_48px_-26px_rgba(0,0,0,0.95)]">
                    <div className="aspect-[3/4] w-full overflow-hidden">
                      <Cover post={leads[0]} hoverScale="" />
                    </div>
                  </div>
                )}
                <div className="relative mx-auto w-[74%] -rotate-[3deg] overflow-hidden border border-[#2E2820] bg-[#EBE3D0] shadow-[0_28px_58px_-26px_rgba(0,0,0,1)]">
                  <div className="aspect-[3/4] w-full overflow-hidden">
                    <Cover post={featured} hoverScale="" />
                  </div>
                </div>
              </div>
              <figcaption className="mt-7 text-center font-display text-[12px] italic tracking-wide text-[#8A8577]">
                今日の一冊 — today&rsquo;s pick
              </figcaption>
            </figure>
          ) : (
            <figure className="justify-self-center md:justify-self-end">
              <div className="border border-[#3A332A] bg-[#F1E9D8] p-2.5 shadow-[0_18px_45px_-24px_rgba(0,0,0,0.85)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/blog-mark-source.png" alt="栞 -SHIORI- のシンボル" className="aspect-square w-48 object-cover md:w-60" />
              </div>
              <figcaption className="mt-3 text-center font-display text-[12px] italic tracking-wide text-[#8A8577]">
                栞 — a bookmark for good books
              </figcaption>
            </figure>
          )}
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-6">
        {posts.length === 0 ? (
          <p className="py-24 text-center text-[#8B7E68]">まもなく記事を公開します。</p>
        ) : (
          <>
            {/* ── 今日の一冊 (Cover story) ── */}
            {featured && (
              <section className="border-b border-[#E4DAC6] py-14 md:py-16">
                <SectionHeading jp="今日の一冊" label="Cover story" />
                <Link
                  href={`/blog/${featured.slug}`}
                  className="group mt-9 grid grid-cols-1 gap-8 no-underline md:grid-cols-[minmax(0,300px)_1fr] md:gap-12"
                >
                  <div className="w-full max-w-[300px] overflow-hidden bg-[#EBE3D0] shadow-[0_20px_40px_-24px_rgba(33,20,10,0.6)]">
                    <div className="aspect-[3/4] w-full overflow-hidden">
                      <Cover post={featured} hoverScale="group-hover:scale-[1.03]" />
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div className="flex items-center gap-3 text-[12px] tracking-wide text-[#8B7E68]">
                      {featured.genre && <span className="font-semibold text-[#1E5B49]">{featured.genre}</span>}
                      <span>{fmtDate(featured.published_at)}</span>
                    </div>
                    <h3 className="mt-3 font-serif text-[1.75rem] font-semibold leading-[1.3] tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49] md:text-[2.3rem]">
                      {featured.title}
                    </h3>
                    <p className="mt-4 max-w-xl text-[15px] leading-[1.95] text-[#52493B]">{excerpt(featured.body_md, 140)}</p>
                    <span className="mt-6 inline-flex w-fit items-center gap-2 border-b border-[#B4471E] pb-1 text-[13px] font-semibold text-[#B4471E]">
                      この本の要点を読む
                    </span>
                  </div>
                </Link>
              </section>
            )}

            {/* ── 最新のレビュー ── */}
            {(leads.length > 0 || list.length > 0) && (
              <section className="py-14 md:py-16">
                <SectionHeading jp="最新のレビュー" label="Latest reviews" />

                {/* 中段: 書影付きの 2 本立て */}
                {leads.length > 0 && (
                  <div className="mt-9 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-10">
                    {leads.map((p) => (
                      <Link key={p.slug} href={`/blog/${p.slug}`} className="group flex flex-col no-underline">
                        <div className="overflow-hidden bg-[#EBE3D0] shadow-[0_16px_34px_-22px_rgba(33,20,10,0.5)]">
                          <div className="aspect-[4/5] w-full overflow-hidden">
                            <Cover post={p} />
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-3 text-[11px] tracking-wide text-[#8B7E68]">
                          {p.genre && <span className="font-semibold text-[#1E5B49]">{p.genre}</span>}
                          <span>{fmtDate(p.published_at)}</span>
                        </div>
                        <h3 className="mt-1.5 font-serif text-[1.35rem] font-semibold leading-snug tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49]">
                          {p.title}
                        </h3>
                        <p className="mt-2 text-[14px] leading-relaxed text-[#52493B] line-clamp-2">{excerpt(p.body_md, 96)}</p>
                      </Link>
                    ))}
                  </div>
                )}

                {/* 下段: 目次のように詰めたインデックス (番号 + 小さな書影) */}
                {list.length > 0 && (
                  <ol className="mt-12 border-t border-[#E4DAC6]">
                    {list.map((p, i) => (
                      <li key={p.slug} className="border-b border-[#E4DAC6]">
                        <Link
                          href={`/blog/${p.slug}`}
                          className="group grid grid-cols-[auto_1fr] items-center gap-5 py-6 no-underline sm:grid-cols-[auto_1fr_auto]"
                        >
                          <span className="font-display text-[15px] tabular-nums text-[#B4471E]">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-3 text-[11px] tracking-wide text-[#8B7E68]">
                              {p.genre && <span className="font-semibold text-[#1E5B49]">{p.genre}</span>}
                              <span>{fmtDate(p.published_at)}</span>
                            </div>
                            <h3 className="mt-1 font-serif text-[1.15rem] font-semibold leading-snug tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49]">
                              {p.title}
                            </h3>
                            <p className="mt-1 hidden text-[13px] leading-relaxed text-[#6F665A] line-clamp-1 sm:block">
                              {excerpt(p.body_md, 80)}
                            </p>
                          </div>
                          <div className="hidden w-14 shrink-0 overflow-hidden bg-[#EBE3D0] sm:block">
                            <div className="aspect-[3/4] w-full overflow-hidden">
                              <Cover post={p} hoverScale="group-hover:scale-[1.05]" compact />
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {/* ── 書籍導線バンド ── */}
      <section className="w-full border-t border-[#E4DAC6] bg-[#FBF6EA]">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-5 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <p className="font-display text-[12px] italic tracking-wide text-[#8B7E68]">Read next</p>
            <h2 className="mt-2 font-serif text-[1.6rem] font-semibold tracking-tight text-[#221D18]">読んだあとは、次の一冊へ。</h2>
            <p className="mt-3 text-[14px] leading-[1.9] text-[#52493B]">
              レビューで紹介する名作に加え、要点をぎゅっとまとめた電子書籍もお届けしています。Kindle Unlimited 対象も。
            </p>
          </div>
          <Link
            href="/shop"
            className="shrink-0 rounded-[2px] bg-[#1E5B49] px-6 py-3 text-[13px] font-semibold tracking-wide text-[#F1E9D8] no-underline transition-colors hover:bg-[#164838]"
          >
            出版書籍を見る
          </Link>
        </div>
      </section>

      <SiteFooter nav={FOOTER_NAV} width="max-w-6xl" />
    </div>
  );
}
