/**
 * S-ANP-10 投稿一覧の view 変換 (F-ANP-32 / F-ANP-32b)。
 *
 * 2026-10-15 運営者指摘「Xっぽい見た目にしないとプレビューにならない」。
 * それまで本文は 140 字で切り、改行も空白 1 個に潰していた (= プレビューに使えない)。
 * **全文・改行保持**を固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  parseHashtagsText,
  summarizePromotionPosts,
  toPromotionPostView,
  type PromotionPostRow,
} from '../promotion-view';

function row(overrides: Partial<PromotionPostRow> = {}): PromotionPostRow {
  return {
    id: 'p1',
    status: 'scheduled',
    body: '本文',
    scheduled_for: new Date('2026-10-15T12:00:00Z'),
    posted_at: null,
    external_url: null,
    error: null,
    impressions: null,
    likes: null,
    reposts: null,
    replies: null,
    article_title: null,
    article_id: null,
    ...overrides,
  };
}

describe('toPromotionPostView', () => {
  it('本文は全文・改行そのまま (プレビューの前提)', () => {
    const body = ['1行目', '', '3行目 #タグ', 'https://note.com/a/n/b'].join('\n');
    const view = toPromotionPostView(row({ body }));
    expect(view.body).toBe(body);
    expect(view.body).toContain('\n');
  });

  it('前後の空白だけは落とす', () => {
    expect(toPromotionPostView(row({ body: '\n 本文 \n' })).body).toBe('本文');
  });

  it('異常に長い本文だけ安全弁で切る', () => {
    const view = toPromotionPostView(row({ body: 'あ'.repeat(2500) }));
    expect(Array.from(view.body)).toHaveLength(2001); // 2000 + …
    expect(view.body.endsWith('…')).toBe(true);
  });

  it('画像の署名 URL は渡されたものをそのまま持つ (未指定は null)', () => {
    expect(toPromotionPostView(row()).media_url).toBeNull();
    expect(toPromotionPostView(row()).article_eyecatch_url).toBeNull();
    const withImages = toPromotionPostView(row({ media_url: 'https://r2/m.png', article_eyecatch_url: 'https://r2/e.jpg' }));
    expect(withImages.media_url).toBe('https://r2/m.png');
    expect(withImages.article_eyecatch_url).toBe('https://r2/e.jpg');
  });

  it('時刻は ISO 文字列になる', () => {
    const view = toPromotionPostView(row({ posted_at: new Date('2026-10-15T13:00:00Z') }));
    expect(view.scheduled_for).toBe('2026-10-15T12:00:00.000Z');
    expect(view.posted_at).toBe('2026-10-15T13:00:00.000Z');
  });
});

describe('summarizePromotionPosts', () => {
  it('状態別に数え、表示回数/いいねを合算する', () => {
    const s = summarizePromotionPosts([
      { status: 'posted', impressions: 100, likes: 3 },
      { status: 'published', impressions: 50, likes: null },
      { status: 'scheduled', impressions: null, likes: null },
      { status: 'queued', impressions: null, likes: null },
      { status: 'failed', impressions: null, likes: 1 },
      { status: 'canceled', impressions: null, likes: null },
    ]);
    expect(s).toEqual({ total: 6, posted: 2, scheduled: 2, failed: 1, impressions: 150, likes: 4 });
  });
});

describe('parseHashtagsText', () => {
  it('区切り/# の有無を吸収し重複を落とす', () => {
    expect(parseHashtagsText('#AI副業, 副業初心者　#AI副業')).toEqual(['AI副業', '副業初心者']);
  });
});
