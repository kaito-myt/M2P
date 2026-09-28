/**
 * `pipeline.note.fix-tables` タスク — **公開済み記事に残った Markdown の表を表画像へ差し替える** (F-ANP-48)。
 *
 * 運営者報告 (2026-09-28)「表がこんな感じで表示されてるからちゃんと表で出力されるようにして」。
 * note のエディタには表を作る機能が無く (2026-09-28 調査)、初期実装は表の行をそのまま段落として
 * 打ち込んでいたため、公開記事に `| 頭数帯 | レース数 |` というパイプ記号の羅列が出ていた。
 *
 * 以降の新規記事は `pipeline.note.publish` が最初から表画像で公開する。本タスクは既に公開済みの
 * 記事の後始末。
 *
 * 流れ:
 *   1. `NoteArticle` が `published` かつ `note_url` を持つことを確認
 *   2. `body_md` から表を抽出して PNG を生成 (`attachTableImages`)
 *   3. `NotePublishPort.fixTablesOne` が note エディタでパイプ段落を消して画像を挿入 → 更新
 *
 * 安全側の設計:
 *   - `dry_run`(既定 true) は差し替えるところまでで「更新する」を押さない。note は公開済み記事の
 *     エディタ編集をオートセーブするが、**公開中の本文は更新を押すまで変わらない** (2026-09-25 実測)。
 *   - グローバル `AppSettings.anp_publish_dry_run` が ON の間は強制ドライラン (publish と同じ扱い)。
 *   - 本文全体は打ち直さないので、失敗しても被害が局所で済む。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  acquireNoteLock as defaultAcquireNoteLock,
  releaseNoteLock as defaultReleaseNoteLock,
} from '@a2p/agents/lib/note-lock';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import { buildNoteBlocks } from './note-publish/build-blocks.js';
import { attachTableImages, countMarkdownJunk } from './note-publish/table-images.js';
import type { NoteFixTablesResult, NotePublishPort } from './note-publish/playwright-note-publish-port.js';

export const PIPELINE_NOTE_FIX_TABLES_TASK_NAME = 'pipeline.note.fix-tables';

export const PipelineNoteFixTablesPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  /** 省略時は true (安全側)。false で実際に「更新する」を押す。 */
  dry_run: z.boolean().optional(),
});
export type PipelineNoteFixTablesPayload = z.infer<typeof PipelineNoteFixTablesPayloadSchema>;

// ---------------------------------------------------------------------------
// Prisma 最小インターフェース
// ---------------------------------------------------------------------------

interface FixTablesArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  paywall_line_pos: number | null;
  note_url: string | null;
  status: string;
}

interface FixTablesAccountRow {
  id: string;
  display_name: string;
  niche?: string | null;
  session_state_enc: string | null;
}

export interface PipelineNoteFixTablesPrisma {
  appSettings: {
    findUnique: (args: {
      where: { id: string };
      select: { anp_publish_dry_run: true };
    }) => Promise<{ anp_publish_dry_run: boolean } | null>;
  };
  job: {
    findUnique: (args: { where: { id: string }; select: { status: true } }) => Promise<{ status: string } | null>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; started_at?: Date };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; finished_at?: Date; error?: string | null; result_json?: unknown };
    }) => Promise<unknown>;
  };
  noteArticle: {
    findUnique: (args: { where: { id: string } }) => Promise<FixTablesArticleRow | null>;
  };
  noteAccount: {
    findUnique: (args: { where: { id: string } }) => Promise<FixTablesAccountRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
}

export interface PipelineNoteFixTablesDeps {
  prisma?: PipelineNoteFixTablesPrisma;
  logger?: Logger;
  publishPort: NotePublishPort;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
  decryptSession?: (enc: string) => string;
  notify?: (text: string) => Promise<boolean>;
}

export interface PipelineNoteFixTablesResult {
  ok: boolean;
  status: string;
  reason?: string;
  replaced?: number;
  remaining?: number;
  /** 取り除いた Markdown 記号の数。 */
  cleaned?: number;
}

export async function runPipelineNoteFixTables(
  payload: unknown,
  deps: PipelineNoteFixTablesDeps,
): Promise<PipelineNoteFixTablesResult> {
  const parsed = PipelineNoteFixTablesPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.fix-tables payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: articleId, job_id: jobId, dry_run: dryRun } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_FIX_TABLES_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteFixTablesPrisma);
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  const notify = deps.notify ?? pushLine;

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, articleId } });
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_FIX_TABLES_TASK_NAME, jobId }, 'job already done — skipping');
    return { ok: true, status: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_FIX_TABLES_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return { ok: true, status: 'skipped' };
  }

  try {
    await acquireLock({ noteArticleId: articleId, holder: `fix-tables:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    await failJob(prisma, jobId, now(), lockErr, log);
    throw lockErr;
  }

  try {
    const article = await prisma.noteArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundError(`NoteArticle not found: ${articleId}`, { details: { articleId, jobId } });

    if (article.status !== 'published' || !article.note_url) {
      log.info({ articleId, status: article.status }, '公開済みでない記事は対象外 — skip');
      await finishJob(prisma, jobId, now(), { status: 'not_published' });
      return { ok: false, status: 'not_published', reason: 'not_published' };
    }

    const account = await prisma.noteAccount.findUnique({ where: { id: article.note_account_id } });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }
    if (!account.session_state_enc) {
      log.warn({ articleId, accountId: account.id }, 'note session 未設定 — skip');
      await finishJob(prisma, jobId, now(), { status: 'no_session' });
      return { ok: false, status: 'no_session', reason: 'no_session' };
    }

    let sessionState: string;
    try {
      sessionState = decryptSession(account.session_state_enc);
    } catch (err) {
      log.warn({ err: errMsg(err), accountId: account.id }, 'note session 復号失敗');
      await finishJob(prisma, jobId, now(), { status: 'session_decrypt_failed' });
      return { ok: false, status: 'session_decrypt_failed', reason: 'error' };
    }

    // 本文の表を画像化する (本文での出現順。free → paid の順に並べる)。
    const stageDir = mkdtempSync(path.join(tmpdir(), 'note-fixtables-'));
    const built = buildNoteBlocks(article.body_md ?? '', article.paywall_line_pos);
    const freeStage = await attachTableImages(built.freeBlocks, {
      articleId,
      stageDir,
      niche: account.niche ?? null,
    });
    const paidStage = await attachTableImages(
      built.paidBlocks,
      { articleId, stageDir, niche: account.niche ?? null },
      freeStage.nextIndex,
    );
    const tableImages = [...freeStage.blocks, ...paidStage.blocks]
      .filter((b) => b.kind === 'table' && b.imagePath)
      .map((b) => b.imagePath!);

    // 表が無くても、本文に残った Markdown の記号 (`**` 等) を掃除するために続行する。
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { anp_publish_dry_run: true },
    });
    const effectiveDryRun = (dryRun ?? true) || !!settings?.anp_publish_dry_run;

    log.info(
      { articleId, noteUrl: article.note_url, tables: tableImages.length, requestedDryRun: dryRun, effectiveDryRun },
      'pipeline.note.fix-tables start',
    );

    let result: NoteFixTablesResult;
    try {
      result = await deps.publishPort.fixTablesOne({
        articleId,
        noteUrl: article.note_url,
        tableImages,
        paid: article.paid,
        freeBlockCount: freeStage.blocks.length,
        sessionState,
        dryRun: effectiveDryRun,
        // DB の本文にまだ Markdown が残っている = 公開中の本文は直っていないので、
        // エディタ上が既にきれいでも「更新する」を押して公開へ反映する (オートセーブ対策)。
        forceUpdate: tableImages.length > 0 || countMarkdownJunk(article.body_md) > 0,
        stageDir,
      });
    } catch (err) {
      log.warn({ err: errMsg(err), articleId }, 'fixTablesOne threw');
      await finishJob(prisma, jobId, now(), { status: 'error', error: errMsg(err) }, errMsg(err));
      return { ok: false, status: 'error', reason: 'error' };
    }

    if (result.ok) {
      await finishJob(prisma, jobId, now(), {
        status: result.status,
        replaced: result.replaced,
        remaining: result.remaining,
        tables: tableImages.length,
      });
      log.info(
        { articleId, status: result.status, replaced: result.replaced, remaining: result.remaining },
        'pipeline.note.fix-tables 完了',
      );
      if (result.status === 'fixed') {
        await notify(
          `🧾 ANP: 「${article.title}」の表 ${String(result.replaced)} 個を画像に差し替えました\n${article.note_url}`,
        ).catch(() => {});
      }
      return { ok: true, status: result.status, replaced: result.replaced, remaining: result.remaining };
    }

    log.warn({ articleId, reason: result.reason, fail_message: result.message }, 'pipeline.note.fix-tables failed');
    if (result.reason === 'not_logged_in') {
      await prisma.noteAccount
        .update({ where: { id: account.id }, data: { status: 'paused' } })
        .catch((err) => log.warn({ err: errMsg(err) }, 'account pause 失敗(無視)'));
      await notifyNoteSessionExpired(prisma, account.id, account.display_name, notify);
    }
    await finishJob(prisma, jobId, now(), { status: result.reason, error: result.message }, result.message);
    return { ok: false, status: result.reason, reason: result.reason };
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId: articleId, holder: `fix-tables:${jobId}` });
    } catch (releaseErr) {
      log.warn(
        { task: PIPELINE_NOTE_FIX_TABLES_TASK_NAME, jobId, articleId, err: releaseErr },
        'failed to release NoteLock',
      );
    }
  }
}

async function finishJob(
  prisma: { job: PipelineNoteFixTablesPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  resultJson: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  await prisma.job
    .update({
      where: { id: jobId },
      data: { status: 'done', finished_at: finishedAt, error: errorMessage ?? null, result_json: resultJson },
    })
    .catch(() => {});
}

async function failJob(
  prisma: { job: PipelineNoteFixTablesPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  err: unknown,
  log: Logger,
): Promise<void> {
  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'failed', finished_at: finishedAt, error: serializeError(err) },
    });
  } catch (jobUpdateErr) {
    log.warn(
      { task: PIPELINE_NOTE_FIX_TABLES_TASK_NAME, jobId, err: jobUpdateErr },
      'failed to mark internal Job as failed',
    );
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------

export const pipelineNoteFixTablesTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  const { createPlaywrightNotePublishPort } = await import('./note-publish/playwright-note-publish-port.js');
  await runPipelineNoteFixTables(payload, { publishPort: createPlaywrightNotePublishPort() });
};
