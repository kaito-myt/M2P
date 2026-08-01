/**
 * 所有ブログ 記事 (F-052b) — 公開ページ (未認証で閲覧可)。
 *
 * 名作・話題書のレビュー本文＋末尾で関連する A2P 書籍へ導線する（他 SNS と同じ戦略）。
 * /shop と同一ブランドのヘッダ/フッタで統一。
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { title: true, body_md: true } });
  if (!post) return { title: '記事が見つかりません' };
  return {
    title: `${post.title} | A2P Books Journal`,
    description: plain(post.body_md, 140),
    openGraph: { title: post.title, description: plain(post.body_md, 140), images: ['/logo-mark.png'] },
  };
}

/** 軽量 Markdown → 要素変換 (見出し/箇条書き/段落/太字/リンク)。外部依存なし。 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  // **bold** と [label](url) を最小サポート。
  const nodes: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2]) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-charcoal">
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
          className="text-accent underline underline-offset-2 hover:no-underline"
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
      <ul key={`ul-${key}`} className="my-4 list-disc space-y-1 pl-6 text-charcoal-82">
        {list.map((li, i) => (
          <li key={i} className="leading-relaxed">{inline(li, `ul-${key}-${i}`)}</li>
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
        <h2 key={idx} className="mt-8 border-l-4 border-accent pl-3 text-xl font-bold text-charcoal">
          {line.replace(/^#{1,2}\s+/, '')}
        </h2>,
      );
    } else if (/^#{3,}\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <h3 key={idx} className="mt-6 text-lg font-semibold text-charcoal">
          {line.replace(/^#{3,}\s+/, '')}
        </h3>,
      );
    } else if (/^>\s+/.test(line)) {
      flushList(idx);
      blocks.push(
        <blockquote key={idx} className="my-4 border-l-4 border-border-warm bg-cream-light py-2 pl-4 text-charcoal-82 italic">
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
        <p key={idx} className="my-4 leading-[1.9] text-charcoal-82">
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
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="border-b border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link href="/blog" className="no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="A2P Books Journal" className="h-8 w-auto" />
          </Link>
          <nav className="flex items-center gap-4 text-caption text-muted">
            <Link href="/blog" className="hover:text-charcoal">記事一覧</Link>
            <Link href="/shop" className="hover:text-charcoal">書籍一覧</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <Link href="/blog" className="text-button-sm text-muted underline underline-offset-4 hover:no-underline">
          ← 記事一覧
        </Link>
        <article className="mt-4">
          <p className="text-caption font-medium uppercase tracking-widest text-accent">Book Review</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-charcoal">{post.title}</h1>
          <p className="mt-2 text-caption text-muted">
            {post.published_at ? new Date(post.published_at).toLocaleDateString('ja-JP') : ''}
          </p>
          <div className="mt-6">{renderMarkdown(post.body_md)}</div>
        </article>

        {/* 関連 A2P 書籍への導線 */}
        {related && (
          <aside className="mt-12 rounded-card border border-border-warm bg-cream-light p-5">
            <p className="mb-3 text-caption font-medium text-accent">この記事を読んだあなたへ — おすすめの一冊</p>
            <div className="flex gap-4">
              <div className="h-32 w-[86px] shrink-0 overflow-hidden rounded-default bg-charcoal-04">
                {related.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={related.coverUrl} alt={related.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-caption text-muted">表紙</div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h2 className="text-button-sm font-bold text-charcoal">{related.title}</h2>
                <p className="text-caption text-muted">Kindle Unlimited なら読み放題対象も。</p>
                <a
                  href={`https://www.amazon.co.jp/dp/${related.asin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex w-fit items-center rounded-card bg-accent px-3 py-1.5 text-caption font-medium text-cream-light hover:opacity-80"
                >
                  Amazon で見る →
                </a>
              </div>
            </div>
          </aside>
        )}
      </main>

      <footer className="border-t border-border-warm bg-cream-light">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-5 py-6 text-caption text-muted sm:flex-row sm:justify-between">
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
