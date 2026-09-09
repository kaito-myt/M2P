import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { decryptApiKey } from '@a2p/crypto';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import type { GrowthScoutOutput } from '@a2p/contracts/agents/growth-scout';
import { prisma as defaultPrisma } from '@a2p/db';
import { generateGrowthTodo as defaultGenerate } from '@a2p/agents';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';
import { resolveKdpProxy } from './sales-fetch/kdp-proxy.js';
import { resolveActionUrl } from './promotion-growth-todo.js';
import { createPlaywrightSnsEngagePort } from './promotion-sns-engage/playwright-engage-port.js';
import { dailyCap, pickFollowTargets, type SnsEngagePort } from './promotion-sns-engage/engage-port.js';

/**
 * `promotion.sns.engage` タスク (F-077, 2026-08-18) — IG/TikTok ブラウザ自動フォロー。
 *
 * IG/TikTok はフォロー/いいねの公式APIが無い。本タスクは運営者が一度取り込んだログイン済み
 * セッション(promotion_channel_settings.browser_session_enc)を Playwright で再利用し、
 * growth_scout が web_search で特定した"フォローすべき実在アカウント"を自動フォローする。
 * 凍結リスクが高いため: マスタスイッチ `sns_engage_enabled`(既定OFF) + ランプアップ +
 * 1回少量 + ジッター + 重複防止 + アクションブロック検知で即停止&LINE通知。
 * データセンターIP対策として、住宅プロキシ(app_settings.kdp_proxy_*)が生きていれば経由する。
 */

export const PROMOTION_SNS_ENGAGE_TASK_NAME = 'promotion.sns.engage';

/** ブラウザ自動化の対象チャンネル(セッションがあるものだけ実処理)。 */
export const SNS_ENGAGE_CHANNELS = ['instagram', 'tiktok'] as const;
export type SnsEngageChannel = (typeof SNS_ENGAGE_CHANNELS)[number];

const PER_RUN_MAX = 4; // 1回の実行での最大フォロー数(cronで1日数回に分散)
const H = 3600_000;

const CHANNEL_LABEL: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok' };

export const PromotionSnsEngagePayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  /** 対象チャンネル限定(省略時は両方)。 */
  channel: z.enum(['instagram', 'tiktok']).optional(),
  /** テスト/手動: 当日上限を無視して override 件だけ実行。 */
  override_cap: z.number().int().min(0).max(30).optional(),
});

interface StrategyProfile {
  concept?: string;
  target_reader?: string;
  target_audience?: string;
  content_pillars?: unknown[];
}

export interface PromotionSnsEngagePrisma {
  appSettings: { findUnique: (args: unknown) => Promise<{ sns_engage_enabled: boolean } | null> };
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: Record<string, true>;
    }) => Promise<{ auto_enabled?: boolean; strategy_json?: unknown; browser_session_enc?: string | null } | null>;
  };
  promotionSnsEngagement: {
    findMany: (args: unknown) => Promise<Array<{ channel: string; action_type: string; target_handle: string }>>;
    count: (args: unknown) => Promise<number>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  job?: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
}

export interface PromotionSnsEngageDeps {
  prisma?: PromotionSnsEngagePrisma;
  logger?: Logger;
  now?: () => Date;
  port?: SnsEngagePort;
  decryptSession?: (enc: string) => string;
  generate?: (input: { channel: string; concept?: string | null; target_audience?: string | null; daily_target?: number }) => Promise<GrowthScoutOutput>;
  resolveProxy?: () => Promise<{ server: string; username?: string; password?: string } | null>;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface PromotionSnsEngageResult {
  enabled: boolean;
  per_channel: Record<string, { cap: number; already_today: number; followed: number; already: number; failed: number; blocked?: string }>;
  skipped: string[];
}

export async function runPromotionSnsEngage(
  payload: unknown,
  deps: PromotionSnsEngageDeps = {},
): Promise<PromotionSnsEngageResult> {
  const log = deps.logger ?? createLogger(`worker.${PROMOTION_SNS_ENGAGE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionSnsEngagePrisma);
  const now = deps.now ?? (() => new Date());
  const port = deps.port ?? createPlaywrightSnsEngagePort();
  const decrypt = deps.decryptSession ?? ((enc: string) => decryptApiKey(enc));
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const resolveProxy =
    deps.resolveProxy ?? (() => resolveKdpProxy(defaultPrisma as unknown as Parameters<typeof resolveKdpProxy>[0], now));
  const generate =
    deps.generate ??
    ((input: Parameters<NonNullable<PromotionSnsEngageDeps['generate']>>[0]) =>
      defaultGenerate({
        channel: input.channel,
        concept: input.concept ?? '',
        target_audience: input.target_audience ?? '',
        daily_target: input.daily_target ?? 15,
        recent_posts: [],
      }));

  const parsed = PromotionSnsEngagePayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const only = parsed.success ? parsed.data.channel : undefined;
  const overrideCap = parsed.success ? parsed.data.override_cap : undefined;
  const channels = only ? [only] : [...SNS_ENGAGE_CHANNELS];

  const result: PromotionSnsEngageResult = { enabled: false, per_channel: {}, skipped: [] };

  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { sns_engage_enabled: true } });
    if (!settings?.sns_engage_enabled && overrideCap === undefined) {
      return await finalize(result);
    }
    result.enabled = true;

    const proxy = (await resolveProxy().catch(() => null)) ?? undefined;

    for (const channel of channels) {
      const setting = await prisma.promotionChannelSetting.findUnique({
        where: { channel },
        select: { auto_enabled: true, strategy_json: true, browser_session_enc: true },
      });
      if (!setting?.browser_session_enc) {
        result.skipped.push(`${channel}:no_session`);
        continue;
      }
      const profile = (setting.strategy_json ?? null) as StrategyProfile | null;

      // ランプアップ上限 & 当日消化(チャンネル別)。
      const firstRows = await prisma.promotionSnsEngagement.findMany({
        where: { channel },
        orderBy: { created_at: 'asc' },
        take: 1,
        select: { created_at: true },
      } as unknown);
      const firstAt = (firstRows[0] as unknown as { created_at?: Date })?.created_at;
      const daysSinceStart = firstAt ? Math.floor((now().getTime() - new Date(firstAt).getTime()) / 86400_000) : 0;
      const cap = overrideCap ?? dailyCap(daysSinceStart);
      const dayStart = new Date(now().getTime() - 24 * H);
      const todayCount = await prisma.promotionSnsEngagement.count({
        where: { channel, action_type: 'follow', status: { in: ['done', 'already'] }, created_at: { gte: dayStart } },
      });
      const remaining = Math.min(PER_RUN_MAX, Math.max(0, cap - todayCount));
      const cell = { cap, already_today: todayCount, followed: 0, already: 0, failed: 0 as number, blocked: undefined as string | undefined };
      result.per_channel[channel] = cell;
      if (remaining <= 0) {
        continue;
      }

      // 対象を growth_scout で特定。
      let out: GrowthScoutOutput;
      try {
        out = await generate({
          channel,
          concept: profile?.concept ?? '',
          target_audience: profile?.target_audience ?? profile?.target_reader ?? '',
          daily_target: 15,
        });
      } catch (err) {
        log.warn({ task: PROMOTION_SNS_ENGAGE_TASK_NAME, channel, err }, 'growth_scout 生成失敗 — スキップ');
        result.skipped.push(`${channel}:scout_failed`);
        continue;
      }

      // 既フォローを除外。
      const engagedRows = await prisma.promotionSnsEngagement.findMany({
        where: { channel, action_type: 'follow' },
        select: { channel: true, action_type: true, target_handle: true },
        take: 5000,
      } as unknown);
      const engaged = new Set(engagedRows.map((r) => `follow:${r.target_handle.toLowerCase()}`));
      const targets = pickFollowTargets(
        out.actions,
        (a) => resolveActionUrl(channel, { action_type: 'follow', platform: channel, target_handle: a.target_handle, target_url: a.target_url } as never),
        engaged,
        remaining,
      );
      if (targets.length === 0) {
        result.skipped.push(`${channel}:no_targets`);
        continue;
      }

      // セッション復号 → ブラウザでフォロー実行。
      let sessionState: string;
      try {
        sessionState = decrypt(setting.browser_session_enc);
      } catch {
        result.skipped.push(`${channel}:session_decrypt_failed`);
        continue;
      }

      const { outcomes, blocked } = await port.followAll({ channel, sessionState, targets, maxActions: remaining, proxy });

      for (const o of outcomes) {
        if (o.status === 'done') cell.followed += 1;
        else if (o.status === 'already') cell.already += 1;
        else cell.failed += 1;
        // 成功/既フォローのみ記録(重複防止)。failed は再挑戦余地を残し記録しない。
        if (o.status === 'done' || o.status === 'already') {
          await prisma.promotionSnsEngagement
            .upsert({
              where: { channel_action_type_target_handle: { channel, action_type: 'follow', target_handle: o.handle } },
              create: { channel, action_type: 'follow', target_handle: o.handle, target_url: o.url, status: o.status },
              update: { status: o.status, target_url: o.url },
            } as unknown)
            .catch(() => {});
        }
      }
      if (blocked) {
        cell.blocked = blocked;
        await alert(`⚠️ ${CHANNEL_LABEL[channel]} 自動フォローが「${blocked}」で中断しました。凍結回避のため本日は停止します。`);
        // ブロックされたら他チャンネルも今回は止める(同一IP/プロファイル影響回避)。
        break;
      }
    }

    // 実行サマリ通知。
    const followedTotal = Object.values(result.per_channel).reduce((s, c) => s + c.followed, 0);
    if (followedTotal > 0 && lineConfigured()) {
      const parts = Object.entries(result.per_channel)
        .filter(([, c]) => c.followed > 0 || c.already > 0)
        .map(([ch, c]) => `${CHANNEL_LABEL[ch] ?? ch}: フォロー${c.followed} / 既${c.already}`)
        .join(' ・ ');
      await alert(`🤝 SNS自動フォロー実行: ${parts}`);
    }

    log.info({ task: PROMOTION_SNS_ENGAGE_TASK_NAME, ...result }, 'promotion.sns.engage done');
    return await finalize(result);
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch { /* noop */ }
    }
    log.warn({ task: PROMOTION_SNS_ENGAGE_TASK_NAME, err }, 'promotion.sns.engage failed');
    throw err;
  }

  async function alert(text: string): Promise<void> {
    if (lineConfigured()) await pushAlert(text).catch(() => false);
  }

  async function finalize(r: PromotionSnsEngageResult): Promise<PromotionSnsEngageResult> {
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: r } });
    }
    return r;
  }
}

export const promotionSnsEngageTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionSnsEngage(payload);
};
