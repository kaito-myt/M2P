/**
 * S-ANP-10 販促施策 (docs/11-anp-design.md §3.4 F-ANP-32) — DB 非依存の純関数と型 (クライアント側からも import 可)。
 * DB を読むローダは `promotion-core.ts`。
 */
import {
  NOTE_PROMOTION_CHANNELS,
  type NotePromotionChannel,
  type NotePromotionChannelPolicy,
} from '@a2p/contracts/agents/anp';

export { NOTE_PROMOTION_CHANNELS };
export type { NotePromotionChannel, NotePromotionChannelPolicy };

export function isNotePromotionChannel(v: unknown): v is NotePromotionChannel {
  return typeof v === 'string' && (NOTE_PROMOTION_CHANNELS as readonly string[]).includes(v);
}

/** `promotion_posts.channel` の値 (blog は `blog_posts` 側だが、ここでは promotion_posts の channel='blog' も拾う)。 */
export const PROMOTION_POST_CHANNEL: Record<NotePromotionChannel, string> = {
  x: 'x',
  instagram: 'instagram',
  tiktok: 'tiktok',
  blog: 'blog',
};

/** ハッシュタグ入力 (改行/空白/カンマ区切り、# 任意) → 正規化配列。 */
export function parseHashtagsText(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,、，]+/)) {
    const t = raw.trim().replace(/^#/, '');
    if (t.length === 0 || t.length > 40) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

export function formatHashtags(tags: ReadonlyArray<string>): string {
  return tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ');
}

export interface PromotionJobView {
  id: string;
  status: string;
  channel: NotePromotionChannel | null;
  error: string | null;
  progress: { stage: string; pct: number } | null;
  created_at: string;
}

export interface AccountPromotionState {
  channel: NotePromotionChannel;
  policy: NotePromotionChannelPolicy | null;
  /** 実効 ON/OFF (未指定なら媒体ごとの既定)。 */
  effective_enabled: boolean;
  /** enabled が明示されているか (UI で「既定」チップを出す)。 */
  explicit_enabled: boolean;
  tiktok_enabled: boolean;
  job: PromotionJobView | null;
  /** この媒体の施策生成が進行中か。 */
  generating: boolean;
}

export interface PromotionPostRow {
  id: string;
  status: string;
  body: string;
  scheduled_for: Date;
  posted_at: Date | null;
  external_url: string | null;
  error: string | null;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  article_title: string | null;
  article_id: string | null;
}

export interface PromotionPostView {
  id: string;
  status: string;
  excerpt: string;
  scheduled_for: string;
  posted_at: string | null;
  external_url: string | null;
  error: string | null;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  article_title: string | null;
  article_id: string | null;
}

export function toPromotionPostView(row: PromotionPostRow): PromotionPostView {
  const flat = row.body.replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    status: row.status,
    excerpt: flat.length > 140 ? `${flat.slice(0, 140)}…` : flat,
    scheduled_for: row.scheduled_for.toISOString(),
    posted_at: row.posted_at ? row.posted_at.toISOString() : null,
    external_url: row.external_url,
    error: row.error,
    impressions: row.impressions,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    article_title: row.article_title,
    article_id: row.article_id,
  };
}

export interface PromotionChannelSummary {
  total: number;
  posted: number;
  scheduled: number;
  failed: number;
  impressions: number;
  likes: number;
}

export function summarizePromotionPosts(rows: ReadonlyArray<Pick<PromotionPostRow, 'status' | 'impressions' | 'likes'>>): PromotionChannelSummary {
  const s: PromotionChannelSummary = { total: rows.length, posted: 0, scheduled: 0, failed: 0, impressions: 0, likes: 0 };
  for (const r of rows) {
    if (r.status === 'posted' || r.status === 'published') s.posted += 1;
    else if (r.status === 'scheduled' || r.status === 'draft' || r.status === 'queued') s.scheduled += 1;
    else if (r.status === 'failed') s.failed += 1;
    s.impressions += r.impressions ?? 0;
    s.likes += r.likes ?? 0;
  }
  return s;
}
