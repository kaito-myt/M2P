/**
 * ブログ記事 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 独立ブランド「栞 -SHIORI-」の記事ページ。名作・話題書のレビュー本文＋末尾で関連する
 * A2P 書籍へ導線する（他 SNS と同じ戦略）。一覧ページと同一のエディトリアル配色で統一。
 * 配色: paper #F7F1E3 / ink #1B1714 / green #1E5B49 / terracotta #C6572E / line #E6DECB
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage';

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { title: true, body_md: true } });
  if (!post) return { title: '記事が見つかりません | 栞 -SHIORI-' };
  return {
    title: `${post.title} | 栞 -SHIORI-`,
    description: plain(post.body_md, 140),
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
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-[#1B1714]">
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
          className="text-[#1E5B49] underline underline-offset-2 hover:no-underline"
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
      <ul key={`ul-${key}`} className="my-5 list-none space-y-2 pl-0">
        {list.map((li, i) => (
          <li key={i} className="relative pl-6 leading-[1.9] text-[#3A362F] before:absolute before:left-0 before:top-[0.7em] before:h-1.5 before:w-1.5 before:rounded-full before:bg-[#C6572E]">
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
        <h2 key={idx} className="mt-12 mb-4 flex items-center gap-3 font-serif text-2xl font-bold text-[#1B1714]">
          <span className="inline-block h-6 w-1 rounded-full bg-[#1E5B49]" />
          {line.replace(/^#{1,2}\s+/, '')}
        </h2>,
      );
    } else if (/^#{3,}\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <h3 key={idx} className="mt-8 mb-3 font-serif text-xl font-semibold text-[#1B1714]">
          {line.replace(/^#{3,}\s+/, '')}
        </h3>,
      );
    } else if (/^>\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <blockquote key={idx} className="my-6 rounded-r-sm border-l-4 border-[#C6572E] bg-[#EFE7D4] py-3 pl-5 pr-4 font-serif text-lg italic leading-relaxed text-[#3A362F]">
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
        <p key={idx} className="my-5 text-[17px] leading-[2] text-[#3A362F]">
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
    <div className="flex min-h-screen flex-col bg-[#F7F1E3] text-[#1B1714] antialiased">
      {/* ── ヘッダ ── */}
      <header className="sticky top-0 z-20 border-b border-[#E6DECB] bg-[#F7F1E3]/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/blog" className="flex items-baseline gap-2 no-underline">
            <span className="font-serif text-2xl font-bold tracking-tight text-[#1B1714]">栞</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.4em] text-[#C6572E]">SHIORI</span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-[#5C554A]">
            <Link href="/blog" className="no-underline hover:text-[#1E5B49]">記事一覧</Link>
            <Link href="/shop" className="no-underline hover:text-[#1E5B49]">書籍一覧</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">
        <Link href="/blog" className="text-sm text-[#8A6A45] no-underline transition-colors hover:text-[#1E5B49]">
          ← 記事一覧へ
        </Link>

        <article className="mt-6">
          {/* タイトルヘッダ */}
          <header className="border-b border-[#E6DECB] pb-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-block h-px w-8 bg-[#C6572E]" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#C6572E]">Book Review</span>
            </div>
            <h1 className="font-serif text-3xl font-bold leading-[1.25] tracking-tight text-[#1B1714] md:text-[2.6rem]">
              {post.title}
            </h1>
            <p className="mt-4 text-sm text-[#8B8577]">{fmtDate(post.published_at)}</p>
          </header>

          {/* 本文 */}
          <div className="mt-8">{renderMarkdown(post.body_md)}</div>
        </article>

        {/* 関連 A2P 書籍への導線 */}
        {related && (
          <aside className="mt-14 overflow-hidden rounded-sm border border-[#E6DECB] bg-[#FCF8EE] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.35)]">
            <div className="border-b border-[#E6DECB] bg-[#EFE7D4] px-6 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-[#1E5B49]">
                この記事を読んだあなたへ — おすすめの一冊
              </p>
            </div>
            <div className="flex gap-5 p-6">
              <div className="aspect-[10/16] w-24 shrink-0 overflow-hidden rounded-sm bg-[#EFE7D4] shadow-md">
                {related.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={related.coverUrl} alt={related.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-serif text-2xl text-[#1E5B49]">栞</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2 className="font-serif text-lg font-bold leading-snug text-[#1B1714]">{related.title}</h2>
                <p className="text-sm text-[#5C554A]">Kindle Unlimited なら読み放題対象も。</p>
                <a
                  href={`https://www.amazon.co.jp/dp/${related.asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-[#1E5B49] px-4 py-2 text-sm font-semibold text-[#F3ECDC] no-underline transition-colors hover:bg-[#164838]"
                >
                  Amazon で見る <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </aside>
        )}

        {/* 戻る導線 */}
        <div className="mt-12 border-t border-[#E6DECB] pt-8 text-center">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 rounded-full border border-[#1B1714] px-5 py-2 text-sm font-medium text-[#1B1714] no-underline transition-colors hover:bg-[#1B1714] hover:text-[#F7F1E3]"
          >
            ほかのレビューを読む
          </Link>
        </div>
      </main>

      {/* ── フッタ ── */}
      <footer className="w-full bg-[#141210] text-[#B9B2A4]">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-5 py-8 text-sm sm:flex-row sm:justify-between">
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
