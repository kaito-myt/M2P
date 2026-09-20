/**
 * `pipeline.note.publish` タスク (docs/11-anp-design.md §7 Phase2, F-ANP-20)。
 *
 * `NoteArticle(status='ready')` を note へ Playwright アシスト公開する。KDP/BW の
 * サーバー自動入稿 (`kdp.submit`/`bw.submit`) と同じ構造: DI 可能な Port を注入し、
 * 内部 `Job` を CAS 遷移させ `NoteLock` で排他する。UI の「公開(dry-run)/公開」ボタン、
 * および `note.publish.dispatch` (cron) の双方から `{note_article_id, job_id, dry_run?}` で
 * enqueue される。
 *
 * 冪等性/エラー方針:
 *   - noteId 採番後は失敗しても `NoteArticle.note_url` を即保存する(下書き追跡のため)。
 *   - `not_logged_in`: アカウントを `status='paused'` にして LINE 通知 (bw.submit と同型)。
 *   - `kyc_required`/`blocked`/`error`: `NoteArticle.status` は `ready` のまま維持し、
 *     `note_url` は保持する(次回 dispatcher が再試行できるように)。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
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
import { downloadBuffer } from '@a2p/storage';

import { pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import { buildNoteBlocks } from './note-publish/build-blocks.js';
import type { NoteArticleInput, NotePublishPort, NotePublishResult } from './note-publish/playwright-note-publish-port.js';

export const PIPELINE_NOTE_PUBLISH_TASK_NAME = 'pipeline.note.publish';

export const PipelineNotePublishPayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  dry_run: z.boolean().optional(),
});
export type PipelineNotePublishPayload = z.infer<typeof PipelineNotePublishPayloadSchema>;

// ---------------------------------------------------------------------------
// Prisma 最小インターフェース
// ---------------------------------------------------------------------------

interface NoteArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  price_jpy: number | null;
  paywall_line_pos: number | null;
  eyecatch_r2_key: string | null;
  note_url: string | null;
  status: string;
}

interface NoteAccountRow {
  id: string;
  display_name: string;
  session_state_enc: string | null;
  status: string;
  handle: string | null;
}

export interface PipelineNotePublishPrisma {
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
    /** F-ANP-30: 公開成功時に `promotion.note.article` の内部 Job を作る (親子関係)。 */
    create: (args: {
      data: { kind: string; status: string; payload_json: unknown; parent_job_id?: string };
    }) => Promise<{ id: string }>;
  };
  noteArticle: {
    findUnique: (args: { where: { id: string } }) => Promise<NoteArticleRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteAccount: {
    findUnique: (args: { where: { id: string } }) => Promise<NoteAccountRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
}

export type FetchAssetFn = (key: string) => Promise<Buffer | null>;

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PipelineNotePublishDeps {
  prisma?: PipelineNotePublishPrisma;
  logger?: Logger;
  publishPort: NotePublishPort;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
  fetchAsset?: FetchAssetFn;
  decryptSession?: (enc: string) => string;
  notify?: (text: string) => Promise<boolean>;
  /** F-ANP-30: 公開成功時に `promotion.note.article` を enqueue する (省略時は enqueue しない、テスト互換)。 */
  addJob?: AddJobLike;
}

export interface PipelineNotePublishResult {
  ok: boolean;
  status: string;
  reason?: string;
  noteUrl?: string;
}

export async function runPipelineNotePublish(
  payload: unknown,
  deps: PipelineNotePublishDeps,
): Promise<PipelineNotePublishResult> {
  const parsed = PipelineNotePublishPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.publish payload が不正です', { details: { issues: parsed.error.issues } });
  }
  const { note_article_id: articleId, job_id: jobId, dry_run: dryRun } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_PUBLISH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNotePublishPrisma);
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());
  const fetchAsset = deps.fetchAsset ?? ((key: string) => downloadBuffer(key));
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  const notify = deps.notify ?? pushLine;

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, articleId } });
  }
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_PUBLISH_TASK_NAME, jobId }, 'job already done — skipping');
    return { ok: true, status: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_PUBLISH_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return { ok: true, status: 'skipped' };
  }

  try {
    await acquireLock({ noteArticleId: articleId, holder: `pipeline:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    await failJob(prisma, jobId, now(), lockErr, log);
    throw lockErr;
  }

  try {
    const article = await prisma.noteArticle.findUnique({ where: { id: articleId } });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${articleId}`, { details: { articleId, jobId } });
    }
    if (article.status !== 'ready' && article.status !== 'needs_human_review') {
      log.info(
        { task: PIPELINE_NOTE_PUBLISH_TASK_NAME, jobId, articleId, status: article.status },
        'NoteArticle is not ready — skipping',
      );
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', finished_at: now(), result_json: { skipped: true, status: article.status } },
      });
      return { ok: false, status: 'not_ready', reason: 'not_ready' };
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

    // アイキャッチ(あれば)を tmp へ落とす。
    const stageDir = mkdtempSync(path.join(tmpdir(), 'note-publish-'));
    let eyecatchPath: string | null = null;
    if (article.eyecatch_r2_key) {
      try {
        const buf = await fetchAsset(article.eyecatch_r2_key);
        if (buf) {
          eyecatchPath = path.join(stageDir, `${articleId}-eyecatch.jpg`);
          writeFileSync(eyecatchPath, buf);
        }
      } catch (err) {
        log.warn({ err: errMsg(err), articleId }, 'eyecatch 取得失敗 — 画像なしで続行');
      }
    }

    const { freeBlocks, paidBlocks } = buildNoteBlocks(article.body_md ?? '', article.paywall_line_pos);
    const input: NoteArticleInput = {
      id: article.id,
      title: article.title,
      freeBlocks,
      paidBlocks,
      paid: article.paid,
      priceJpy: article.price_jpy,
      existingNoteUrl: article.note_url,
      eyecatchPath,
    };

    // 安全側デフォルト: payload の dry_run 省略時は true 扱い。かつ AppSettings.anp_publish_dry_run=true
    // の間は、呼出側が明示的に dry_run:false を渡してもグローバルに実公開を止める(code review #1)。
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { anp_publish_dry_run: true },
    });
    const effectiveDryRun = (dryRun ?? true) || !!settings?.anp_publish_dry_run;

    log.info({ articleId, requestedDryRun: dryRun, effectiveDryRun, paid: article.paid }, 'pipeline.note.publish start');
    let result: NotePublishResult;
    try {
      result = await deps.publishPort.publishOne({ article: input, sessionState, dryRun: effectiveDryRun, stageDir });
    } catch (err) {
      log.warn({ err: errMsg(err), articleId }, 'publishOne threw');
      await finishJob(prisma, jobId, now(), { status: 'error' });
      return { ok: false, status: 'error', reason: 'error' };
    }

    // noteId 採番後は失敗しても note_url を保存(下書き追跡のため)。
    if (result.noteUrl && result.noteUrl !== article.note_url) {
      await prisma.noteArticle
        .update({ where: { id: articleId }, data: { note_url: result.noteUrl } })
        .catch((err) => log.warn({ err: errMsg(err), articleId }, 'note_url 保存失敗(無視)'));
    }

    if (result.ok) {
      if (result.status === 'draft') {
        await prisma.noteArticle.update({
          where: { id: articleId },
          data: { publish_status: 'draft', note_url: result.noteUrl },
        });
        await finishJob(prisma, jobId, now(), { status: 'dry_run_ready', note_url: result.noteUrl });
        log.info({ articleId, noteUrl: result.noteUrl }, 'pipeline.note.publish dry-run 完了(下書き保存)');
        return { ok: true, status: 'dry_run_ready', noteUrl: result.noteUrl };
      }
      await prisma.noteArticle.update({
        where: { id: articleId },
        data: {
          status: 'published',
          publish_status: 'published',
          note_url: result.noteUrl,
          published_at: now(),
        },
      });
      await finishJob(prisma, jobId, now(), { status: 'published', note_url: result.noteUrl });
      log.info({ articleId, noteUrl: result.noteUrl }, 'pipeline.note.publish 公開完了');
      await notify(`📝 ANP: 「${article.title}」を note に公開しました\n${result.noteUrl}`).catch(() => {});
      await enqueueArticlePromo(prisma, deps.addJob, articleId, log);
      await autoSaveAccountHandle(prisma, account, result.noteUrl, log);
      return { ok: true, status: 'published', noteUrl: result.noteUrl };
    }

    log.warn({ articleId, reason: result.reason, fail_message: result.message }, 'pipeline.note.publish failed');
    if (result.reason === 'not_logged_in') {
      await prisma.noteAccount
        .update({ where: { id: account.id }, data: { status: 'paused' } })
        .catch((err) => log.warn({ err: errMsg(err) }, 'account pause 失敗(無視)'));
      await notifyNoteSessionExpired(prisma, account.id, account.display_name, notify);
    }
    await finishJob(prisma, jobId, now(), { status: result.reason, error: result.message }, result.message);
    return { ok: false, status: result.reason, reason: result.reason, noteUrl: result.noteUrl };
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId: articleId, holder: `pipeline:${jobId}` });
    } catch (releaseErr) {
      log.warn({ task: PIPELINE_NOTE_PUBLISH_TASK_NAME, jobId, articleId, err: releaseErr }, 'failed to release NoteLock');
    }
  }
}

async function finishJob(
  prisma: { job: PipelineNotePublishPrisma['job'] },
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
  prisma: { job: PipelineNotePublishPrisma['job'] },
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
    log.warn({ task: PIPELINE_NOTE_PUBLISH_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

/** `note.com/<handle>/n/<noteId>` から handle 部分を抽出する (docs/11 §7 申し送り13)。 */
export function extractNoteHandle(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/note\.com\/([^/]+)\/n\/[^/]+/.exec(url);
  return m ? m[1]! : null;
}

/**
 * 公開成功時、`note_accounts.handle` が未設定であれば公開 URL から自動抽出して保存する
 * (docs/11 §7 申し送り13: フォロワー数取得 `/<handle>/followers` に handle が必須)。
 * 既に手動設定済みの handle は上書きしない。失敗は無視 (公開自体の成功結果には影響させない)。
 */
async function autoSaveAccountHandle(
  prisma: { noteAccount: PipelineNotePublishPrisma['noteAccount'] },
  account: NoteAccountRow,
  noteUrl: string | undefined,
  log: Logger,
): Promise<void> {
  if (account.handle) return;
  const handle = extractNoteHandle(noteUrl);
  if (!handle) return;
  await prisma.noteAccount
    .update({ where: { id: account.id }, data: { handle } })
    .catch((err) => log.warn({ err: errMsg(err), accountId: account.id, handle }, 'handle 自動保存に失敗(無視)'));
}

/**
 * F-ANP-30: 公開成功後に `promotion.note.article` を 1 記事 1 回 enqueue する。
 * `addJob` 未注入 (テスト等) の場合は no-op。失敗しても公開自体の成功結果には影響させない。
 */
async function enqueueArticlePromo(
  prisma: { job: PipelineNotePublishPrisma['job'] },
  addJob: AddJobLike | undefined,
  articleId: string,
  log: Logger,
): Promise<void> {
  if (!addJob) return;
  try {
    const childJob = await prisma.job.create({
      data: { kind: 'promotion.note.article', status: 'queued', payload_json: { note_article_id: articleId } },
    });
    await addJob(
      'promotion.note.article',
      { note_article_id: articleId, job_id: childJob.id },
      { jobKey: `anp-promo-${articleId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );
  } catch (err) {
    log.warn({ err: errMsg(err), articleId }, 'promotion.note.article の enqueue に失敗(無視・公開自体は成功扱い)');
  }
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------

export const pipelineNotePublishTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  const { createPlaywrightNotePublishPort } = await import('./note-publish/playwright-note-publish-port.js');
  await runPipelineNotePublish(payload, {
    publishPort: createPlaywrightNotePublishPort(),
    addJob: helpers.addJob as unknown as AddJobLike,
  });
};
