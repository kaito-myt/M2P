/**
 * 書籍カタログ (公開ページ) — SNS プロフィールのリンク先 (link in bio) 兼 公式サイト。
 * 出版済み書籍を表紙付きで並べ、Amazon 購入ページへ導線する。未認証で閲覧可。
 *
 * TikTok 等の審査で「外部公開サイトが十分に作り込まれていること(ランディング/ログイン
 * だけでないこと)」が要求されるため、ブランドヘッダ・紹介文・カタログ・フッタ(法務リンク)
 * を備えた 1 枚完結の公式サイトとして構成する。ブラウザ favicon (app/icon.png) と
 * ヘッダロゴ (logo-mark.png) は同一ブランド(A2P)で統一する。
 */
import type { Metadata } from 'next';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'A2P Books — 出版書籍一覧',
  description:
    'A2P が出版した Kindle 書籍の一覧です。実用書・ビジネス書・自己啓発を中心に、読みやすい電子書籍をお届けしています。気になる一冊を Amazon（Kindle）でどうぞ。',
  openGraph: {
    title: 'A2P Books — 出版書籍一覧',
    description: 'A2P が出版した Kindle 書籍の一覧。実用書・ビジネス書・自己啓発を中心にお届けしています。',
    images: ['/logo-mark.png'],
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
    <div className="flex min-h-screen flex-col bg-cream">
      {/* ブランドヘッダ */}
      <header className="border-b border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="A2P — Amazon Auto Publisher" className="h-9 w-auto" />
          <nav className="flex items-center gap-4 text-caption text-muted">
            <a href="#books" className="hover:text-charcoal">
              書籍一覧
            </a>
            <a href="#about" className="hover:text-charcoal">
              A2Pについて
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        {/* ヒーロー */}
        <section className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-charcoal">読んで役立つ一冊を、あなたに。</h1>
          <p className="max-w-2xl text-body text-muted">
            A2P は、実用書・ビジネス書・自己啓発を中心に Kindle 電子書籍を出版しています。
            日々の仕事や暮らしにすぐ活かせる、読みやすい本づくりを心がけています。
            気になる一冊を Amazon（Kindle）でお楽しみください。Kindle Unlimited なら読み放題対象の書籍も。
          </p>
        </section>

        {/* 書籍カタログ */}
        <section id="books" className="mt-12 scroll-mt-20">
          <h2 className="mb-5 text-xl font-bold text-charcoal">出版書籍一覧</h2>
          {items.length === 0 ? (
            <p className="py-12 text-center text-muted">現在ご紹介できる書籍はまだありません。まもなく公開します。</p>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {items.map((b) => (
                <li
                  key={b.id}
                  className="flex gap-4 rounded-card border border-border-warm bg-cream-light p-4 shadow-l1"
                >
                  <div className="h-32 w-[86px] shrink-0 overflow-hidden rounded-default bg-charcoal-04">
                    {b.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.coverUrl} alt={b.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-caption text-muted">
                        表紙
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="line-clamp-3 text-button-sm font-bold text-charcoal">{b.title}</h3>
                    {b.subtitle && <p className="line-clamp-2 text-caption text-muted">{b.subtitle}</p>}
                    <a
                      href={amazonUrl(b.asin as string)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-auto inline-flex w-fit items-center rounded-card bg-accent px-3 py-1.5 text-caption font-medium text-cream-light hover:opacity-80"
                    >
                      Amazon で見る →
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* A2Pについて */}
        <section id="about" className="mt-14 scroll-mt-20 rounded-card border border-border-warm bg-cream-light p-6">
          <h2 className="mb-3 text-xl font-bold text-charcoal">A2Pについて</h2>
          <p className="text-body text-muted">
            A2P（Amazon Auto Publisher）は、実用書・ビジネス書・自己啓発ジャンルを中心に、
            読者の課題解決に役立つ Kindle 電子書籍を企画・制作・出版している個人出版レーベルです。
            SNS では新刊情報や本の要点をお届けしています。ご感想・お問い合わせは下記メールまでお気軽にどうぞ。
          </p>
          <p className="mt-3 text-caption text-muted">
            お問い合わせ:{' '}
            <a href="mailto:info@festal-inc.com" className="text-accent hover:underline">
              info@festal-inc.com
            </a>
          </p>
        </section>
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
            <a href="/legal/privacy" className="hover:text-charcoal">
              プライバシーポリシー
            </a>
            <a href="/legal/terms" className="hover:text-charcoal">
              利用規約
            </a>
            <a href="mailto:info@festal-inc.com" className="hover:text-charcoal">
              お問い合わせ
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
