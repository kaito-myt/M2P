import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';

/**
 * `kdp.publish.digest` タスク (PUB-3, 2026-08-14) — 出版活動の日次サマリを運営者へ LINE 通知。
 *
 * 背景: 運営者から「出版の通知が来ない／失敗時は原因も報告して」と要望。従来は
 * (a) 出版完了(LIVE)通知は `kdp.publish.status.sync` が LIVE 検知時のみ、
 * (b) creation_limit 失敗は連投スパム防止のため**意図的に無通知**、だったため、
 * 「何も起きていないように見える」状態が続いていた。本タスクが毎日1回、
 * **公開/審査待ち/作成上限で待機/失敗** を1通にまとめて必ず通知する（完了ゼロでも状況が分かる）。
 *
 * 判定は決定的(LLM 非依存)。cron 日次・常時ON。
 */

export const KDP_PUBLISH_DIGEST_TASK_NAME = 'kdp.publish.digest';

export const KdpPublishDigestPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
});

export interface KdpPublishDigestPrisma {
  book: {
    findMany: (args: unknown) => Promise<Array<{ title: string; publish_status: string; kdp_submit_cooldown_until: Date | null }>>;
  };
  job?: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface KdpPublishDigestDeps {
  prisma?: KdpPublishDigestPrisma;
  logger?: Logger;
  now?: () => Date;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface PublishDigestBook {
  title: string;
  publish_status: string;
  kdp_submit_cooldown_until: Date | null;
}

export interface KdpPublishDigestResult {
  published_24h: number;
  submitted_waiting: number;
  blocked_creation_limit: number;
  queued_ready: number;
  notified: boolean;
}

/** 本一覧＋現在時刻 → 日次サマリ集計(決定的)。 */
export function summarizePublishDigest(
  books: PublishDigestBook[],
  publishedTitles24h: string[],
  now: Date,
): Omit<KdpPublishDigestResult, 'notified'> & { blockedTitles: string[]; submittedTitles: string[] } {
  const submitted = books.filter((b) => b.publish_status === 'submitted');
  const queued = books.filter((b) => b.publish_status === 'unlisted'); // kdp_publish_queued 前提で渡す
  const blocked = queued.filter((b) => b.kdp_submit_cooldown_until != null && b.kdp_submit_cooldown_until > now);
  const ready = queued.filter((b) => b.kdp_submit_cooldown_until == null || b.kdp_submit_cooldown_until <= now);
  return {
    published_24h: publishedTitles24h.length,
    submitted_waiting: submitted.length,
    blocked_creation_limit: blocked.length,
    queued_ready: ready.length,
    blockedTitles: blocked.map((b) => b.title),
    submittedTitles: submitted.map((b) => b.title),
  };
}

/** サマリ → LINE 本文(日本語)。 */
export function formatDigestMessage(
  s: Omit<KdpPublishDigestResult, 'notified'> & { blockedTitles: string[]; submittedTitles: string[] },
  publishedTitles24h: string[],
): string {
  const lines: string[] = ['📚 A2P 出版デイリーレポート'];
  if (publishedTitles24h.length > 0) {
    lines.push('', `✅ 本日Kindleで販売開始(LIVE): ${publishedTitles24h.length}冊`);
    lines.push(...publishedTitles24h.slice(0, 10).map((t) => `・${t}`));
  } else {
    lines.push('', '✅ 本日LIVEになった本: なし');
  }
  lines.push('', `⏳ 審査待ち(入稿済・LIVE前): ${s.submitted_waiting}冊`);
  lines.push(`🟢 入稿キュー(本日処理予定): ${s.queued_ready}冊`);
  if (s.blocked_creation_limit > 0) {
    lines.push(
      '',
      `🚫 作成上限で待機中: ${s.blocked_creation_limit}冊`,
      '　原因: KDPの「1日5冊まで」の新規作成上限に到達。翌日クールダウン明けに自動で順次再試行します（対処不要）。',
    );
  }
  if (s.submitted_waiting >= 5) {
    lines.push('', '※ 審査待ちが滞留しています。KDP側の審査遅延、または入稿が最終確定できていない可能性があります。');
  }
  return lines.join('\n');
}

export async function runKdpPublishDigest(
  payload: unknown,
  deps: KdpPublishDigestDeps = {},
): Promise<KdpPublishDigestResult> {
  const log = deps.logger ?? createLogger(`worker.${KDP_PUBLISH_DIGEST_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as KdpPublishDigestPrisma);
  const now = deps.now ?? (() => new Date());
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const jobId = (() => {
    const p = KdpPublishDigestPayloadSchema.safeParse(payload);
    return p.success ? p.data.job_id : undefined;
  })();

  const nowTs = now();
  const since24h = new Date(nowTs.getTime() - 24 * 3600_000);

  try {
    // published (LIVE) は updated_at で「直近24hに昇格」を近似。
    const published24h = await prisma.book.findMany({
      where: { publish_status: 'published', updated_at: { gte: since24h } },
      select: { title: true, publish_status: true, kdp_submit_cooldown_until: true },
    });
    // submitted(審査待ち) 全件。
    const submitted = await prisma.book.findMany({
      where: { publish_status: 'submitted' },
      select: { title: true, publish_status: true, kdp_submit_cooldown_until: true },
    });
    // 入稿キュー(unlisted かつ queued)。
    const queued = await prisma.book.findMany({
      where: { publish_status: 'unlisted', kdp_publish_queued: true },
      select: { title: true, publish_status: true, kdp_submit_cooldown_until: true },
    });

    const publishedTitles24h = published24h.map((b) => b.title);
    const s = summarizePublishDigest([...submitted, ...queued], publishedTitles24h, nowTs);
    const msg = formatDigestMessage(s, publishedTitles24h);

    let notified = false;
    if (lineConfigured()) {
      notified = await pushAlert(msg).catch(() => false);
    }

    const result: KdpPublishDigestResult = {
      published_24h: s.published_24h,
      submitted_waiting: s.submitted_waiting,
      blocked_creation_limit: s.blocked_creation_limit,
      queued_ready: s.queued_ready,
      notified,
    };
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: result } });
    }
    log.info({ task: KDP_PUBLISH_DIGEST_TASK_NAME, ...result }, 'kdp.publish.digest done');
    return result;
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch { /* best-effort */ }
    }
    log.warn({ task: KDP_PUBLISH_DIGEST_TASK_NAME, err }, 'kdp.publish.digest failed');
    throw err;
  }
}

export const kdpPublishDigestTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runKdpPublishDigest(payload);
};
