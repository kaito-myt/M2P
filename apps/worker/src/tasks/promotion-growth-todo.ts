import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import type { GrowthScoutOutput, GrowthAction } from '@a2p/contracts/agents/growth-scout';
import { prisma as defaultPrisma } from '@a2p/db';
import { generateGrowthTodo as defaultGenerate } from '@a2p/agents';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';

/**
 * `promotion.growth.todo` タスク (F-075, 2026-08-15) — 手動グロース ToDo 生成。
 *
 * IG/TikTok/note はフォロー/いいねの公式APIが無く自動化できない。本タスクが web_search で
 * 「フォロー/いいねすべき実在アカウント・投稿」を具体特定し、運営者が手で実行できる ToDo を
 * `needs_human` の org_task(kind='growth_manual', チャンネル別に1件を upsert) として提示、
 * さらに LINE で要約通知する。/org のタスクボードに表示される。週次 cron・常時ON。
 */

export const PROMOTION_GROWTH_TODO_TASK_NAME = 'promotion.growth.todo';

/** 手動対応が必要（フォローAPIが無い）チャンネル。 */
export const MANUAL_GROWTH_CHANNELS = ['instagram', 'tiktok', 'note'] as const;

const CHANNEL_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  note: 'note',
};
const ACTION_LABEL: Record<GrowthAction['action_type'], string> = {
  follow: 'フォロー',
  like: 'いいね',
  comment: 'コメント',
};

const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'blocked', 'needs_human'];

export const PromotionGrowthTodoPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  /** 対象チャンネルを限定する場合（省略時は MANUAL_GROWTH_CHANNELS 全て）。 */
  channel: z.string().optional(),
});

interface StrategyProfile {
  concept?: string;
  target_reader?: string;
  target_audience?: string;
  content_pillars?: unknown[];
}

export interface PromotionGrowthTodoPrisma {
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { auto_enabled: true; strategy_json: true };
    }) => Promise<{ auto_enabled: boolean; strategy_json: unknown } | null>;
  };
  orgTask: {
    findFirst: (args: {
      where: { division: string; kind: string; status: { in: string[] }; channel?: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  job?: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
}

export interface PromotionGrowthTodoDeps {
  prisma?: PromotionGrowthTodoPrisma;
  logger?: Logger;
  now?: () => Date;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
  generate?: (input: {
    channel: string;
    concept?: string | null;
    target_audience?: string | null;
    daily_target?: number;
  }) => Promise<GrowthScoutOutput>;
}

export interface PromotionGrowthTodoResult {
  per_channel: Record<string, number>;
  tasks_upserted: number;
  notified: boolean;
  skipped: string[];
}

/**
 * アクションの直接リンクを解決する。target_url があれば優先。無ければ handle が綺麗な
 * ユーザー名スラッグの場合にプラットフォームのプロフィールURLを組み立てる（フォロー先に飛べるように）。
 */
export function resolveActionUrl(channel: string, a: GrowthAction): string {
  if (a.target_url && /^https?:\/\//i.test(a.target_url.trim())) return a.target_url.trim();
  const handle = (a.target_handle ?? '').replace(/^@/, '').trim();
  // note の日本語表示名などスラッグでないものは組み立て不可。半角英数._ のみ許可。
  if (handle && /^[A-Za-z0-9._]+$/.test(handle)) {
    const p = (a.platform || channel).toLowerCase();
    if (p === 'instagram') return `https://www.instagram.com/${handle}/`;
    if (p === 'tiktok') return `https://www.tiktok.com/@${handle}`;
    if (p === 'note') return `https://note.com/${handle}`;
    if (p === 'x' || p === 'twitter') return `https://x.com/${handle}`;
  }
  return '';
}

/** GrowthScoutOutput → 運営者向けチェックリスト本文(日本語)。各項目にリンクを併記。 */
export function formatGrowthTodo(channel: string, out: GrowthScoutOutput): string {
  const label = CHANNEL_LABEL[channel] ?? channel;
  const lines: string[] = [`【${label} 手動グロースToDo】`, out.summary.trim()].filter(Boolean);
  const byType: Record<string, GrowthAction[]> = { follow: [], like: [], comment: [] };
  for (const a of out.actions) (byType[a.action_type] ??= []).push(a);
  for (const type of ['follow', 'like', 'comment'] as const) {
    const items = byType[type] ?? [];
    if (items.length === 0) continue;
    lines.push('', `■ ${ACTION_LABEL[type]}（${items.length}件）`);
    for (const a of items) {
      const who = a.target_handle ? a.target_handle : a.target_desc;
      const desc = a.target_handle && a.target_desc ? ` — ${a.target_desc}` : '';
      lines.push(`☐ ${who}${desc}`);
      const url = resolveActionUrl(channel, a);
      // リンクは必ず1行で併記（タップして飛べるように）。取得できなければ検索導線を出す。
      lines.push(url ? `   🔗 ${url}` : `   🔗 （${label}で「${who}」を検索）`);
      if (a.reason) lines.push(`   理由: ${a.reason}`);
    }
  }
  if (out.search_hashtags.length > 0) {
    lines.push('', `🔎 探索タグ: ${out.search_hashtags.slice(0, 12).join(' ')}`);
  }
  for (const n of out.notes.slice(0, 4)) lines.push(`※ ${n}`);
  return lines.join('\n');
}

export async function runPromotionGrowthTodo(
  payload: unknown,
  deps: PromotionGrowthTodoDeps = {},
): Promise<PromotionGrowthTodoResult> {
  const log = deps.logger ?? createLogger(`worker.${PROMOTION_GROWTH_TODO_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionGrowthTodoPrisma);
  const now = deps.now ?? (() => new Date());
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const generate =
    deps.generate ??
    ((input: Parameters<NonNullable<PromotionGrowthTodoDeps['generate']>>[0]) =>
      defaultGenerate({
        channel: input.channel,
        concept: input.concept ?? '',
        target_audience: input.target_audience ?? '',
        daily_target: input.daily_target ?? 15,
        recent_posts: [],
      }));

  const parsed = PromotionGrowthTodoPayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const only = parsed.success ? parsed.data.channel : undefined;
  const channels = only ? [only] : [...MANUAL_GROWTH_CHANNELS];

  const result: PromotionGrowthTodoResult = { per_channel: {}, tasks_upserted: 0, notified: false, skipped: [] };

  try {
    for (const channel of channels) {
      const setting = await prisma.promotionChannelSetting.findUnique({
        where: { channel },
        select: { auto_enabled: true, strategy_json: true },
      });
      const profile = (setting?.strategy_json ?? null) as StrategyProfile | null;
      if (!setting?.auto_enabled || !profile || !Array.isArray(profile.content_pillars) || profile.content_pillars.length === 0) {
        result.skipped.push(channel);
        continue;
      }

      let out: GrowthScoutOutput;
      try {
        out = await generate({
          channel,
          concept: profile.concept ?? '',
          target_audience: profile.target_audience ?? profile.target_reader ?? '',
          daily_target: 15,
        });
      } catch (err) {
        log.warn({ task: PROMOTION_GROWTH_TODO_TASK_NAME, channel, err }, 'growth_scout 生成失敗 — このチャンネルはスキップ');
        result.skipped.push(channel);
        continue;
      }

      const instruction = formatGrowthTodo(channel, out);
      const label = CHANNEL_LABEL[channel] ?? channel;
      const data = {
        division: 'promotion',
        owner_role: 'promo_mgr',
        assignee_role: 'human',
        kind: 'growth_manual',
        channel,
        title: `手動グロースToDo: ${label} (${out.actions.length}件)`,
        instruction,
        status: 'needs_human',
        priority: 'should',
        result_json: { channel, actions: out.actions, search_hashtags: out.search_hashtags, generated_at: now().toISOString() },
      };

      // チャンネル別に開いている growth_manual があれば更新、無ければ新規（重複させない）。
      const existing = await prisma.orgTask.findFirst({
        where: { division: 'promotion', kind: 'growth_manual', status: { in: OPEN_STATUSES }, channel },
        select: { id: true },
      });
      if (existing) {
        await prisma.orgTask.update({ where: { id: existing.id }, data: { ...data, updated_at: now() } });
      } else {
        await prisma.orgTask.create({ data });
      }
      result.per_channel[channel] = out.actions.length;
      result.tasks_upserted += 1;
    }

    if (result.tasks_upserted > 0 && lineConfigured()) {
      const summary = Object.entries(result.per_channel)
        .map(([ch, n]) => `${CHANNEL_LABEL[ch] ?? ch}: ${n}件`)
        .join(' / ');
      result.notified = await pushAlert(
        `📋 手動グロースToDoを更新しました\n${summary}\n→ /org のタスクで「誰をフォロー / どの投稿にいいね」を確認して実行してください。`,
      ).catch(() => false);
    }

    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: result } });
    }
    log.info({ task: PROMOTION_GROWTH_TODO_TASK_NAME, ...result }, 'promotion.growth.todo done');
    return result;
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch { /* best-effort */ }
    }
    log.warn({ task: PROMOTION_GROWTH_TODO_TASK_NAME, err }, 'promotion.growth.todo failed');
    throw err;
  }
}

export const promotionGrowthTodoTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionGrowthTodo(payload);
};
