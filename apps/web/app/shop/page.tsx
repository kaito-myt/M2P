/**
 * 書籍カタログ (公開ページ) — SNS プロフィールのリンク先 (link in bio) 兼 公式サイト。
 * 出版済み書籍を表紙付きで並べ、Amazon 購入ページへ導線する。未認証で閲覧可。
 *
 * ブログ「栞 -SHIORI-」と同一のエディトリアルなテイストで統一した「栞の本棚」。
 * ブランドヘッダ・コンセプト・カタログ・About・フッタ(法務リンク)を備えた
 * 1 枚完結の公式サイトとして構成する (TikTok 等の審査で要求される作り込み)。
 * 配色は共通クローム (components/storefront/chrome) と共有:
 *   paper #F5EFE1 / raised #FBF6EA / ink #221D18 / body #52493B / caption #8B7E68 /
 *   line #E4DAC6 / green #1E5B49 / terracotta #B4471E / dark #171310 / gold #D8A15E
 */
import type { Metadata } from 'next';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

import { PseudoCover, RelatedNoteArticles, SectionHeading, SiteFooter, SiteHeader } from '@/components/storefront/chrome';
import { loadRelatedNoteArticles } from '@/lib/related-note-articles';
import { STOREFRONT_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '栞の本棚 | 栞 -SHIORI-',
  description:
    '栞 -SHIORI- が制作・出版した Kindle 書籍の本棚です。実用書・ビジネス書・自己啓発を中心に、要点がすっと入ってくる読みやすい電子書籍をお届けしています。Kindle Unlimited 対象も。',
  // 検索結果を管理ツールのルート(/=認証で /dashboard へ転送)ではなく本棚 /shop 自体に向ける。
  // 栞専用ドメインが有効ならそちらを正規 URL にする。
  alternates: { canonical: `${STOREFRONT_URL}/shop` },
  openGraph: {
    title: '栞の本棚 | 栞 -SHIORI-',
    description: '栞 -SHIORI- が制作・出版した Kindle 書籍の本棚。実用書・ビジネス書・自己啓発を中心に。',
    images: ['/blog-og.png'],
    type: 'website',
  },
};

function amazonUrl(asin: string): string {
  return `https://www.amazon.co.jp/dp/${asin}`;
}

const HEADER_NAV = [
  { label: 'レビュー', href: '/blog' },
  { label: '本棚', href: '#books' },
  { label: '栞について', href: '#about' },
];
const FOOTER_NAV = [
  { label: 'レビュー', href: '/blog' },
  { label: '本棚', href: '#books' },
  { label: 'プライバシー', href: '/legal/privacy' },
  { label: '利用規約', href: '/legal/terms' },
  { label: 'お問い合わせ', href: 'mailto:kaito.myt@gmail.com' },
];

export default async function BooksLandingPage() {
  const relatedNoteArticles = await loadRelatedNoteArticles(3);
  const books = await prisma.book.findMany({
    where: { publish_status: 'published', asin: { not: null } },
    orderBy: [{ updated_at: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      subtitle: true,
      asin: true,
      covers: { where: { status: 'adopted' }, select: { r2_key: true }, take: 1 },
    },
  });

  const items = await Promise.all(
    books.map(async (b) => {
      const key = b.covers[0]?.r2_key;
      const coverUrl = key ? await getSignedDownloadUrl(key, 900).catch(() => null) : null;
      return { ...b, coverUrl };
    }),
  );

  const [lead, ...gridItems] = items;

  return (
    <div className="flex min-h-screen flex-col bg-[#F5EFE1] text-[#221D18] antialiased">
      <SiteHeader nav={HEADER_NAV} cta={{ label: 'レビューを読む', href: '/blog' }} width="max-w-5xl" />

      {/* ── ヒーロー (dark・左寄せ・非対称) ── */}
      <section className="w-full bg-[#171310] text-[#F1E9D8]">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 md:py-20">
          <div className="max-w-2xl">
            <p className="font-display text-[13px] italic tracking-wide text-[#D8A15E]">The bookshelf</p>
            <h1 className="mt-5 font-serif text-[2.3rem] font-semibold leading-[1.24] tracking-tight text-[#F4ECDB] md:text-[3rem]">
              読んで役立つ一冊を、あなたに。
            </h1>
            <p className="mt-6 text-[15px] leading-[1.95] text-[#C7BCA6]">
              栞 -SHIORI- は、良書の要点を紹介するブックジャーナルであると同時に、実用書・ビジネス書・自己啓発を中心に
              <strong className="font-semibold text-[#F1E9D8]"> Kindle 電子書籍</strong>を制作・出版しているレーベルです。
              日々の仕事や暮らしにすぐ活かせる、要点がすっと入ってくる本づくりを心がけています。
            </p>
            <a
              href="#books"
              className="mt-9 inline-flex items-center gap-2 rounded-[2px] bg-[#B4471E] px-6 py-3 text-[13px] font-semibold tracking-wide text-[#F4ECDB] no-underline transition-colors hover:bg-[#973914]"
            >
              本棚を見る <span aria-hidden>↓</span>
            </a>
          </div>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-14 sm:px-6 md:py-16">
        {/* ── 書籍カタログ ── */}
        <section id="books" className="scroll-mt-24">
          <SectionHeading jp="出版書籍" label="Books" />

          {items.length === 0 ? (
            <p className="py-20 text-center text-[#8B7E68]">現在ご紹介できる書籍はまだありません。まもなく公開します。</p>
          ) : (
            <>
              {/* 最新の一冊を大きく (誌面のリズム) */}
              {lead && (
                <a
                  href={amazonUrl(lead.asin as string)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${lead.title} を Amazon で見る`}
                  className="group mt-9 grid grid-cols-1 gap-8 no-underline sm:grid-cols-[minmax(0,220px)_1fr] sm:gap-10"
                >
                  <div className="w-full max-w-[220px] overflow-hidden bg-[#EBE3D0] shadow-[0_18px_36px_-22px_rgba(33,20,10,0.6)] transition-transform duration-500 group-hover:-translate-y-1">
                    <div className="aspect-[10/16] w-full overflow-hidden">
                      {lead.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={lead.coverUrl} alt={lead.title} className="h-full w-full object-cover" />
                      ) : (
                        <PseudoCover title={lead.title} seedKey={lead.id} />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <p className="font-display text-[12px] italic tracking-wide text-[#8B7E68]">Latest release</p>
                    <h3 className="mt-2 font-serif text-[1.6rem] font-semibold leading-snug tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49] md:text-[2rem]">
                      {lead.title}
                    </h3>
                    {lead.subtitle && <p className="mt-3 max-w-lg text-[15px] leading-[1.9] text-[#52493B]">{lead.subtitle}</p>}
                    <span className="mt-6 inline-flex w-fit items-center gap-2 rounded-[2px] bg-[#1E5B49] px-5 py-2.5 text-[13px] font-semibold tracking-wide text-[#F1E9D8]">
                      Amazon で見る
                    </span>
                  </div>
                </a>
              )}

              {/* 残りを書棚のように並べる */}
              {gridItems.length > 0 && (
                <ul className="mt-14 grid grid-cols-2 gap-x-6 gap-y-12 sm:grid-cols-3 lg:grid-cols-4">
                  {gridItems.map((b) => (
                    <li key={b.id}>
                      <a
                        href={amazonUrl(b.asin as string)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${b.title} を Amazon で見る`}
                        className="group flex h-full flex-col no-underline"
                      >
                        <div className="overflow-hidden bg-[#EBE3D0] shadow-[0_14px_28px_-18px_rgba(33,20,10,0.55)] transition-transform duration-500 group-hover:-translate-y-1">
                          <div className="aspect-[10/16] w-full overflow-hidden">
                            {b.coverUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={b.coverUrl} alt={b.title} className="h-full w-full object-cover" />
                            ) : (
                              <PseudoCover title={b.title} seedKey={b.id} />
                            )}
                          </div>
                        </div>
                        <h3 className="mt-3 line-clamp-3 font-serif text-[14px] font-semibold leading-snug tracking-tight text-[#221D18] transition-colors group-hover:text-[#1E5B49]">
                          {b.title}
                        </h3>
                        {b.subtitle && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#8B7E68]">{b.subtitle}</p>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        <RelatedNoteArticles articles={relatedNoteArticles} />

        {/* ── 栞について ── */}
        <section id="about" className="mt-20 scroll-mt-24 border-t border-[#E4DAC6] pt-14">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-[1fr_1.5fr] md:gap-14">
            <div>
              <div className="w-fit border border-[#E4DAC6] bg-[#FBF6EA] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/blog-mark.png" alt="栞 -SHIORI-" className="h-24 w-24 object-cover" />
              </div>
              <p className="mt-4 font-display text-[12px] italic tracking-wide text-[#8B7E68]">
                栞 — a bookmark for good books
              </p>
            </div>
            <div>
              <p className="font-display text-[12px] italic tracking-wide text-[#B4471E]">About</p>
              <h2 className="mt-2 font-serif text-[1.7rem] font-semibold tracking-tight text-[#221D18]">栞 -SHIORI- について</h2>
              <p className="mt-5 text-[15px] leading-[1.95] text-[#52493B]">
                栞 -SHIORI- は、実用書・ビジネス書・自己啓発ジャンルを中心に、読者の課題解決に役立つ Kindle 電子書籍を企画・制作・出版している
                レーベルであり、良書の要点を紹介するブックジャーナルです。「読む前に価値がわかる」レビューと、「要点がすっと入ってくる」書籍の
                両方で、あなたの読書習慣を後押しします。
              </p>
              <p className="mt-4 text-[13px] leading-relaxed text-[#8B7E68]">
                ご感想・お問い合わせは{' '}
                <a
                  href="mailto:kaito.myt@gmail.com"
                  className="text-[#1E5B49] underline underline-offset-[3px] decoration-[#1E5B49]/40 transition-colors hover:decoration-[#1E5B49]"
                >
                  kaito.myt@gmail.com
                </a>{' '}
                までお気軽にどうぞ。
              </p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter nav={FOOTER_NAV} width="max-w-5xl" />
    </div>
  );
}
