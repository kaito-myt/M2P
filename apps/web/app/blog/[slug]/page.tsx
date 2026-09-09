/**
 * ブログ記事 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 独立ブランド「栞 -SHIORI-」の記事ページ。名作・話題書のレビュー本文＋末尾で関連する
 * A2P 書籍へ導線する（他 SNS と同じ戦略）。一覧ページと同一のエディトリアル配色で統一。
 * 配色は共通クローム (components/storefront/chrome) と共有:
 *   paper #F5EFE1 / raised #FBF6EA / ink #221D18 / body #3B342B / caption #8B7E68 /
 *   line #E4DAC6 / green #1E5B49 / terracotta #B4471E / dark #171310
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

import { PseudoCover, SiteFooter, SiteHeader } from '@/components/storefront/chrome';
import { STOREFRONT_URL } from '@/lib/site';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

function plain(md: string, n = 140): string {
  return md.replace(/[#*_>`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function fmtDate(d: Date | null): string {
  return d ? new Date(d).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { title: true, body_md: true } });
  if (!post) return { title: '記事が見つかりません | 栞 -SHIORI-' };
  return {
    title: `${post.title} | 栞 -SHIORI-`,
    description: plain(post.body_md, 140),
    alternates: { canonical: `${STOREFRONT_URL}/blog/${slug}` },
    openGraph: { title: post.title, description: plain(post.body_md, 140), images: ['/blog-og.png'], type: 'article' },
  };
}

/** 軽量 Markdown → 要素変換 (見出し/箇条書き/段落/太字/リンク)。外部依存なし。 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2]) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-[#221D18]">
          {m[2]}
        </strong>,
      );
    } else if (m[4] && m[5]) {
      nodes.push(
        <a
          key={`${keyBase}-a${i}`}
          href={m[5]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#1E5B49] underline underline-offset-[3px] decoration-[#1E5B49]/40 transition-colors hover:decoration-[#1E5B49]"
        >
          {m[4]}
        </a>,
      );
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md: string) {
  const lines = md.split('\n');
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: number) => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} className="my-6 list-none space-y-2.5 pl-0">
        {list.map((li, i) => (
          <li
            key={i}
            className="relative pl-6 text-[1.02rem] leading-[1.95] text-[#3B342B] before:absolute before:left-0 before:top-[0.85em] before:h-px before:w-3.5 before:bg-[#1E5B49]"
          >
            {inline(li, `ul-${key}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^#{1,2}\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <h2
          key={idx}
          className="mt-14 mb-5 border-t border-[#E4DAC6] pt-7 font-serif text-[1.55rem] font-semibold leading-snug tracking-tight text-[#221D18]"
        >
          {line.replace(/^#{1,2}\s+/, '')}
        </h2>,
      );
    } else if (/^#{3,}\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <h3 key={idx} className="mt-9 mb-3 font-serif text-[1.2rem] font-semibold tracking-tight text-[#221D18]">
          {line.replace(/^#{3,}\s+/, '')}
        </h3>,
      );
    } else if (/^>\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <blockquote
          key={idx}
          className="my-8 border-l-2 border-[#B4471E] pl-6 font-serif text-[1.22rem] italic leading-[1.85] text-[#3B342B]"
        >
          {inline(line.replace(/^>\s+/, ''), `q-${idx}`)}
        </blockquote>,
      );
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim().length === 0) {
      flushList(idx);
    } else {
      flushList(idx);
      blocks.push(
        <p key={idx} className="my-5 text-[1.0625rem] leading-[1.95] text-[#3B342B]">
          {inline(line, `p-${idx}`)}
        </p>,
      );
    }
  });
  flushList(lines.length);
  return blocks;
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug } });
  if (!post || post.status !== 'published') notFound();

  // 関連 A2P 書籍 (記事末の導線)。
  let related: { title: string; asin: string | null; coverUrl: string | null } | null = null;
  if (post.book_id) {
    const b = await prisma.book.findUnique({
      where: { id: post.book_id },
      select: { title: true, asin: true, publish_status: true, covers: { where: { status: 'adopted' }, select: { r2_key: true }, take: 1 } },
    });
    if (b && b.publish_status === 'published' && b.asin) {
      const key = b.covers[0]?.r2_key;
      related = {
        title: b.title,
        asin: b.asin,
        coverUrl: key ? await getSignedDownloadUrl(key, 900).catch(() => null) : null,
      };
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#F5EFE1] text-[#221D18] antialiased">
      <SiteHeader nav={HEADER_NAV} width="max-w-3xl" />

      <main className="mx-auto w-full max-w-[42rem] flex-1 px-5 py-12 sm:px-6">
        <Link href="/blog" className="text-[13px] tracking-wide text-[#8B7E68] no-underline transition-colors hover:text-[#1E5B49]">
          ← レビュー一覧へ
        </Link>

        <article className="mt-8">
          {/* タイトルヘッダ (紹介書籍の実表紙があれば横に添える) */}
          <header className="grid grid-cols-1 items-center gap-7 border-b border-[#E4DAC6] pb-8 sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-9">
            <div>
              <p className="font-display text-[13px] italic tracking-wide text-[#B4471E]">Book review</p>
              <h1 className="mt-4 font-serif text-[2rem] font-semibold leading-[1.28] tracking-tight text-[#221D18] md:text-[2.5rem]">
                {post.title}
              </h1>
              <p className="mt-5 text-[13px] tracking-wide text-[#8B7E68]">{fmtDate(post.published_at)}</p>
            </div>
            <figure className="order-first w-[132px] justify-self-start overflow-hidden bg-[#EBE3D0] shadow-[0_18px_36px_-22px_rgba(33,20,10,0.6)] sm:order-none sm:justify-self-end">
              <div className="aspect-[3/4] w-full overflow-hidden">
                {post.cover_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.cover_image_url} alt={post.title} className="h-full w-full object-cover" />
                ) : (
                  <PseudoCover title={post.title} seedKey={post.slug} />
                )}
              </div>
            </figure>
          </header>

          {/* 本文 */}
          <div className="mt-8">{renderMarkdown(post.body_md)}</div>
        </article>

        {/* 関連 A2P 書籍への導線 */}
        {related && (
          <aside className="mt-16 border-t border-[#E4DAC6] pt-10">
            <p className="font-display text-[12px] italic tracking-wide text-[#8B7E68]">Recommended</p>
            <h2 className="mt-2 font-serif text-[1.2rem] font-semibold tracking-tight text-[#221D18]">
              この記事を読んだあなたへ、次の一冊。
            </h2>
            <div className="mt-6 flex gap-6">
              <div className="w-24 shrink-0 overflow-hidden bg-[#EBE3D0] shadow-[0_14px_28px_-18px_rgba(33,20,10,0.55)]">
                <div className="aspect-[10/16] w-full overflow-hidden">
                  {related.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={related.coverUrl} alt={related.title} className="h-full w-full object-cover" />
                  ) : (
                    <PseudoCover title={related.title} compact />
                  )}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="font-serif text-[1.1rem] font-semibold leading-snug text-[#221D18]">{related.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#52493B]">Kindle Unlimited なら読み放題対象も。</p>
                <a
                  href={`https://www.amazon.co.jp/dp/${related.asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex w-fit items-center gap-2 rounded-[2px] bg-[#1E5B49] px-5 py-2.5 text-[13px] font-semibold tracking-wide text-[#F1E9D8] no-underline transition-colors hover:bg-[#164838]"
                >
                  Amazon で見る <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </aside>
        )}

        {/* 戻る導線 */}
        <div className="mt-14 border-t border-[#E4DAC6] pt-8">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 border-b border-[#221D18] pb-1 text-[13px] font-medium tracking-wide text-[#221D18] no-underline transition-colors hover:border-[#1E5B49] hover:text-[#1E5B49]"
          >
            ← ほかのレビューを読む
          </Link>
        </div>
      </main>

      <SiteFooter nav={FOOTER_NAV} width="max-w-3xl" />
    </div>
  );
}
