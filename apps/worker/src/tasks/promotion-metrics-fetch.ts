import type { JobHelpers, Task } from 'graphile-worker';

import { buildXAuthHeader, decryptApiKey, parseXCredentials } from '@a2p/crypto';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `promotion.metrics.fetch` タスク (2026-08-10, F-072) — 販促「実績」トラッキングの第一歩。
 *
 * 投稿済み SNS の実エンゲージメント(インプレッション/いいね/リポスト/返信)を取得し
 * `promotion_posts` に保存する。これにより promo_analyst/戦略が「投稿件数」ではなく
 * 「実際の反応」に基づいて最適化できるようになる（従来は実測ゼロで戦略が盲目だった）。
 *
 * まず **X (Twitter)** から着手。X は投稿時に tweet URL/ID を保存済みなので、
 * `GET /2/tweets?ids=...&tweet.fields=public_metrics` を OAuth1 で叩けば取得できる。
 * IG/TikTok は投稿ID未保存＋公式インサイトAPI要のため後続対応（docs/06 §販促実測ループ）。
 *
 * 冪等・低コスト: 直近30日の posted X 行のうち metrics 未取得 or 6h 以上前のものを
 * 最大 BATCH 件、1回の GET(最大100 IDs) でまとめて更新する。cron 日次。
 */

export const PROMOTION_METRICS_FETCH_TASK_NAME = 'promotion.metrics.fetch';

const X_API_TWEETS_URL = 'https://api.twitter.com/2/tweets';
const X_API_ME_URL = 'https://api.twitter.com/2/users/me';
const BATCH = 100; // X の /2/tweets は最大 100 IDs/call
const REFRESH_HOURS = 6;
const LOOKBACK_DAYS = 30;

interface PostRow {
  id: string;
  external_url: string | null;
}

export interface PromotionMetricsFetchPrisma {
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { token_enc: true };
    }) => Promise<{ token_enc: string | null } | null>;
  };
  promotionPost: {
    findMany: (args: unknown) => Promise<PostRow[]>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  promotionGrowthSnapshot?: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  job?: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface PromotionMetricsFetchDeps {
  prisma?: PromotionMetricsFetchPrisma;
  logger?: Logger;
  now?: () => Date;
  doFetch?: FetchLike;
  decryptToken?: (enc: string) => string;
}

export interface PromotionMetricsFetchResult {
  scanned: number;
  updated: number;
  followers?: number | null; // [F-073] 取得時点のXフォロワー数
  skipped_reason?: string;
}

/** external_url ("https://x.com/<handle>/status/<id>") から tweet ID を抽出。 */
export function extractTweetId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/status\/(\d{5,25})/);
  return m ? m[1]! : null;
}

export async function runPromotionMetricsFetch(
  payload: unknown,
  deps: PromotionMetricsFetchDeps = {},
): Promise<PromotionMetricsFetchResult> {
  const log = deps.logger ?? createLogger(`worker.${PROMOTION_METRICS_FETCH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionMetricsFetchPrisma);
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.doFetch ?? (globalThis.fetch as unknown as FetchLike);
  const decrypt = deps.decryptToken ?? ((enc: string) => decryptApiKey(enc));
  const jobId = (payload as { job_id?: string } | null)?.job_id;

  const result: PromotionMetricsFetchResult = { scanned: 0, updated: 0 };

  try {
    // 1. X チャンネルの資格情報を取得・復号。
    const setting = await prisma.promotionChannelSetting.findUnique({
      where: { channel: 'x' },
      select: { token_enc: true },
    });
    if (!setting?.token_enc) {
      result.skipped_reason = 'x_token_missing';
      log.warn({ task: PROMOTION_METRICS_FETCH_TASK_NAME }, 'X token not configured — skip');
      return await finalize(result);
    }
    let creds;
    try {
      creds = parseXCredentials(decrypt(setting.token_enc));
    } catch (e) {
      result.skipped_reason = 'x_token_decrypt_failed';
      log.warn({ task: PROMOTION_METRICS_FETCH_TASK_NAME, err: e }, 'X token decrypt failed — skip');
      return await finalize(result);
    }
    if (!creds) {
      result.skipped_reason = 'x_creds_invalid';
      return await finalize(result);
    }

    // 2. 対象投稿を取得（直近30日 posted・X・metrics 未取得 or REFRESH_HOURS 以上前）。
    const nowTs = now();
    const since = new Date(nowTs.getTime() - LOOKBACK_DAYS * 86400_000);
    const refreshBefore = new Date(nowTs.getTime() - REFRESH_HOURS * 3600_000);
    const rows = await prisma.promotionPost.findMany({
      where: {
        channel: 'x',
        status: 'posted',
        posted_at: { gte: since },
        external_url: { not: null },
        OR: [{ metrics_fetched_at: null }, { metrics_fetched_at: { lt: refreshBefore } }],
      },
      select: { id: true, external_url: true },
      orderBy: { posted_at: 'desc' },
      take: BATCH,
    });
    result.scanned = rows.length;
    if (rows.length === 0) return await finalize(result);

    const idToPost = new Map<string, string>();
    for (const r of rows) {
      const tid = extractTweetId(r.external_url);
      if (tid) idToPost.set(tid, r.id);
    }
    if (idToPost.size === 0) {
      result.skipped_reason = 'no_tweet_ids';
      return await finalize(result);
    }

    // 3. GET /2/tweets?ids=...&tweet.fields=public_metrics (OAuth1 署名に query を含める)。
    const ids = [...idToPost.keys()].join(',');
    const query = { ids, 'tweet.fields': 'public_metrics' };
    const qs = new URLSearchParams(query).toString();
    const authHeader = buildXAuthHeader('GET', X_API_TWEETS_URL, creds, { extraParams: query });
    const res = await doFetch(`${X_API_TWEETS_URL}?${qs}`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      result.skipped_reason = `x_api_${res.status}`;
      log.warn(
        { task: PROMOTION_METRICS_FETCH_TASK_NAME, status: res.status, body: body.slice(0, 300) },
        'X metrics API non-OK (読み取りが現行APIプランで許可されていない可能性)',
      );
      return await finalize(result);
    }
    const json = (await res.json()) as {
      data?: Array<{ id: string; public_metrics?: Record<string, number> }>;
    };
    const data = Array.isArray(json.data) ? json.data : [];

    // 4. 各行を更新。
    for (const t of data) {
      const postId = idToPost.get(t.id);
      if (!postId) continue;
      const m = t.public_metrics ?? {};
      await prisma.promotionPost.update({
        where: { id: postId },
        data: {
          impressions: m.impression_count ?? null,
          likes: m.like_count ?? null,
          reposts: m.retweet_count ?? null,
          replies: m.reply_count ?? null,
          metrics_fetched_at: nowTs,
        },
      });
      result.updated += 1;
    }

    // 5. [F-073] フォロワー数スナップショット。GET /2/users/me?user.fields=public_metrics。
    //    成長の時系列を残し org.promo.tick が「フォロワーが増えているか」を判定できるようにする。
    //    ベストエフォート（失敗してもメトリクス取得自体は成功扱い）。
    try {
      const meQuery = { 'user.fields': 'public_metrics' };
      const meQs = new URLSearchParams(meQuery).toString();
      const meAuth = buildXAuthHeader('GET', X_API_ME_URL, creds, { extraParams: meQuery });
      const meRes = await doFetch(`${X_API_ME_URL}?${meQs}`, { method: 'GET', headers: { Authorization: meAuth } });
      if (meRes.ok) {
        const meJson = (await meRes.json()) as { data?: { public_metrics?: Record<string, number> } };
        const pm = meJson.data?.public_metrics ?? {};
        const followers = pm.followers_count ?? null;
        result.followers = followers;
        if (prisma.promotionGrowthSnapshot) {
          await prisma.promotionGrowthSnapshot.create({
            data: {
              channel: 'x',
              followers,
              following: pm.following_count ?? null,
              posts_count: pm.tweet_count ?? null,
              captured_at: nowTs,
            },
          });
        }
      } else {
        log.warn({ task: PROMOTION_METRICS_FETCH_TASK_NAME, status: meRes.status }, 'X /users/me non-OK — follower snapshot skipped');
      }
    } catch (e) {
      log.warn({ task: PROMOTION_METRICS_FETCH_TASK_NAME, err: e }, 'follower snapshot failed (non-fatal)');
    }

    log.info({ task: PROMOTION_METRICS_FETCH_TASK_NAME, ...result }, 'X metrics fetched');
    return await finalize(result);
  } catch (err) {
    log.warn({ task: PROMOTION_METRICS_FETCH_TASK_NAME, err }, 'promotion.metrics.fetch failed');
    if (jobId && prisma.job?.update) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch { /* best-effort */ }
    }
    throw err;
  }

  async function finalize(r: PromotionMetricsFetchResult): Promise<PromotionMetricsFetchResult> {
    if (jobId && prisma.job?.update) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', finished_at: now(), error: null, result_json: r },
      });
    }
    return r;
  }
}

export const promotionMetricsFetchTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionMetricsFetch(payload);
};
