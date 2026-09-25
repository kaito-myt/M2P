/**
 * `pipeline.note.monetize` タスク — **公開済みの無料記事を後から有料に切り替える** (F-ANP-47)。
 *
 * 運営者要望 (2026-09-25)「有料化機能作って」。judge が有料記事を無料に格下げしていたバグ
 * (F-ANP-45) の後始末として、既に note 上で無料公開されている記事に有料ラインを引き直し、
 * 価格を設定して更新する。以降の新規記事は `pipeline.note.publish` が最初から有料で公開する。
 *
 * 流れ:
 *   1. `NoteArticle` が `published` かつ `paid=false` かつ `note_url` を持つことを確認
 *   2. 本文を `computePaywallSplit` でアカウントの `free_ratio` に沿って段落境界で分割
 *   3. `NotePublishPort.monetizeOne` が note エディタで有料エリアを挿入 → 価格 → 更新
 *   4. 成功したら `paid=true` / `price_jpy` / `paywall_line_pos` を DB に反映
 *
 * 安全側の設計:
 *   - `dry_run`(既定 true) は「公開設定で有料を選び価格を入れるが更新は押さない」。
 *     KYC が未完了かどうかの確認にそのまま使える (更新しないので記事は無料のまま)。
 *   - 実更新 (`dry_run:false`) はアカウント設定 `paid_publish_enabled` が ON のときだけ。
 *     グローバル `AppSettings.anp_publish_dry_run` が ON の間は publish と同様に強制ドライラン。
 *   - 失敗しても記事は無料のまま公開され続ける (非公開化・削除は一切しない)。
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
import { parseNoteAccountSettings } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import { computePaywallSplit } from './note-publish/paywall-split.js';
import type { NoteMonetizeResult, NotePublishPort } from './note-publish/playwright-note-publish-port.js';

export const PIPELINE_NOTE_MONETIZE_TASK_NAME = 'pipeline.note.monetize';

/** 価格が決まらないときの最終フォールバック (note の最低価格は 100 円)。 */
export const DEFAULT_MONETIZE_PRICE_JPY = 500;
/** `monetization_policy_json.free_ratio` が読めないときの既定 (writer と同じ)。 */
export const DEFAULT_FREE_RATIO = 0.3;

export const PipelineNoteMonetizePayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
  /** 省略時は true (安全側)。false で実際に「更新する」を押す。 */
  dry_run: z.boolean().optional(),
  /** 運営者が価格を指定した場合。省略時は記事の想定価格 → 価格帯 → 既定値。 */
  price_jpy: z.number().int().min(100).max(50000).optional(),
});
export type PipelineNoteMonetizePayload = z.infer<typeof PipelineNoteMonetizePayloadSchema>;

// ---------------------------------------------------------------------------
// Prisma 最小インターフェース
// ---------------------------------------------------------------------------

interface MonetizeArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  body_md: string | null;
  paid: boolean;
  price_jpy: number | null;
  paywall_line_pos: number | null;
  note_url: string | null;
  status: string;
  publish_status: string;
}

interface MonetizeAccountRow {
  id: string;
  display_name: string;
  session_state_enc: string | null;
  monetization_policy_json?: unknown;
  settings_json?: unknown;
}

export interface PipelineNoteMonetizePrisma {
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
    findUnique: (args: { where: { id: string } }) => Promise<MonetizeArticleRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteAccount: {
    findUnique: (args: { where: { id: string } }) => Promise<MonetizeAccountRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
}

export interface PipelineNoteMonetizeDeps {
  prisma?: PipelineNoteMonetizePrisma;
  logger?: Logger;
  publishPort: NotePublishPort;
  acquireLock?: typeof defaultAcquireNoteLock;
  releaseLock?: typeof defaultReleaseNoteLock;
  now?: () => Date;
  decryptSession?: (enc: string) => string;
  notify?: (text: string) => Promise<boolean>;
}

export interface PipelineNoteMonetizeResult {
  ok: boolean;
  status: string;
  reason?: string;
  priceJpy?: number;
  paywallLinePos?: number;
}

/** `monetization_policy_json.free_ratio` を安全に読む。 */
export function readFreeRatio(monetizationPolicyJson: unknown): number {
  if (monetizationPolicyJson && typeof monetizationPolicyJson === 'object') {
    const v = (monetizationPolicyJson as { free_ratio?: unknown }).free_ratio;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1) return v;
  }
  return DEFAULT_FREE_RATIO;
}

/**
 * 有料化する価格を決める純関数。
 * 運営者指定 → 記事の想定価格 (judge の `suggested_price_jpy` が入っている) →
 * アカウントの価格帯下限 → 既定 500 円。10 円単位に丸める。
 */
export function resolveMonetizePrice(
  requested: number | null | undefined,
  articlePrice: number | null | undefined,
  monetizationPolicyJson: unknown,
): number {
  const band = (monetizationPolicyJson as { price_band?: unknown } | null | undefined)?.price_band;
  const bandMin = Array.isArray(band) && typeof band[0] === 'number' && band[0] >= 100 ? Math.round(band[0]) : null;
  // 0 や負値 (judge が値を落とした記事) は「未設定」として次の候補へ送る。
  const positive = (v: number | null | undefined): number | null => (typeof v === 'number' && v > 0 ? v : null);
  const raw = positive(requested) ?? positive(articlePrice) ?? bandMin ?? DEFAULT_MONETIZE_PRICE_JPY;
  const clamped = Math.min(50000, Math.max(100, Math.round(raw)));
  return Math.round(clamped / 10) * 10;
}

export async function runPipelineNoteMonetize(
  payload: unknown,
  deps: PipelineNoteMonetizeDeps,
): Promise<PipelineNoteMonetizeResult> {
  const parsed = PipelineNoteMonetizePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('pipeline.note.monetize payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: articleId, job_id: jobId, dry_run: dryRun, price_jpy: requestedPrice } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PIPELINE_NOTE_MONETIZE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PipelineNoteMonetizePrisma);
  const acquireLock = deps.acquireLock ?? defaultAcquireNoteLock;
  const releaseLock = deps.releaseLock ?? defaultReleaseNoteLock;
  const now = deps.now ?? (() => new Date());
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  const notify = deps.notify ?? pushLine;

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, articleId } });
  if (existing.status === 'done') {
    log.info({ task: PIPELINE_NOTE_MONETIZE_TASK_NAME, jobId }, 'job already done — skipping');
    return { ok: true, status: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PIPELINE_NOTE_MONETIZE_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return { ok: true, status: 'skipped' };
  }

  try {
    await acquireLock({ noteArticleId: articleId, holder: `monetize:${jobId}`, ttlMinutes: 30 });
  } catch (lockErr) {
    await failJob(prisma, jobId, now(), lockErr, log);
    throw lockErr;
  }

  try {
    const article = await prisma.noteArticle.findUnique({ where: { id: articleId } });
    if (!article) throw new NotFoundError(`NoteArticle not found: ${articleId}`, { details: { articleId, jobId } });

    if (article.status !== 'published' || !article.note_url) {
      log.info({ articleId, status: article.status }, '公開済みでない記事は有料化できない — skip');
      await finishJob(prisma, jobId, now(), { status: 'not_published' });
      return { ok: false, status: 'not_published', reason: 'not_published' };
    }
    if (article.paid) {
      log.info({ articleId }, 'すでに有料 — skip');
      await finishJob(prisma, jobId, now(), { status: 'already_paid' });
      return { ok: true, status: 'already_paid' };
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

    // 有料ラインの位置を本文から決める (既に paywall_line_pos があればそれを尊重)。
    const freeRatio = readFreeRatio(account.monetization_policy_json);
    const split = computePaywallSplit(article.body_md ?? '', freeRatio);
    if (!split) {
      log.warn({ articleId }, '本文が短すぎて有料ラインを引けない — skip');
      await finishJob(prisma, jobId, now(), { status: 'no_paywall_slot' });
      return { ok: false, status: 'no_paywall_slot', reason: 'no_paywall_slot' };
    }

    const priceJpy = resolveMonetizePrice(requestedPrice, article.price_jpy, account.monetization_policy_json);

    // 実更新の二重ゲート: アカウント設定 + グローバルのドライラン設定。
    const paidAllowed = parseNoteAccountSettings(account.settings_json).paid_publish_enabled === true;
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { anp_publish_dry_run: true },
    });
    const effectiveDryRun = (dryRun ?? true) || !!settings?.anp_publish_dry_run || !paidAllowed;

    log.info(
      {
        articleId,
        noteUrl: article.note_url,
        priceJpy,
        freeRatio,
        split,
        requestedDryRun: dryRun,
        paidAllowed,
        effectiveDryRun,
      },
      'pipeline.note.monetize start',
    );

    const stageDir = mkdtempSync(path.join(tmpdir(), 'note-monetize-'));
    let result: NoteMonetizeResult;
    try {
      result = await deps.publishPort.monetizeOne({
        articleId,
        noteUrl: article.note_url,
        freeBlockCount: split.freeBlockCount,
        priceJpy,
        sessionState,
        dryRun: effectiveDryRun,
        stageDir,
      });
    } catch (err) {
      log.warn({ err: errMsg(err), articleId }, 'monetizeOne threw');
      await finishJob(prisma, jobId, now(), { status: 'error', error: errMsg(err) }, errMsg(err));
      return { ok: false, status: 'error', reason: 'error' };
    }

    if (result.ok && result.status === 'monetized') {
      await prisma.noteArticle.update({
        where: { id: articleId },
        data: { paid: true, price_jpy: priceJpy, paywall_line_pos: split.pos },
      });
      await finishJob(prisma, jobId, now(), {
        status: 'monetized',
        price_jpy: priceJpy,
        paywall_line_pos: split.pos,
        free_chars: split.freeChars,
        total_chars: split.totalChars,
      });
      log.info({ articleId, priceJpy, pos: split.pos }, 'pipeline.note.monetize 有料化完了');
      await notify(
        `💰 ANP: 「${article.title}」を ¥${priceJpy.toLocaleString('ja-JP')} の有料記事に切り替えました\n${article.note_url}`,
      ).catch(() => {});
      return { ok: true, status: 'monetized', priceJpy, paywallLinePos: split.pos };
    }

    if (result.ok) {
      // dry_run: 有料ラインと価格まで通ったが更新はしていない (= KYC も通った証拠)。
      await finishJob(prisma, jobId, now(), {
        status: 'dry_run_ready',
        price_jpy: priceJpy,
        paywall_line_pos: split.pos,
        note: paidAllowed ? 'dry_run' : 'paid_publish_enabled が OFF のためドライラン',
      });
      log.info({ articleId, priceJpy }, 'pipeline.note.monetize dry-run 完了 (更新は押していない)');
      return { ok: true, status: 'dry_run_ready', priceJpy, paywallLinePos: split.pos };
    }

    log.warn({ articleId, reason: result.reason, fail_message: result.message }, 'pipeline.note.monetize failed');
    if (result.reason === 'not_logged_in') {
      await prisma.noteAccount
        .update({ where: { id: account.id }, data: { status: 'paused' } })
        .catch((err) => log.warn({ err: errMsg(err) }, 'account pause 失敗(無視)'));
      await notifyNoteSessionExpired(prisma, account.id, account.display_name, notify);
    }
    if (result.reason === 'kyc_required') {
      await notify(
        `⚠️ ANP: 「${article.title}」の有料化が note の本人情報登録(KYC)待ちで止まりました。note の「設定 › お支払先」を登録後に再実行してください。`,
      ).catch(() => {});
    }
    await finishJob(prisma, jobId, now(), { status: result.reason, error: result.message }, result.message);
    return { ok: false, status: result.reason, reason: result.reason };
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  } finally {
    try {
      await releaseLock({ noteArticleId: articleId, holder: `monetize:${jobId}` });
    } catch (releaseErr) {
      log.warn({ task: PIPELINE_NOTE_MONETIZE_TASK_NAME, jobId, articleId, err: releaseErr }, 'failed to release NoteLock');
    }
  }
}

async function finishJob(
  prisma: { job: PipelineNoteMonetizePrisma['job'] },
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
  prisma: { job: PipelineNoteMonetizePrisma['job'] },
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
    log.warn({ task: PIPELINE_NOTE_MONETIZE_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

export const pipelineNoteMonetizeTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  const { createPlaywrightNotePublishPort } = await import('./note-publish/playwright-note-publish-port.js');
  await runPipelineNoteMonetize(payload, { publishPort: createPlaywrightNotePublishPort() });
};
