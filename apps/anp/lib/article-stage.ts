/**
 * 記事一覧 (S-ANP-07 `/articles`) の「段階」区分 (docs/11-anp-design.md §3.2)。
 *
 * 運営者要望 (2026-09-21)「作成中、公開前、公開中の記事が全部一覧化して」に合わせ、
 * `note_articles.status` (パイプライン進行) と `publish_status` (note 上の公開状態) を
 * 運営者目線の 4 段階にまとめる。DB 非依存の純関数にして RSC からもテストからも使う。
 *
 *   - in_progress : queued → writing → editing → eyecatch → judging (AI が作業中)
 *   - pre_publish : ready (公開待ち) / needs_human_review (人の確認待ち)。note 未公開
 *   - published   : note で公開中 (publish_status='published')
 *   - other       : failed / cancelled / 公開後に非公開化 (unlisted)
 */

export type ArticleStage = 'in_progress' | 'pre_publish' | 'published' | 'other';

export const ARTICLE_STAGES: readonly ArticleStage[] = ['in_progress', 'pre_publish', 'published', 'other'];

const IN_PROGRESS_STATUSES = new Set(['queued', 'writing', 'editing', 'eyecatch', 'judging']);
const PRE_PUBLISH_STATUSES = new Set(['ready', 'needs_human_review']);

export interface ArticleStageInput {
  status: string;
  publish_status: string;
}

export function resolveArticleStage(a: ArticleStageInput): ArticleStage {
  if (a.publish_status === 'published') return 'published';
  if (a.publish_status === 'unlisted') return 'other';
  if (IN_PROGRESS_STATUSES.has(a.status)) return 'in_progress';
  if (PRE_PUBLISH_STATUSES.has(a.status)) return 'pre_publish';
  // status='published' なのに publish_status が draft のケース (公開直後の同期前など) は公開前扱い。
  if (a.status === 'published') return 'pre_publish';
  return 'other';
}

/** 段階 → Prisma `where` 条件。`resolveArticleStage` と同じ境界で DB 側に絞り込む。 */
export function articleStageWhere(stage: ArticleStage): Record<string, unknown> {
  switch (stage) {
    case 'published':
      return { publish_status: 'published' };
    case 'other':
      return {
        OR: [
          { publish_status: 'unlisted' },
          { AND: [{ publish_status: { not: 'published' } }, { status: { in: ['failed', 'cancelled'] } }] },
        ],
      };
    case 'in_progress':
      return { publish_status: { not: 'published' }, status: { in: [...IN_PROGRESS_STATUSES] } };
    case 'pre_publish':
      return {
        publish_status: { notIn: ['published', 'unlisted'] },
        status: { in: [...PRE_PUBLISH_STATUSES, 'published'] },
      };
  }
}

export function isArticleStage(v: unknown): v is ArticleStage {
  return typeof v === 'string' && (ARTICLE_STAGES as readonly string[]).includes(v);
}

/** 段階ごとの件数 (タブのバッジ用)。 */
export function countArticleStages(rows: ArticleStageInput[]): Record<ArticleStage, number> {
  const counts: Record<ArticleStage, number> = { in_progress: 0, pre_publish: 0, published: 0, other: 0 };
  for (const r of rows) counts[resolveArticleStage(r)] += 1;
  return counts;
}
