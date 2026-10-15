'use client';

/**
 * PostPreview — 告知投稿 1 件を「実際の見た目」で出すプレビューカード (F-ANP-32b)。
 *
 * 運営者要望 (2026-10-15)「投稿一覧は下に横幅いっぱいに表示させて。あと、Xっぽい見た目に
 * しないとプレビューにならないからよろしく」。
 *
 * それまでは本文を 140 字で切って改行も潰した 1 行の抜粋だったので、投稿前に中身を
 * 確かめる用途に使えなかった。ここでは **本文全文・改行保持**、ハッシュタグと URL の
 * 着色、アイコン/表示名/ハンドル、X のアクション行 (返信/リポスト/いいね/表示) まで出す。
 *
 * 画像は 2 系統:
 *   - `media_url` = 事前レンダリング済みメディア (TikTok 動画・IG カルーセル先頭等)
 *   - `article_eyecatch_url` = note 記事のアイキャッチ。X は URL だけの投稿にリンクカードを
 *     出すので、それを模した「リンクカード」として出す (X 用の販促画像は投稿時に生成される
 *     ため事前には存在しない — ここで出す画像は note 側の見え方)。
 */
import Link from 'next/link';
import { BarChart3, ExternalLink, Heart, MessageCircle, Repeat2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatJstShort } from '@/lib/datetime';
import { messages } from '@/lib/messages';
import type { NotePromotionChannel, PromotionPostView } from '@/lib/promotion-view';

const m = messages.promotion;

/** X のリンク色。本文中のハッシュタグ/URL/メンションをこの色にすると一気に「X っぽく」なる。 */
const X_LINK = 'text-[#1d9bf0]';

const STATUS_TONE: Record<string, string> = {
  posted: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
  queued: 'border-sky-200 bg-sky-50 text-sky-800',
  posting: 'border-sky-200 bg-sky-50 text-sky-800',
  draft: 'border-border-warm bg-cream-light text-muted',
  failed: 'border-red-200 bg-red-50 text-red-700',
  cancelled: 'border-border-warm bg-cream-light text-muted',
  canceled: 'border-border-warm bg-cream-light text-muted',
  skipped: 'border-border-warm bg-cream-light text-muted',
};

/** 本文を「素のテキスト / ハッシュタグ / URL / メンション」に割って着色する。 */
const TOKEN_RE = /(https?:\/\/[^\s]+|[#＃][^\s#＃]+|@[A-Za-z0-9_]{1,15})/g;

function renderBody(body: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of body.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > last) out.push(body.slice(last, start));
    const token = match[0];
    if (token.startsWith('http')) {
      out.push(
        <a key={`t${i}`} href={token} target="_blank" rel="noopener noreferrer" className={cn(X_LINK, 'break-all hover:underline')}>
          {token}
        </a>,
      );
    } else {
      out.push(
        <span key={`t${i}`} className={X_LINK}>
          {token}
        </span>,
      );
    }
    last = start + token.length;
    i += 1;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number | null; label: string }) {
  const text = value === null ? m.metricUnknown : value.toLocaleString('ja-JP');
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', value === null && 'opacity-40')} title={label} aria-label={`${label} ${text}`}>
      {icon}
      {value === null ? '—' : text}
    </span>
  );
}

export function PostPreview({
  post,
  channel,
  authorName,
  authorHandle,
  avatarUrl,
}: {
  post: PromotionPostView;
  channel: NotePromotionChannel;
  authorName: string;
  authorHandle: string | null;
  avatarUrl: string | null;
}) {
  const statusLabel = m.postStatus[post.status] ?? post.status;
  const when = post.posted_at ?? post.scheduled_for;
  const isX = channel === 'x';

  return (
    <article
      className="flex flex-col rounded-container border border-border-warm bg-white p-space-snug"
      data-testid="promotion-post-preview"
      data-status={post.status}
    >
      {/* 投稿者行 */}
      <div className="flex items-start gap-space-snug">
        {avatarUrl ? (
          // 署名付き R2 URL なので next/image の最適化は通さない。
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-10 w-10 flex-none rounded-pill object-cover" />
        ) : (
          <span aria-hidden="true" className="flex h-10 w-10 flex-none items-center justify-center rounded-pill bg-charcoal text-body text-white">
            {authorName.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="truncate text-body font-medium text-charcoal">{authorName}</span>
            {authorHandle && <span className="truncate text-caption text-muted">@{authorHandle.replace(/^@/, '')}</span>}
            <span className="text-caption text-muted">・{formatJstShort(when)}</span>
            <span className={cn('ml-auto rounded-pill border px-2 py-0.5 text-caption', STATUS_TONE[post.status] ?? 'border-border-warm bg-cream-light text-muted')}>
              {post.posted_at === null && (post.status === 'scheduled' || post.status === 'queued') ? m.preview.scheduledBadge(statusLabel) : statusLabel}
            </span>
          </div>

          {/* 本文 — 全文・改行保持。これが無いとプレビューにならない。 */}
          <p className="mt-1.5 whitespace-pre-wrap break-words text-body leading-relaxed text-charcoal" data-testid="promotion-post-body">
            {renderBody(post.body)}
          </p>

          {/* 添付メディア / リンクカード */}
          {post.media_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.media_url} alt="" className="mt-space-snug max-h-80 w-full rounded-card border border-border-warm object-cover" />
          ) : (
            post.article_id &&
            post.article_title && (
              <Link
                href={`/articles/${post.article_id}`}
                className="mt-space-snug flex items-stretch gap-0 overflow-hidden rounded-card border border-border-warm no-underline hover:bg-charcoal-04"
              >
                {post.article_eyecatch_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.article_eyecatch_url} alt="" className="h-20 w-32 flex-none object-cover" />
                ) : (
                  <span aria-hidden="true" className="h-20 w-32 flex-none bg-cream-light" />
                )}
                <span className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-2">
                  <span className="text-caption text-muted">note.com</span>
                  <span className="line-clamp-2 text-body text-charcoal">{post.article_title}</span>
                </span>
              </Link>
            )
          )}

          {/* アクション行 (X の並び: 返信 / リポスト / いいね / 表示) */}
          <div className="mt-space-snug flex flex-wrap items-center gap-x-space-loose gap-y-1 text-caption text-muted">
            {isX ? (
              <>
                <Metric icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />} value={post.replies} label={m.metricLabel.replies} />
                <Metric icon={<Repeat2 className="h-4 w-4" aria-hidden="true" />} value={post.reposts} label={m.metricLabel.reposts} />
                <Metric icon={<Heart className="h-3.5 w-3.5" aria-hidden="true" />} value={post.likes} label={m.metricLabel.likes} />
                <Metric icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />} value={post.impressions} label={m.metricLabel.impressions} />
              </>
            ) : (
              <>
                <Metric icon={<Heart className="h-3.5 w-3.5" aria-hidden="true" />} value={post.likes} label={m.metricLabel.likes} />
                <Metric icon={<MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />} value={post.replies} label={m.metricLabel.replies} />
                <Metric icon={<BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />} value={post.impressions} label={m.metricLabel.impressions} />
              </>
            )}
            {post.external_url && (
              <a href={post.external_url} target="_blank" rel="noopener noreferrer" className={cn('ml-auto inline-flex items-center gap-1 no-underline hover:underline', X_LINK)}>
                {m.openPost}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
          </div>

          {post.error && (
            <p role="alert" className="mt-1.5 whitespace-pre-wrap break-words text-caption text-red-600">
              {post.error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
