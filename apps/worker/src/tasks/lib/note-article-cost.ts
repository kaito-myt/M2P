/**
 * docs/11-anp-design.md §6/§7 — `pipeline.note.*` タスク共通の記事別コスト集計ヘルパ。
 *
 * ANP のエージェント関数 (`@a2p/agents/anp/*`) は `withTokenLogging`/`withImageLogging` に
 * `bookId` を渡さない設計 (NoteArticle は Book と無関係の別テーブルのため FK 混線を避ける)。
 * そのため各 `pipeline.note.*` タスクは、エージェント呼出直後に「このタスクの内部 Job.id
 * (= token_usage.job_id) に紐づく token_usage 行のコスト合計」を `NoteArticle.cost_jpy_total`
 * に加算する。
 */

import type { NoteArticleRepo } from './note-article-repo.js';

export interface NoteArticleCostPrisma {
  tokenUsage: {
    findMany: (args: {
      where: { job_id: string };
      select: { cost_jpy: true };
    }) => Promise<Array<{ cost_jpy: unknown }>>;
  };
  noteArticle: NoteArticleRepo;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v != null && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return (v as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `jobId` に紐づく `token_usage.cost_jpy` の合計を `NoteArticle.cost_jpy_total` に加算する。
 * 失敗しても呼出元タスク自体は継続させたいため、呼出側で try/catch して warn ログに留める。
 */
export async function applyNoteArticleCostFromJob(
  prisma: NoteArticleCostPrisma,
  jobId: string,
  noteArticleId: string,
): Promise<number> {
  const rows = await prisma.tokenUsage.findMany({
    where: { job_id: jobId },
    select: { cost_jpy: true },
  });
  const total = rows.reduce((acc, r) => acc + toNumber(r.cost_jpy), 0);
  if (total > 0) {
    await prisma.noteArticle.update({
      where: { id: noteArticleId },
      data: { cost_jpy_total: { increment: total } },
    });
  }
  return total;
}
