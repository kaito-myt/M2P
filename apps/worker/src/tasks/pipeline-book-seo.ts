import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireBookLock as defaultAcquireBookLock,
  releaseBookLock as defaultReleaseBookLock,
} from '@a2p/agents/lib/book-lock';
import { optimizeSeo as defaultOptimizeSeo } from '@a2p/agents/seo-optimizer';
import type { Genre } from '@a2p/contracts/agents';
import { GENRE_SLUGS } from '@a2p/contracts/agents';
import type { SeoOptimizerInput, SeoOptimizerOutput } from '@a2p/contracts/agents/seo-optimizer';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import {
  notifyJobChange as defaultNotifyJobChange,
  type JobChangeNotifyPayload,
} from '../lib/notify-job-change.js';
import { PIPELINE_BOOK_EXPORT_TASK_NAME } from './pipeline-book-export.js';

/**
 * `pipeline.book.seo` タスク。
 *
 * judge PASS 後・export 直前に挿入される KDP メタデータ (description/keywords/categories)
 * の SEO 再最適化ステップ。完成原稿 (Outline + Chapter 見出し) をダイジェスト化して
 * `optimizeSeo` に渡し、結果を `kdp_metadata` 行へ反映する。
 *
 * **NON-FATAL**: SEO 最適化そのもの (context fetch / LLM 呼出 / DB update) は
 * 単一の try/catch で包み、失敗しても書籍を滞留させない — **必ず** `pipeline.book.export`
 * を enqueue して完走させる。Job / BookLock の CAS・排他制御は他タスクと同じ扱い
 * (取得失敗等の真のインフラ障害は通常どおり Job=failed + throw で扱う)。
 *
 * フロー:
 *   1. payload zod parse (book_id / job_id)
 *   2. 冪等チェック: Job.status='done' ならスキップ
 *   3. CAS: queued/failed → running
 *   4. BookLock 取得 (holder=`pipeline:<job_id>`, TTL 30 分)
 *   5. (non-fatal try) Book + ThemeCandidate + Outline + Chapter[] + KdpMetadata fetch
 *      → chapter_digest 構築 → `optimizeSeo(input)` 呼出 → KdpMetadata UPDATE
 *   6. 成功可否に関わらず pipeline.book.export を Job INSERT + addJob
 *   7. Job.status='done', result_json=適用結果サマリ
 *   8. notifyJobChange (ADR-001: channel='jobs')
 *   9. finally: BookLock 解放
 *
 * エラー方針:
 *   - payload zod 違反 → ValidationError
 *   - Job 不在 → NotFoundError (Job=failed 降格)
 *   - BookLock acquire 失敗 → 透過 throw + Job=failed
 *   - SEO 最適化本体 (Book/Theme/Outline/Chapter/KdpMetadata fetch, optimizeSeo, update) の
 *     失敗は non-fatal — warn ログのみで export へ進む
 *   - notifyJobChange 失敗 → warn のみで継続
 */

export const PIPELINE_BOOK_SEO_TASK_NAME = 'pipeline.book.seo';

export const PipelineBookSeoPayloadSchema = z.object({
  book_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type PipelineBookSeoPayload = z.infer<typeof PipelineBookSeoPayloadSchema>;

/** Prisma 部分 I/F — テストで mock しやすいよう最小サブセット。 */
export interface PipelineBookSeoPrisma {
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  job: {
    findUnique: (args: {
      where: { id: string };
      select: { status: true; book_id: true };
    }) => Promise<{ status: string; book_id: string | null } | null>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; started_at?: Date };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: {
        status?: string;
        finished_at?: Date;
        error?: string | null;
        result_json?: unknown;
      };
    }) => Promise<unknown>;
    create: (args: {
      data: {
        kind: string;
        book_id: string;
        parent_job_id?: string;
        status: string;
        payload_json: unknown;
      };
    }) => Promise<{ id: string }>;
  };
  book: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        account_id: true;
        theme_id: true;
        title: true;
        subtitle: true;
      };
    }) => Promise<{
      id: string;
      account_id: string;
      theme_id: string | null;
      title: string;
      subtitle: string | null;
    } | null>;
  };
  themeCandidate: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        genre: true;
        title: true;
        subtitle: true;
        hook: true;
        target_reader: true;
      };
    }) => Promise<{
      id: string;
      genre: string;
      title: string;
      subtitle: string | null;
      hook: string;
      target_reader: string | null;
    } | null>;
  };
  outline: {
    findUnique: (args: {
      where: { book_id: string };
      select: { id: true; chapters_json: true };
    }) => Promise<{ id: string; chapters_json: unknown } | null>;
  };
  chapter: {
    findMany: (args: {
      where: { book_id: string };
      select: { index: true; heading: true };
      orderBy: { index: 'asc' };
    }) => Promise<Array<{ index: number; heading: string }>>;
  };
  kdpMetadata: {
    findUnique: (args: {
      where: { book_id: string };
      select: { id: true; description: true; keywords: true; categories: true };
    }) => Promise<{
      id: string;
      description: string;
      keywords: string[];
      categories: string[];
    } | null>;
    update: (args: {
      where: { book_id: string };
      data: { description: string; keywords: string[]; categories: string[] };
    }) => Promise<{ id: string }>;
  };
}

/** `helpers.addJob` の最小 I/F。 */
export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineBookSeoDeps {
  prisma?: PipelineBookSeoPrisma;
  logger?: Logger;
  optimizeSeo?: (input: SeoOptimizerInput) => Promise<SeoOptimizerOutput>;
  acquireLock?: typeof defaultAcquireBookLock;
  releaseLock?: typeof defaultReleaseBookLock;
  now?: () => Date;
  notifyJobChange?: (
    payload: JobChangeNotifyPayload,
    deps: {
      prisma: { $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number> };
      logger?: Logger;
    },
  ) => Promise<{ ok: boolean }>;
}

const ALLOWED_GENRES = new Set<string>(GENRE_SLUGS);

/** チャプターダイジェスト (アウトライン + 見出し一覧) の最大文字数。コスト抑制。 */
const CHAPTER_DIGEST_LIMIT = 6000;

interface SeoApplyResult {
  applied: boolean;
  kdp_metadata_id?: string;
  error?: string;
}

/**
 * graphile-worker から呼ばれる Task 本体は下の `pipelineBookSeoTask`.
 * このヘルパは DI を受け取りテストから直接呼べる.
 */
export async function runPipelineBookSeo(
  payload: unknown,
  addJob: AddJobLike,
  deps: PipelineBookSeoDeps = {},
): Promise<void> {
  const parsed = PipelineBookSeoPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.book.seo payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { book_id: bookId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_BOOK_SEO_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineBookSeoPrisma);
  const optimizeSeoFn = deps.optimizeSeo ?? defaultOptimizeSeo;
  const acquireLock = deps.acquireLock ?? defaultAcquireBookLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseBookLock;
  const notifyJobChangeFn = deps.notifyJobChange ?? defaultNotifyJobChange;
  const now = deps.now ?? (() => new Date());

  // 1. 冪等性チェック: 既に done なら skip
  const existing = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true, book_id: true },
  });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, {
      details: { jobId, bookId },
    });
  }
  if (existing.status === 'done') {
    log.info(
      { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId },
      'job already done — skipping (idempotent)',
    );
    return;
  }

  // 2. CAS で queued/failed → running
  const casResult = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (casResult.count === 0) {
    log.info(
      { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, observedStatus: existing.status },
      'job not in queued/failed state — skipping (probably already running on another worker)',
    );
    return;
  }

  // 3. BookLock 取得 — 失敗時は Job=failed 降格してから throw
  try {
    await acquireLock({ bookId, holder: `pipeline:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: serializeError(lockErr) },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, err: jobUpdateErr },
        'failed to mark internal Job as failed after lock acquire failure',
      );
    }
    throw lockErr;
  }

  try {
    // 4. SEO 最適化本体 — non-fatal (このブロックの失敗は export enqueue を妨げない)
    const seoResult = await tryApplySeo({
      prisma,
      optimizeSeoFn,
      log,
      bookId,
      jobId,
    });

    // 5. 成否に関わらず export enqueue (書籍を滞留させない)
    const exportJob = await prisma.job.create({
      data: {
        kind: PIPELINE_BOOK_EXPORT_TASK_NAME,
        book_id: bookId,
        parent_job_id: jobId,
        status: 'queued',
        payload_json: { book_id: bookId },
      },
    });
    await addJob(PIPELINE_BOOK_EXPORT_TASK_NAME, {
      book_id: bookId,
      job_id: exportJob.id,
    });

    // 6. 内部 Job を done に遷移
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: seoResult.applied ? null : (seoResult.error ?? null),
        result_json: {
          applied: seoResult.applied,
          kdp_metadata_id: seoResult.kdp_metadata_id ?? null,
          export_job_id: exportJob.id,
        },
      },
    });

    log.info(
      {
        task: PIPELINE_BOOK_SEO_TASK_NAME,
        jobId,
        bookId,
        applied: seoResult.applied,
        exportJobId: exportJob.id,
      },
      'pipeline.book.seo done',
    );

    // 7. SSE 進捗配信 (ADR-001: channel='jobs')
    await notifyJobChangeFn(
      {
        jobId,
        status: 'done',
        kind: PIPELINE_BOOK_SEO_TASK_NAME,
        bookId,
        phase: seoResult.applied ? 'seo_applied' : 'seo_skipped',
      },
      { prisma, logger: log },
    );
  } catch (err) {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: serializeError(err) },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, err: jobUpdateErr },
        'failed to mark internal Job as failed',
      );
    }
    throw err;
  } finally {
    try {
      await releaseLock({ bookId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, err: releaseErr },
        'failed to release BookLock (will be swept by locks.sweep)',
      );
    }
  }
}

/**
 * SEO 最適化本体 (context fetch → optimizeSeo → KdpMetadata update)。
 * 何が起きても throw せず `SeoApplyResult` を返す — 呼出側は結果に関わらず export へ進む。
 */
async function tryApplySeo(args: {
  prisma: PipelineBookSeoPrisma;
  optimizeSeoFn: (input: SeoOptimizerInput) => Promise<SeoOptimizerOutput>;
  log: Logger;
  bookId: string;
  jobId: string;
}): Promise<SeoApplyResult> {
  const { prisma, optimizeSeoFn, log, bookId, jobId } = args;
  try {
    const book = await prisma.book.findUnique({
      where: { id: bookId },
      select: { id: true, account_id: true, theme_id: true, title: true, subtitle: true },
    });
    if (!book) {
      throw new NotFoundError(`Book not found: ${bookId}`, { details: { bookId, jobId } });
    }

    const theme = book.theme_id
      ? await prisma.themeCandidate.findUnique({
          where: { id: book.theme_id },
          select: { id: true, genre: true, title: true, subtitle: true, hook: true, target_reader: true },
        })
      : null;

    const outline = await prisma.outline.findUnique({
      where: { book_id: bookId },
      select: { id: true, chapters_json: true },
    });

    const chapters = await prisma.chapter.findMany({
      where: { book_id: bookId },
      select: { index: true, heading: true },
      orderBy: { index: 'asc' },
    });

    const kdpMeta = await prisma.kdpMetadata.findUnique({
      where: { book_id: bookId },
      select: { id: true, description: true, keywords: true, categories: true },
    });
    if (!kdpMeta) {
      throw new NotFoundError(`KdpMetadata not found for book: ${bookId}`, {
        details: { bookId, jobId },
      });
    }

    const genre = normalizeGenre(theme?.genre ?? null);
    const chapterDigest = buildChapterDigest(outline?.chapters_json, chapters);

    const input: SeoOptimizerInput = {
      book_id: bookId,
      job_id: jobId,
      genre,
      title: (book.title && book.title.length > 0 ? book.title : theme?.title ?? '(無題)').slice(0, 200),
      target_reader: (theme?.target_reader ?? '').slice(0, 300) || '(no target_reader)',
      chapter_digest: chapterDigest,
      current_metadata: {
        description: kdpMeta.description,
        keywords: kdpMeta.keywords,
        categories: kdpMeta.categories,
      },
    };
    const subtitle = book.subtitle ?? theme?.subtitle ?? null;
    if (subtitle && subtitle.length > 0) {
      input.subtitle = subtitle.slice(0, 200);
    }
    if (theme?.hook) {
      input.hook = theme.hook.slice(0, 800);
    }

    const output = await optimizeSeoFn(input);

    // categories は KDP 制約でちょうど2個 — 出力が不正な場合は既存値を維持する。
    const categories = output.categories.length === 2 ? output.categories : kdpMeta.categories;
    const keywords = output.keywords.slice(0, 7);

    const updated = await prisma.kdpMetadata.update({
      where: { book_id: bookId },
      data: { description: output.description, keywords, categories },
    });

    log.info(
      { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, kdpMetadataId: updated.id },
      'seo_optimizer applied — kdp_metadata updated',
    );

    return { applied: true, kdp_metadata_id: updated.id };
  } catch (err) {
    log.warn(
      { task: PIPELINE_BOOK_SEO_TASK_NAME, jobId, bookId, err },
      'seo_optimizer failed — continuing without SEO update (non-fatal)',
    );
    return { applied: false, error: serializeError(err) };
  }
}

/**
 * outline.chapters_json (アウトライン詳細) + 確定章見出し一覧からダイジェストを構築する。
 * `CHAPTER_DIGEST_LIMIT` 字で切り詰める (コスト抑制)。
 */
function buildChapterDigest(
  outlineChaptersJson: unknown,
  chapters: Array<{ index: number; heading: string }>,
): string {
  const headingsList = chapters.map((c) => `第${c.index}章: ${c.heading}`).join('\n');
  const outlineText = outlineChaptersJson !== undefined ? JSON.stringify(outlineChaptersJson) : '';
  const combined = ['【確定章見出し一覧】', headingsList, '', '【アウトライン詳細】', outlineText]
    .filter((s) => s !== '')
    .join('\n');
  return (combined || '(ダイジェストなし)').slice(0, CHAPTER_DIGEST_LIMIT);
}

function normalizeGenre(g: string | null): Genre | null {
  return g && ALLOWED_GENRES.has(g) ? (g as Genre) : null;
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** graphile-worker 用エクスポート. `buildTaskList()` から登録される. */
export const pipelineBookSeoTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPipelineBookSeo(payload, helpers.addJob as unknown as AddJobLike);
};
