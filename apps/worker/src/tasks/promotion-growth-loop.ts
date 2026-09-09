import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { PROMOTION_CHANNELS } from '@a2p/contracts/promotion/channels';
import { prisma as defaultPrisma } from '@a2p/db';

// 実在の投稿チャンネルのみ。'sns' 等のレガシー集約チャンネルは content.generate/playbook の
// payload バリデーション(PromotionChannelSchema)で弾かれ、ジョブが延々失敗するため除外する。
const VALID_CHANNELS: ReadonlySet<string> = new Set(PROMOTION_CHANNELS);

import { pushLine, isLineRelayConfigured } from './lib/line-auth-relay.js';
import {
  summarizeEngagement,
  summarizeTrend,
  evaluateGrowth,
  type GrowthEngagement,
  type GrowthTrend,
} from './org-promo-tick.js';

/**
 * `promotion.growth.loop` タスク (F-081, 2026-08-19) — 販促強化の継続 AI ループ。
 *
 * org.promo.tick が「異常を検知して運営者にアラートする神経系(受動)」なのに対し、本ループは
 * **自分で販促を強化し続ける能動系**。実測(到達/フォロワー推移/投稿キュー残量/プレイブック鮮度)を
 * 決定的に評価し、必要な強化アクションを **AI サブタスクの再起動** として自動実行する:
 *   - 価値投稿キューが薄い/到達が弱い → `promotion.content.generate`(content_creator=AI で良書紹介を再生成)
 *   - プレイブックが古い/到達が弱い → `promotion.playbook.refresh`(web_search リサーチをAIで更新)
 *   - エンゲージ engine が OFF → 有効化を推奨(自動ONはしない=キルスイッチ尊重)
 * 実行内容と「黒字化に向けた現状(売上/フォロワー)」を org_task(kind=growth_loop, approved) と LINE に残す。
 *
 * マスタスイッチ `promo_growth_loop_enabled`(既定OFF)。判定は決定的(LLMはサブタスク側)でテスト可能。
 */

export const PROMOTION_GROWTH_LOOP_TASK_NAME = 'promotion.growth.loop';
const CONTENT_GENERATE_TASK = 'promotion.content.generate';
const PLAYBOOK_REFRESH_TASK = 'promotion.playbook.refresh';

/** 価値投稿(予約)がこの本数未満なら「キューが薄い」= 再生成する。 */
const MIN_VALUE_QUEUE = 6;
/** プレイブックがこの日数より古ければ「陳腐化」= リサーチ更新する。 */
const PLAYBOOK_STALE_DAYS = 10;
/** 1回の実行での上限(暴走・キュー乱造防止)。 */
const MAX_CONTENT_REGEN = 5;
const MAX_PLAYBOOK_REFRESH = 3;
const ENGAGEMENT_WINDOW_DAYS = 14;
const H = 3600_000;
const D = 86400_000;

export const PromotionGrowthLoopPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  trigger: z.string().optional(),
  /** テスト/手動: マスタスイッチを無視して実行。 */
  force: z.boolean().optional(),
});

export interface ChannelState {
  channel: string;
  auto_enabled: boolean;
  scheduled_value: number;
  playbook_stale: boolean;
}

export interface GrowthLoopInputs {
  engagement: GrowthEngagement;
  trend: GrowthTrend;
  channels: ChannelState[];
  x_engage_enabled: boolean;
  sns_engage_enabled: boolean;
}

export type GrowthAction =
  | { type: 'regenerate_content'; channel: string; reason: string }
  | { type: 'refresh_playbook'; channel: string; reason: string }
  | { type: 'recommend'; note: string };

/**
 * 実測 → 強化アクション(決定的・純関数)。安全で可逆な施策のみ(コンテンツ再生成/リサーチ更新)。
 * 危険/不可逆な自動ON(エンゲージ engine)はしない — 推奨に留める(キルスイッチ尊重)。
 */
export function decideGrowthActions(inputs: GrowthLoopInputs): GrowthAction[] {
  const breaches = evaluateGrowth(inputs.engagement, inputs.trend);
  const reachBad = breaches.some((b) => b.code === 'reach_critical' || b.code === 'growth_stalled');

  const contentActions: GrowthAction[] = [];
  const playbookActions: GrowthAction[] = [];
  const active = inputs.channels.filter((c) => c.auto_enabled);

  for (const c of active) {
    if (c.scheduled_value < MIN_VALUE_QUEUE) {
      contentActions.push({ type: 'regenerate_content', channel: c.channel, reason: `予約投稿が${c.scheduled_value}件(<${MIN_VALUE_QUEUE})でキューが薄い` });
    } else if (reachBad) {
      contentActions.push({ type: 'regenerate_content', channel: c.channel, reason: '到達が弱いため良書紹介投稿を刷新' });
    }
    if (c.playbook_stale) {
      playbookActions.push({ type: 'refresh_playbook', channel: c.channel, reason: `プレイブックが${PLAYBOOK_STALE_DAYS}日以上未更新` });
    }
  }
  // 到達が弱いときは X のプレイブックを必ず更新(リサーチを深める)。
  if (reachBad && active.some((c) => c.channel === 'x') && !playbookActions.some((a) => a.type === 'refresh_playbook' && a.channel === 'x')) {
    playbookActions.push({ type: 'refresh_playbook', channel: 'x', reason: '到達が弱いためXのリサーチを更新' });
  }

  const recs: GrowthAction[] = [];
  if (!inputs.x_engage_enabled) recs.push({ type: 'recommend', note: 'X能動エンゲージ(自動いいね/フォロー)がOFF。有効化でフォロワー到達が上がります。' });
  if (!inputs.sns_engage_enabled) recs.push({ type: 'recommend', note: 'IG/TikTok自動フォローがOFF。有効化を推奨。' });

  return [
    ...contentActions.slice(0, MAX_CONTENT_REGEN),
    ...playbookActions.slice(0, MAX_PLAYBOOK_REFRESH),
    ...recs,
  ];
}

export interface AddJobLike {
  (task: string, payload?: unknown, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface PromotionGrowthLoopPrisma {
  appSettings: {
    findUnique: (args: unknown) => Promise<{ promo_growth_loop_enabled?: boolean; x_engage_enabled?: boolean; sns_engage_enabled?: boolean } | null>;
  };
  promotionChannelSetting: {
    findMany: (args: unknown) => Promise<Array<{ channel: string; auto_enabled: boolean; playbook_updated_at: Date | null }>>;
  };
  promotionPost: {
    findMany: (args: unknown) => Promise<Array<{ impressions: number | null; likes: number | null }>>;
    count: (args: unknown) => Promise<number>;
  };
  promotionGrowthSnapshot: {
    findMany: (args: unknown) => Promise<Array<{ followers: number | null; captured_at: Date }>>;
  };
  salesRecord?: {
    aggregate?: (args: unknown) => Promise<{ _sum?: { royalty_jpy?: number | null } }>;
  };
  tokenUsage?: {
    aggregate?: (args: unknown) => Promise<{ _sum?: { cost_jpy?: number | null } }>;
  };
  recurringCost?: {
    aggregate?: (args: unknown) => Promise<{ _sum?: { monthly_jpy?: number | null } }>;
  };
  orgTask: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  job?: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
}

export interface PromotionGrowthLoopDeps {
  prisma?: PromotionGrowthLoopPrisma;
  logger?: Logger;
  now?: () => Date;
  addJob?: AddJobLike;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface PromotionGrowthLoopResult {
  enabled: boolean;
  actions: GrowthAction[];
  executed: { content: number; playbook: number };
  revenue_month_jpy: number | null;
  /** 当月のAI従量原価(token_usage)。 */
  ai_cost_month_jpy: number | null;
  /** 固定月額原価(recurring_costs: X API/ホスティング/投稿等)。 */
  fixed_cost_month_jpy: number | null;
  /** 損益 = 売上 −(AI原価 + 固定費)。負なら赤字。 */
  profit_month_jpy: number | null;
  latest_followers: number | null;
}

export async function runPromotionGrowthLoop(
  payload: unknown,
  deps: PromotionGrowthLoopDeps = {},
): Promise<PromotionGrowthLoopResult> {
  const log = deps.logger ?? createLogger(`worker.${PROMOTION_GROWTH_LOOP_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionGrowthLoopPrisma);
  const now = deps.now ?? (() => new Date());
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const parsed = PromotionGrowthLoopPayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const force = parsed.success ? parsed.data.force : false;

  const result: PromotionGrowthLoopResult = {
    enabled: false,
    actions: [],
    executed: { content: 0, playbook: 0 },
    revenue_month_jpy: null,
    ai_cost_month_jpy: null,
    fixed_cost_month_jpy: null,
    profit_month_jpy: null,
    latest_followers: null,
  };

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { promo_growth_loop_enabled: true, x_engage_enabled: true, sns_engage_enabled: true },
    });
    if (!settings?.promo_growth_loop_enabled && !force) {
      return await finalize(result);
    }
    result.enabled = true;

    const nowTs = now();
    const since = new Date(nowTs.getTime() - ENGAGEMENT_WINDOW_DAYS * D);
    const snapSince = new Date(nowTs.getTime() - 30 * D);

    // 実測を収集。
    const [postRows, snapRows, channelRows] = await Promise.all([
      prisma.promotionPost.findMany({
        where: { channel: 'x', status: 'posted', metrics_fetched_at: { not: null }, posted_at: { gte: since } },
        select: { impressions: true, likes: true },
        take: 500,
      }),
      prisma.promotionGrowthSnapshot.findMany({
        where: { channel: 'x', captured_at: { gte: snapSince } },
        select: { followers: true, captured_at: true },
        orderBy: { captured_at: 'asc' },
        take: 60,
      }),
      prisma.promotionChannelSetting.findMany({
        where: {},
        select: { channel: true, auto_enabled: true, playbook_updated_at: true },
      }),
    ]);

    const engagement = summarizeEngagement(postRows);
    const trend = summarizeTrend(snapRows, nowTs);
    result.latest_followers = trend.latest_followers;

    // チャンネル別の予約投稿残量 + プレイブック鮮度。
    const staleBefore = new Date(nowTs.getTime() - PLAYBOOK_STALE_DAYS * D);
    const channels: ChannelState[] = [];
    for (const c of channelRows) {
      const scheduled = await prisma.promotionPost.count({
        where: { channel: c.channel, kind: 'value', status: 'scheduled', scheduled_for: { gte: nowTs } },
      });
      channels.push({
        channel: c.channel,
        auto_enabled: c.auto_enabled,
        scheduled_value: scheduled,
        playbook_stale: !c.playbook_updated_at || c.playbook_updated_at < staleBefore,
      });
    }

    const inputs: GrowthLoopInputs = {
      engagement,
      trend,
      channels,
      x_engage_enabled: Boolean(settings?.x_engage_enabled),
      sns_engage_enabled: Boolean(settings?.sns_engage_enabled),
    };
    const actions = decideGrowthActions(inputs);
    result.actions = actions;

    // アクションを実行(AIサブタスクを再起動)。
    for (const a of actions) {
      // 無効チャンネル('sns'等の集約)は enqueue しない(payload不正で無限失敗するため)。
      if (a.type === 'regenerate_content' && deps.addJob) {
        if (!VALID_CHANNELS.has(a.channel)) continue;
        await deps.addJob(CONTENT_GENERATE_TASK, { channel: a.channel }).then(() => { result.executed.content += 1; }).catch(() => {});
      } else if (a.type === 'refresh_playbook' && deps.addJob) {
        if (!VALID_CHANNELS.has(a.channel)) continue;
        await deps.addJob(PLAYBOOK_REFRESH_TASK, { channel: a.channel }).then(() => { result.executed.playbook += 1; }).catch(() => {});
      }
    }

    // 黒字化フレーミング: 当月ロイヤリティ − (AI従量原価 + 固定月額原価) = 損益。
    const ym = `${nowTs.getUTCFullYear()}-${String(nowTs.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthStart = new Date(Date.UTC(nowTs.getUTCFullYear(), nowTs.getUTCMonth(), 1));
    if (prisma.salesRecord?.aggregate) {
      const agg = await prisma.salesRecord.aggregate({ where: { year_month: ym }, _sum: { royalty_jpy: true } }).catch(() => null);
      result.revenue_month_jpy = agg?._sum?.royalty_jpy ?? 0;
    }
    if (prisma.tokenUsage?.aggregate) {
      const agg = await prisma.tokenUsage.aggregate({ where: { created_at: { gte: monthStart } }, _sum: { cost_jpy: true } }).catch(() => null);
      result.ai_cost_month_jpy = Math.round(Number(agg?._sum?.cost_jpy ?? 0));
    }
    if (prisma.recurringCost?.aggregate) {
      // 固定費は月額なので当月分としてそのまま合算(有効なもののみ)。
      const agg = await prisma.recurringCost.aggregate({ where: { active: true }, _sum: { monthly_jpy: true } }).catch(() => null);
      result.fixed_cost_month_jpy = Math.round(Number(agg?._sum?.monthly_jpy ?? 0));
    }
    if (result.revenue_month_jpy != null) {
      result.profit_month_jpy = result.revenue_month_jpy - (result.ai_cost_month_jpy ?? 0) - (result.fixed_cost_month_jpy ?? 0);
    }

    // 実行記録(org_task, approved=自動) + LINE。
    const recs = actions.filter((a): a is Extract<GrowthAction, { type: 'recommend' }> => a.type === 'recommend');
    const profit = result.profit_month_jpy;
    const profitLabel = profit == null ? '不明' : `${profit >= 0 ? '黒字' : '赤字'} ${profit.toLocaleString('ja-JP')}円`;
    const summaryLines = [
      '【販促強化ループ実行】黒字化に向けた継続強化を自動実行しました。',
      `・良書紹介投稿の再生成: ${result.executed.content}チャンネル`,
      `・プレイブック(市場リサーチ)更新: ${result.executed.playbook}チャンネル`,
      `・現状: フォロワー ${trend.latest_followers ?? '不明'}人 / 直近${ENGAGEMENT_WINDOW_DAYS}日 平均インプレッション ${engagement.avg_impressions}(${engagement.sample}投稿)`,
      `・当月収支: 売上 ${result.revenue_month_jpy ?? 0}円 − AI原価 ${result.ai_cost_month_jpy ?? 0}円 − 固定費 ${result.fixed_cost_month_jpy ?? 0}円 = 【${profitLabel}】`,
      ...(result.fixed_cost_month_jpy === 0 ? ['  ※固定費(X API月額等)が未登録です。/settings で登録すると収支が正確になります。'] : []),
      ...(recs.length > 0 ? ['', '■ 運営者への推奨(自動ONはしていません):', ...recs.map((r) => `- ${r.note}`)] : []),
    ];
    const instruction = summaryLines.join('\n');

    await prisma.orgTask.create({
      data: {
        division: 'promotion',
        owner_role: 'promo_mgr',
        assignee_role: 'promo_mgr',
        kind: 'growth_loop',
        title: `販促強化ループ: 再生成${result.executed.content}/リサーチ${result.executed.playbook}`,
        instruction,
        status: 'approved',
        priority: 'should',
        result_json: {
          engagement,
          trend,
          actions,
          executed: result.executed,
          revenue_month_jpy: result.revenue_month_jpy,
          ai_cost_month_jpy: result.ai_cost_month_jpy,
          fixed_cost_month_jpy: result.fixed_cost_month_jpy,
          profit_month_jpy: result.profit_month_jpy,
        },
      },
    }).catch(() => ({ id: '' }));

    if (lineConfigured() && (result.executed.content + result.executed.playbook > 0 || recs.length > 0)) {
      await pushAlert(
        [
          '📈 販促強化ループ（AI販促本部）',
          `良書紹介の再生成 ${result.executed.content}ch / リサーチ更新 ${result.executed.playbook}ch`,
          `フォロワー ${trend.latest_followers ?? '不明'}人`,
          `当月収支: 売上${result.revenue_month_jpy ?? 0}円 −AI${result.ai_cost_month_jpy ?? 0}円 −固定${result.fixed_cost_month_jpy ?? 0}円 = ${profitLabel}`,
          ...(recs.length > 0 ? recs.map((r) => `※ ${r.note}`) : []),
        ].join('\n'),
      ).catch(() => false);
    }

    log.info({ task: PROMOTION_GROWTH_LOOP_TASK_NAME, executed: result.executed, actions: actions.length }, 'promotion.growth.loop done');
    return await finalize(result);
  } catch (err) {
    if (jobId && prisma.job) {
      try { await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } }); } catch { /* noop */ }
    }
    log.warn({ task: PROMOTION_GROWTH_LOOP_TASK_NAME, err }, 'promotion.growth.loop failed');
    throw err;
  }

  async function finalize(r: PromotionGrowthLoopResult): Promise<PromotionGrowthLoopResult> {
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: r } });
    }
    return r;
  }
}

export const promotionGrowthLoopTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPromotionGrowthLoop(payload, { addJob: helpers.addJob as unknown as AddJobLike });
};
