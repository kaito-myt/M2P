/**
 * `note.sales.fetch` タスク (docs/11-anp-design.md §3.5 F-ANP-40 / §7 Phase3)。
 *
 * note ダッシュボードを READ-ONLY で開き、記事別のビュー/スキ/売上とアカウントのフォロワー数/
 * メンバーシップ課金者数を取得して `note_sales` / `note_membership_stats` / `note_accounts` に
 * 保存する (A2P の KDP 売上取得 `docs/09` と同型)。
 *
 * ダッシュボードの期間セレクタを「今月」に切り替えてから取得するため(`playwright-note-sales-port.ts`)、
 * `note_sales`/`note_membership_stats` の `revenue_jpy`/`views`/`likes` 等は**当月実績**であり、
 * A2P S-002 の「当月純利益 = 当月売上 − 当月コスト」定義と整合する(累計値ではない、docs/11 §2.2)。
 * `/dashboard/salesmanage` `/dashboard/sales` はパスワード再確認(ステップアップ認証)を要求され
 * セッション再利用では取得できないため、`note_sales.buyers`(購入者数) は取得経路が無く常に 0
 * (best-effort、docs/11 §2.2 参照)。
 *
 * 冪等性: 内部 `Job` の CAS 遷移 (queued/failed→running→done/failed)、`NoteLock` は使わない
 * (READ-ONLY・排他不要、`note.publish.status.sync` と同型)。
 */
import type { Task } from 'graphile-worker';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import type { NoteSalesPort } from './note-sales/playwright-note-sales-port.js';

export const NOTE_SALES_FETCH_TASK_NAME = 'note.sales.fetch';

export const NoteSalesFetchPayloadSchema = z.object({
  note_account_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type NoteSalesFetchPayload = z.infer<typeof NoteSalesFetchPayloadSchema>;

interface NoteAccountRow {
  id: string;
  display_name: string;
  handle: string | null;
  session_state_enc: string | null;
}
interface NoteArticleRow {
  id: string;
  note_url: string | null;
}

export interface NoteSalesFetchPrisma {
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
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; display_name: true; handle: true; session_state_enc: true };
    }) => Promise<NoteAccountRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  noteArticle: {
    findMany: (args: {
      where: { note_account_id: string; note_url: { not: null } };
      select: { id: true; note_url: true };
    }) => Promise<NoteArticleRow[]>;
  };
  noteSalesRecord: {
    findFirst: (args: {
      where: { note_article_id: string; year_month: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    update: (args: {
      where: { id: string };
      data: { revenue_jpy: number; views: number; likes: number; buyers: number; source: string; fetched_at: Date };
    }) => Promise<unknown>;
    create: (args: {
      data: {
        note_article_id: string;
        year_month: string;
        revenue_jpy: number;
        views: number;
        likes: number;
        buyers: number;
        source: string;
        fetched_at: Date;
      };
    }) => Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
  noteMembershipStat: {
    findFirst: (args: {
      where: { note_account_id: string; year_month: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    update: (args: {
      where: { id: string };
      data: { subscribers: number; mrr_jpy: number; fetched_at: Date };
    }) => Promise<unknown>;
    create: (args: {
      data: { note_account_id: string; year_month: string; subscribers: number; mrr_jpy: number; fetched_at: Date };
    }) => Promise<unknown>;
  };
}

export interface NoteSalesFetchDeps {
  prisma?: NoteSalesFetchPrisma;
  logger?: Logger;
  now?: () => Date;
  salesPort: NoteSalesPort;
  decryptSession?: (enc: string) => string;
  notify?: (text: string) => Promise<boolean>;
}

export interface NoteSalesFetchResult {
  ok: boolean;
  status: string;
  articlesUpdated?: number;
}

/** JST 基準の "YYYY-MM"。 */
function jstYearMonth(now: Date): string {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function runNoteSalesFetch(
  payload: unknown,
  deps: NoteSalesFetchDeps,
): Promise<NoteSalesFetchResult> {
  const parsed = NoteSalesFetchPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.sales.fetch payload が不正です', { details: { issues: parsed.error.issues } });
  }
  const { note_account_id: accountId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${NOTE_SALES_FETCH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteSalesFetchPrisma);
  const now = deps.now ?? (() => new Date());
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  const notify = deps.notify ?? pushLine;

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, accountId } });
  }
  if (existing.status === 'done') {
    return { ok: true, status: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    return { ok: true, status: 'skipped' };
  }

  try {
    const account = await prisma.noteAccount.findUnique({
      where: { id: accountId },
      select: { id: true, display_name: true, handle: true, session_state_enc: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${accountId}`, { details: { accountId, jobId } });
    }
    if (!account.session_state_enc) {
      await finishJob(prisma, jobId, now(), { status: 'no_session' });
      return { ok: false, status: 'no_session' };
    }

    let sessionState: string;
    try {
      sessionState = decryptSession(account.session_state_enc);
    } catch (err) {
      log.warn({ err: errMsg(err), accountId }, 'note session 復号失敗');
      await finishJob(prisma, jobId, now(), { status: 'session_decrypt_failed' });
      return { ok: false, status: 'session_decrypt_failed' };
    }

    const result = await deps.salesPort.fetchStats({ sessionState, handle: account.handle }).catch((err) => ({
      ok: false as const,
      reason: 'error' as const,
      message: errMsg(err),
    }));

    if (!result.ok) {
      if (result.reason === 'not_logged_in') {
        await prisma.noteAccount.update({ where: { id: accountId }, data: { status: 'paused' } }).catch(() => {});
        await notifyNoteSessionExpired(prisma, accountId, account.display_name, notify);
      }
      log.warn({ accountId, reason: result.reason, message: result.message }, 'note.sales.fetch failed');
      await finishJob(prisma, jobId, now(), { status: result.reason, error: result.message }, result.message);
      return { ok: false, status: result.reason };
    }

    // フォロワー総数の更新 (取得できた場合のみ)。
    if (result.followers !== null) {
      await prisma.noteAccount
        .update({ where: { id: accountId }, data: { followers_total: result.followers, followers_fetched_at: now() } })
        .catch((err) => log.warn({ err: errMsg(err), accountId }, 'followers_total 更新失敗(無視)'));
    }

    // メンバーシップ (アカウントに 1 マガジンでも設定があれば upsert、無ければスキップ)。
    if (result.membership) {
      const ym = jstYearMonth(now());
      const existingStat = await prisma.noteMembershipStat.findFirst({
        where: { note_account_id: accountId, year_month: ym },
        select: { id: true },
      });
      const data = { subscribers: result.membership.subscribers, mrr_jpy: result.membership.mrrJpy, fetched_at: now() };
      if (existingStat) {
        await prisma.noteMembershipStat.update({ where: { id: existingStat.id }, data });
      } else {
        await prisma.noteMembershipStat.create({ data: { note_account_id: accountId, year_month: ym, ...data } });
      }
    }

    // 記事別売上/ビュー/スキを note_url で突合して upsert。
    const articles = await prisma.noteArticle.findMany({
      where: { note_account_id: accountId, note_url: { not: null } },
      select: { id: true, note_url: true },
    });
    const byUrl = new Map(articles.map((a) => [a.note_url, a.id]));
    const ym = jstYearMonth(now());
    let updated = 0;
    for (const stat of result.articles) {
      const articleId = byUrl.get(stat.noteUrl);
      if (!articleId) continue; // このアカウント/note_url に対応する NoteArticle が無い(共有セッションの他コンテンツ等)
      const data = {
        revenue_jpy: stat.revenueJpy,
        views: stat.views,
        likes: stat.likes,
        buyers: 0, // 購入者数はステップアップ認証ページ限定のため取得不可 (docs/11 §2.2)
        source: 'scrape',
        fetched_at: now(),
      };
      const existingRecord = await prisma.noteSalesRecord.findFirst({
        where: { note_article_id: articleId, year_month: ym },
        select: { id: true },
      });
      if (existingRecord) {
        await prisma.noteSalesRecord.update({ where: { id: existingRecord.id }, data });
      } else {
        await prisma.noteSalesRecord.create({ data: { note_article_id: articleId, year_month: ym, ...data } });
      }
      updated++;
    }

    await finishJob(prisma, jobId, now(), { status: 'ok', articlesUpdated: updated });
    log.info({ accountId, articlesUpdated: updated }, 'note.sales.fetch done');
    return { ok: true, status: 'ok', articlesUpdated: updated };
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  }
}

async function finishJob(
  prisma: { job: NoteSalesFetchPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  resultJson: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  await prisma.job
    .update({ where: { id: jobId }, data: { status: 'done', finished_at: finishedAt, error: errorMessage ?? null, result_json: resultJson } })
    .catch(() => {});
}

async function failJob(
  prisma: { job: NoteSalesFetchPrisma['job'] },
  jobId: string,
  finishedAt: Date,
  err: unknown,
  log: Logger,
): Promise<void> {
  try {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: finishedAt, error: serializeError(err) } });
  } catch (jobUpdateErr) {
    log.warn({ task: NOTE_SALES_FETCH_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

export const noteSalesFetchTask: Task = async (payload: unknown) => {
  const { createPlaywrightNoteSalesPort } = await import('./note-sales/playwright-note-sales-port.js');
  await runNoteSalesFetch(payload, { salesPort: createPlaywrightNoteSalesPort() });
};
