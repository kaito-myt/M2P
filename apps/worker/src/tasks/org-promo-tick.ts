import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { pushLine } from './lib/line-auth-relay.js';

/**
 * `org.promo.tick` タスク (docs/06 §販促グロースループ / docs/02 F-073) — 販促本部の自己監視。
 *
 * 財務の `org.finance.tick`(予算ガード)と同型の「組織が自分で異常を検知して運営者に上げる」神経系を
 * 販促に持たせる。従来は promo_analyst が実エンゲージメントを見ずに戦略を立てていた(盲目)＋反応ゼロでも
 * 誰も運営者にアラートしなかった。この tick が **実測(promotion.metrics.fetch が保存)** を評価し、
 * 到達がほぼゼロ / フォロワーが伸びていない場合に `growth_alert`(needs_human) を1件起票し LINE 通知する。
 *
 * 判定は決定的(LLM 非依存)。暴走防止: 開いている growth_alert があれば重複起票しない。cron 日次。
 */

export const ORG_PROMO_TICK_TASK_NAME = 'org.promo.tick';

/** 実エンゲージメントを見る窓(日)。 */
const ENGAGEMENT_WINDOW_DAYS = 14;
/** 判定に必要な最小サンプル数(metrics 取得済み投稿)。これ未満なら reach 判定を保留。 */
const MIN_SAMPLE = 10;
/** 平均インプレッションがこの値未満なら「到達が危機的」。 */
const REACH_FLOOR = 50;
/** フォロワーがこの値未満なら依然コールドスタート(伸ばす施策が必要)。 */
const FOLLOWER_FLOOR = 100;
/** フォロワー推移を判定するのに必要な最小スパン(日)。 */
const GROWTH_SPAN_MIN_DAYS = 5;

const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'blocked', 'needs_human'];

export const OrgPromoTickPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  trigger: z.string().optional(),
});

export interface PromoPostMetricRow {
  impressions: number | null;
  likes: number | null;
}
export interface GrowthSnapshotRow {
  followers: number | null;
  captured_at: Date;
}

export interface OrgPromoTickPrisma {
  promotionPost: {
    findMany: (args: unknown) => Promise<PromoPostMetricRow[]>;
  };
  promotionGrowthSnapshot: {
    findMany: (args: unknown) => Promise<GrowthSnapshotRow[]>;
  };
  orgTask: {
    findMany: (args: {
      where: { division: string; status: { in: string[] }; kind: string };
      select: { id: true };
    }) => Promise<Array<{ id: string }>>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  job?: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface OrgPromoTickDeps {
  prisma?: OrgPromoTickPrisma;
  logger?: Logger;
  now?: () => Date;
  pushAlert?: (text: string) => Promise<boolean>;
}

export interface GrowthEngagement {
  sample: number;
  avg_impressions: number;
  sum_likes: number;
  max_impressions: number;
}
export interface GrowthTrend {
  latest_followers: number | null;
  prior_followers: number | null;
  span_days: number;
  delta: number | null;
}
export interface GrowthBreach {
  code: 'reach_critical' | 'growth_stalled' | 'cold_start';
  label: string;
  detail: string;
}

export interface OrgPromoTickResult {
  engagement: GrowthEngagement;
  trend: GrowthTrend;
  breaches: GrowthBreach[];
  alert_created: boolean;
  skipped_existing: boolean;
}

/** 実測配列 → エンゲージメント要約(決定的)。 */
export function summarizeEngagement(rows: PromoPostMetricRow[]): GrowthEngagement {
  const imps = rows.map((r) => r.impressions ?? 0);
  const sample = rows.length;
  const sumImp = imps.reduce((a, b) => a + b, 0);
  const sumLikes = rows.reduce((a, r) => a + (r.likes ?? 0), 0);
  return {
    sample,
    avg_impressions: sample > 0 ? Math.round((sumImp / sample) * 10) / 10 : 0,
    sum_likes: sumLikes,
    max_impressions: imps.length > 0 ? Math.max(...imps) : 0,
  };
}

/** スナップショット時系列 → フォロワー推移(最新 vs スパン先頭)。 */
export function summarizeTrend(snaps: GrowthSnapshotRow[], now: Date): GrowthTrend {
  // captured_at 昇順に整列。
  const sorted = [...snaps].sort((a, b) => a.captured_at.getTime() - b.captured_at.getTime());
  const withFollowers = sorted.filter((s) => s.followers != null);
  if (withFollowers.length === 0) {
    return { latest_followers: null, prior_followers: null, span_days: 0, delta: null };
  }
  const latest = withFollowers[withFollowers.length - 1]!;
  const earliest = withFollowers[0]!;
  const spanDays = (latest.captured_at.getTime() - earliest.captured_at.getTime()) / 86400_000;
  const prior = withFollowers.length >= 2 ? earliest.followers : null;
  const delta = prior != null && latest.followers != null ? latest.followers - prior : null;
  return {
    latest_followers: latest.followers,
    prior_followers: prior,
    span_days: Math.round(spanDays * 10) / 10,
    delta,
  };
}

/** エンゲージメント要約＋推移 → 違反リスト(決定的)。 */
export function evaluateGrowth(engagement: GrowthEngagement, trend: GrowthTrend): GrowthBreach[] {
  const breaches: GrowthBreach[] = [];
  // 到達が危機的: 十分なサンプルがあるのに平均インプレッションが床値未満。
  if (engagement.sample >= MIN_SAMPLE && engagement.avg_impressions < REACH_FLOOR) {
    breaches.push({
      code: 'reach_critical',
      label: '到達が危機的',
      detail: `直近${ENGAGEMENT_WINDOW_DAYS}日 ${engagement.sample}投稿の平均インプレッション ${engagement.avg_impressions}（最大 ${engagement.max_impressions} / 総いいね ${engagement.sum_likes}）。SNS投稿がほぼ誰にも届いていない。`,
    });
  }
  // 成長停滞: 十分なスパンの2点があるのにフォロワーが増えていない。
  if (trend.prior_followers != null && trend.span_days >= GROWTH_SPAN_MIN_DAYS && (trend.delta ?? 0) <= 0) {
    breaches.push({
      code: 'growth_stalled',
      label: 'フォロワー成長停滞',
      detail: `${trend.span_days}日でフォロワー増減 ${trend.delta}（現在 ${trend.latest_followers}）。投稿を続けてもフォロワーが増えていない。`,
    });
  }
  // コールドスタート: フォロワーが床値未満(伸ばす施策そのものが未達)。reach_critical と重複時は補足のみ。
  if (trend.latest_followers != null && trend.latest_followers < FOLLOWER_FLOOR && breaches.length === 0) {
    breaches.push({
      code: 'cold_start',
      label: 'コールドスタート',
      detail: `フォロワー ${trend.latest_followers} 人（${FOLLOWER_FLOOR}未満）。到達の土台が無く、フォロワー育成施策が必要。`,
    });
  }
  return breaches;
}

export async function runOrgPromoTick(
  payload: unknown,
  deps: OrgPromoTickDeps = {},
): Promise<OrgPromoTickResult> {
  const log = deps.logger ?? createLogger(`worker.${ORG_PROMO_TICK_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as OrgPromoTickPrisma);
  const now = deps.now ?? (() => new Date());
  const pushAlert = deps.pushAlert ?? pushLine;
  const jobId = (() => {
    const p = OrgPromoTickPayloadSchema.safeParse(payload);
    return p.success ? p.data.job_id : undefined;
  })();

  const nowTs = now();
  const since = new Date(nowTs.getTime() - ENGAGEMENT_WINDOW_DAYS * 86400_000);
  const snapSince = new Date(nowTs.getTime() - 30 * 86400_000);

  try {
    const [postRows, snapRows] = await Promise.all([
      prisma.promotionPost.findMany({
        where: {
          channel: 'x',
          status: 'posted',
          metrics_fetched_at: { not: null },
          posted_at: { gte: since },
        },
        select: { impressions: true, likes: true },
        take: 500,
      }),
      prisma.promotionGrowthSnapshot.findMany({
        where: { channel: 'x', captured_at: { gte: snapSince } },
        select: { followers: true, captured_at: true },
        orderBy: { captured_at: 'asc' },
        take: 60,
      }),
    ]);

    const engagement = summarizeEngagement(postRows);
    const trend = summarizeTrend(snapRows, nowTs);
    const breaches = evaluateGrowth(engagement, trend);

    const result: OrgPromoTickResult = {
      engagement,
      trend,
      breaches,
      alert_created: false,
      skipped_existing: false,
    };

    if (breaches.length > 0) {
      const existing = await prisma.orgTask.findMany({
        where: { division: 'promotion', status: { in: OPEN_STATUSES }, kind: 'growth_alert' },
        select: { id: true },
      });
      if (existing.length > 0) {
        result.skipped_existing = true;
      } else {
        const instruction = [
          'SNS販促の実測が危機水準に達しました。「投稿を増やす」ではフォロワー到達は改善しません。',
          '以下を踏まえ、(a)フォロワー育成施策の実行(価値投稿主役化・エンゲージメント施策・ターゲットフォロー)、',
          'または(b)Amazon側施策(カテゴリ/キーワード/価格/KU/A+)への戦略転換を判断してください。',
          '',
          ...breaches.map((b) => `- 【${b.label}】${b.detail}`),
          '',
          `参考: 直近${ENGAGEMENT_WINDOW_DAYS}日の平均インプレッション ${engagement.avg_impressions} / サンプル ${engagement.sample}投稿 / 現在フォロワー ${trend.latest_followers ?? '不明'}人`,
        ].join('\n');

        await prisma.orgTask.create({
          data: {
            division: 'promotion',
            owner_role: 'promo_mgr',
            assignee_role: 'human',
            kind: 'growth_alert',
            title: `販促グロース警告: ${breaches.map((b) => b.label).join(' / ')}`,
            instruction,
            status: 'needs_human',
            priority: 'should',
            result_json: { engagement, trend, breaches },
          },
        });
        result.alert_created = true;

        // 運営者へ LINE プッシュ(ベストエフォート)。
        const alertText = [
          '⚠️ 販促グロース警告（AI販促本部より）',
          ...breaches.map((b) => `・${b.label}: ${b.detail}`),
          '',
          `平均インプレッション ${engagement.avg_impressions}（${engagement.sample}投稿）/ フォロワー ${trend.latest_followers ?? '不明'}人`,
          '対応方針を /org のタスクで確認してください。',
        ].join('\n');
        await pushAlert(alertText).catch(() => false);
      }
    }

    if (jobId && prisma.job) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', finished_at: now(), error: null, result_json: result },
      });
    }
    log.info({ task: ORG_PROMO_TICK_TASK_NAME, breaches: breaches.length, alert_created: result.alert_created, skipped_existing: result.skipped_existing }, 'org.promo.tick done');
    return result;
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch {
        // best-effort
      }
    }
    log.warn({ task: ORG_PROMO_TICK_TASK_NAME, err }, 'org.promo.tick failed');
    throw err;
  }
}

export const orgPromoTickTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runOrgPromoTick(payload);
};
