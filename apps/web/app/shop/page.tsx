/**
 * 書籍カタログ (公開ページ) — SNS プロフィールのリンク先 (link in bio) 兼 公式サイト。
 * 出版済み書籍を表紙付きで並べ、Amazon 購入ページへ導線する。未認証で閲覧可。
 *
 * ブログ「栞 -SHIORI-」と同一のエディトリアルなテイストで統一した「栞の本棚」。
 * ブランドヘッダ・コンセプト・カタログ・About・フッタ(法務リンク)を備えた
 * 1 枚完結の公式サイトとして構成する (TikTok 等の審査で要求される作り込み)。
 * 配色は A2P デザイントークンに依存せず当ブランド独自:
 *   paper #F7F1E3 / ink #1B1714 / green #1E5B49 / terracotta #C6572E / line #E6DECB
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '栞の本棚 | 栞 -SHIORI-',
  description:
    '栞 -SHIORI- が制作・出版した Kindle 書籍の本棚です。実用書・ビジネス書・自己啓発を中心に、要点がすっと入ってくる読みやすい電子書籍をお届けしています。Kindle Unlimited 対象も。',
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

export default async function BooksLandingPage() {
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

  return (
    <div className="flex min-h-screen flex-col bg-[#F7F1E3] text-[#1B1714] antialiased">
      {/* ── ヘッダ ── */}
      <header className="sticky top-0 z-20 border-b border-[#E6DECB] bg-[#F7F1E3]/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <Link href="/blog" className="flex items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/blog-mark.png" alt="栞 -SHIORI-" className="h-8 w-8 rounded-md object-cover" />
            <span className="flex items-baseline gap-1.5">
              <span className="font-serif text-xl font-bold tracking-tight text-[#1B1714]">栞</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.4em] text-[#C6572E]">SHIORI</span>
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-[#5C554A]">
            <Link href="/blog" className="no-underline transition-colors hover:text-[#1E5B49]">
              レビュー
            </Link>
            <a href="#books" className="no-underline transition-colors hover:text-[#1E5B49]">
              本棚
            </a>
            <a href="#about" className="no-underline transition-colors hover:text-[#1E5B49]">
              栞について
            </a>
          </nav>
        </div>
      </header>

      {/* ── ヒーロー (ダーク・コンセプト) ── */}
      <section className="w-full bg-[#141210] text-[#F3ECDC]">
        <div className="mx-auto max-w-5xl px-5 py-16 text-center md:py-20">
          <div className="mb-6 flex items-center justify-center gap-3">
            <span className="inline-block h-px w-8 bg-[#C6572E]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#C6572E]">
              Bookshelf — 栞の本棚
            </span>
            <span className="inline-block h-px w-8 bg-[#C6572E]" />
          </div>
          <h1 className="font-serif text-4xl font-bold leading-[1.2] tracking-tight text-[#F3ECDC] md:text-5xl">
            読んで役立つ一冊を、あなたに。
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-[1.9] text-[#C9C1B1]">
            栞 -SHIORI- は、良書の要点を紹介するブックジャーナルであると同時に、
            実用書・ビジネス書・自己啓発を中心に <strong className="font-semibold text-[#F3ECDC]">Kindle 電子書籍</strong>を
            制作・出版しているレーベルです。日々の仕事や暮らしにすぐ活かせる、
            要点がすっと入ってくる本づくりを心がけています。
          </p>
          <a
            href="#books"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#C6572E] px-6 py-2.5 text-sm font-semibold text-[#F3ECDC] no-underline transition-colors hover:bg-[#a8461f]"
          >
            本棚を見る <span aria-hidden>↓</span>
          </a>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-14">
        {/* ── 書籍カタログ ── */}
        <section id="books" className="scroll-mt-20">
          <div className="mb-8 flex items-end justify-between">
            <h2 className="font-serif text-2xl font-bold text-[#1B1714]">出版書籍一覧</h2>
            <span className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A45]">Books</span>
          </div>
          {items.length === 0 ? (
            <p className="py-16 text-center text-[#8B8577]">現在ご紹介できる書籍はまだありません。まもなく公開します。</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((b) => (
                <li key={b.id}>
                  <a
                    href={amazonUrl(b.asin as string)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col no-underline"
                  >
                    <div className="overflow-hidden rounded-sm bg-[#EFE7D4] shadow-[0_12px_30px_-16px_rgba(0,0,0,0.5)] transition-shadow duration-300 group-hover:shadow-[0_20px_44px_-16px_rgba(0,0,0,0.55)]">
                      {b.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={b.coverUrl}
                          alt={b.title}
                          className="aspect-[10/16] w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                        />
                      ) : (
                        <div className="flex aspect-[10/16] w-full items-center justify-center font-serif text-3xl text-[#1E5B49]">
                          栞
                        </div>
                      )}
                    </div>
                    <h3 className="mt-3 line-clamp-3 font-serif text-[15px] font-bold leading-snug text-[#1B1714] transition-colors group-hover:text-[#1E5B49]">
                      {b.title}
                    </h3>
                    {b.subtitle && <p className="mt-1 line-clamp-2 text-xs text-[#8B8577]">{b.subtitle}</p>}
                    <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#C6572E]">
                      Amazon で見る <span aria-hidden>→</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 栞について ── */}
        <section
          id="about"
          className="mt-16 scroll-mt-20 overflow-hidden rounded-lg border border-[#E6DECB] bg-[#FCF8EE] shadow-[0_12px_36px_-22px_rgba(0,0,0,0.35)]"
        >
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
            <div className="flex items-center justify-center bg-[#EFE7D4] p-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/blog-mark.png" alt="栞 -SHIORI-" className="h-28 w-28 rounded-xl object-cover shadow-md" />
            </div>
            <div className="p-7 md:p-9">
              <h2 className="font-serif text-2xl font-bold text-[#1B1714]">栞 -SHIORI- について</h2>
              <p className="mt-4 leading-[1.9] text-[#5C554A]">
                栞 -SHIORI- は、実用書・ビジネス書・自己啓発ジャンルを中心に、読者の課題解決に役立つ
                Kindle 電子書籍を企画・制作・出版しているレーベルであり、良書の要点を紹介するブックジャーナルです。
                「読む前に価値がわかる」レビューと、「要点がすっと入ってくる」書籍の両方で、
                あなたの読書習慣を後押しします。
              </p>
              <p className="mt-3 text-sm text-[#8B8577]">
                ご感想・お問い合わせは{' '}
                <a href="mailto:info@festal-inc.com" className="text-[#1E5B49] underline underline-offset-2 hover:no-underline">
                  info@festal-inc.com
                </a>{' '}
                までお気軽にどうぞ。
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── フッタ ── */}
      <footer className="w-full bg-[#141210] text-[#B9B2A4]">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-5 py-8 text-sm sm:flex-row sm:justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-xl font-bold text-[#F3ECDC]">栞</span>
            <span className="text-[10px] uppercase tracking-[0.35em] text-[#C6572E]">SHIORI</span>
            <span className="ml-2 text-xs text-[#7A7469]">© {new Date().getFullYear()} 良書の要点ブログ</span>
          </div>
          <nav className="flex items-center gap-5 text-xs">
            <Link href="/blog" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">レビュー</Link>
            <a href="#books" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">本棚</a>
            <Link href="/legal/privacy" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">プライバシー</Link>
            <Link href="/legal/terms" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">利用規約</Link>
            <a href="mailto:info@festal-inc.com" className="text-[#B9B2A4] no-underline hover:text-[#F3ECDC]">お問い合わせ</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
