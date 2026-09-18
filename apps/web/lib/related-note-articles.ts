/**
 * F-ANP-31 Phase4 (docs/11-anp-design.md §3.4/§7): A2P ストアフロント (`/shop`・`/blog`) から
 * ANP (note) の公開済み記事へ逆方向に送客する最小実装。
 *
 * `NoteArticle` は `@a2p/db` を共有する ANP 側テーブルで、apps/web からは READ-ONLY で参照する
 * (書き込みは apps/anp/apps/worker のみが行う)。
 */
import { prisma } from '@a2p/db';

export interface RelatedNoteArticle {
  id: string;
  title: string;
  note_url: string;
}

/** 公開済み(status='published') の note 記事を新しい順に最大 `limit` 件返す。0件なら空配列。 */
export async function loadRelatedNoteArticles(limit = 3): Promise<RelatedNoteArticle[]> {
  const rows = await prisma.noteArticle.findMany({
    where: { status: 'published', note_url: { not: null } },
    orderBy: { published_at: 'desc' },
    take: limit,
    select: { id: true, title: true, note_url: true },
  });
  return rows
    .filter((r): r is { id: string; title: string; note_url: string } => !!r.note_url)
    .map((r) => ({ id: r.id, title: r.title, note_url: r.note_url }));
}
