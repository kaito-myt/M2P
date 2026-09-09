import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { decryptApiKey } from '@a2p/crypto';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import type { GrowthScoutOutput } from '@a2p/contracts/agents/growth-scout';
import { prisma as defaultPrisma } from '@a2p/db';
import { generateGrowthTodo as defaultGenerate } from '@a2p/agents';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';
import { resolveKdpProxy } from './sales-fetch/kdp-proxy.js';
import { createPlaywrightNoteEngagePort } from './note-engage/playwright-note-engage-port.js';
import {
  followDailyCap,
  likeDailyCap,
  pickNoteTargets,
  type NoteEngagePort,
} from './note-engage/note-engage-port.js';

/**
 * `note.engage` タスク (F-091) — note ブラウザ自動フォロー & スキ(いいね)。
 *
 * IG/TikTok の `promotion.sns.engage` (F-077) を忠実に踏襲。note もフォロー/スキの公式 API が
 * 無いため、運営者が一度取り込んだログイン済みセッション(NoteAccount.session_state_enc)を
 * Playwright で再利用し、growth_scout が web_search で特定した「note 上のフォロー/スキすべき
 * 実在アカウント/記事」を自動操作する。凍結リスクに配慮し:
 *   - マスタスイッチ `note_engage_enabled`(既定 ON、キルスイッチ)
 *   - ランプアップ + 1回少量(フォロー最大10・スキ最大15) + ジッター(人間的な間)
 *   - 冪等(promotion_sns_engagements で重複防止) + セッション切れ/ブロック検知で即停止&LINE通知
 * データセンターIP対策として住宅プロキシ(app_settings.kdp_proxy_*)が生きていれば経由する。
 *
 * 記録は既存 `promotion_sns_engagements` を流用: channel='note', action_type='follow'|'like'。
 */

export const NOTE_ENGAGE_TASK_NAME = 'note.engage';

/** promotion_sns_engagements 上の note 用チャンネル値。 */
const NOTE_CHANNEL = 'note';
const PER_RUN_FOLLOW = 6; // 1回の実行でのフォロー上限(cron 1日2回に分散し 24h キャップ内に収める)
const PER_RUN_LIKE = 10; // 1回の実行でのスキ上限
const H = 3600_000;

export const NoteEngagePayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  /** 対象アカウント限定(省略時は active 全件)。 */
  note_account_id: z.string().min(1).optional(),
  /** テスト/手動: 当日上限を無視して override 件ずつ(follow/like 各)実行。 */
  override_cap: z.number().int().min(0).max(30).optional(),
});

export interface NoteEngagePrisma {
  appSettings: { findUnique: (args: unknown) => Promise<{ note_engage_enabled: boolean } | null> };
  noteAccount: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        niche: string;
        display_name: string;
        target_reader?: string | null;
        session_state_enc?: string | null;
      }>
    >;
  };
  promotionSnsEngagement: {
    findMany: (args: unknown) => Promise<Array<{ channel: string; action_type: string; target_handle: string }>>;
    count: (args: unknown) => Promise<number>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  job?: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
}

export interface NoteEngageDeps {
  prisma?: NoteEngagePrisma;
  logger?: Logger;
  now?: () => Date;
  port?: NoteEngagePort;
  decryptSession?: (enc: string) => string;
  generate?: (input: {
    concept?: string | null;
    target_audience?: string | null;
    daily_target?: number;
  }) => Promise<GrowthScoutOutput>;
  resolveProxy?: () => Promise<{ server: string; username?: string; password?: string } | null>;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface NoteEngageResult {
  enabled: boolean;
  per_account: Record<
    string,
    {
      follow_cap: number;
      like_cap: number;
      followed: number;
      liked: number;
      already: number;
      failed: number;
      blocked?: string;
    }
  >;
  skipped: string[];
}

export async function runNoteEngage(payload: unknown, deps: NoteEngageDeps = {}): Promise<NoteEngageResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_ENGAGE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteEngagePrisma);
  const now = deps.now ?? (() => new Date());
  const port = deps.port ?? createPlaywrightNoteEngagePort();
  const decrypt = deps.decryptSession ?? ((enc: string) => decryptApiKey(enc));
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const resolveProxy =
    deps.resolveProxy ?? (() => resolveKdpProxy(defaultPrisma as unknown as Parameters<typeof resolveKdpProxy>[0], now));
  const generate =
    deps.generate ??
    ((input: { concept?: string | null; target_audience?: string | null; daily_target?: number }) =>
      defaultGenerate({
        channel: NOTE_CHANNEL,
        concept: input.concept ?? '',
        target_audience: input.target_audience ?? '',
        daily_target: input.daily_target ?? 15,
        recent_posts: [],
      }));

  const parsed = NoteEngagePayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const onlyAccount = parsed.success ? parsed.data.note_account_id : undefined;
  const overrideCap = parsed.success ? parsed.data.override_cap : undefined;

  const result: NoteEngageResult = { enabled: false, per_account: {}, skipped: [] };

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { note_engage_enabled: true },
    });
    // note_engage_enabled が明示的に false のときだけ停止(未設定/取得不可は既定 ON 扱い)。
    if (settings?.note_engage_enabled === false && overrideCap === undefined) {
      return await finalize(result);
    }
    result.enabled = true;

    const proxy = (await resolveProxy().catch(() => null)) ?? undefined;

    const accounts = await prisma.noteAccount.findMany({
      where: {
        status: 'active',
        session_state_enc: { not: null },
        ...(onlyAccount ? { id: onlyAccount } : {}),
      },
      select: { id: true, niche: true, display_name: true, target_reader: true, session_state_enc: true },
      orderBy: { created_at: 'asc' },
      take: 50,
    } as unknown);

    if (accounts.length === 0) {
      result.skipped.push('no_active_account_with_session');
      return await finalize(result);
    }

    // ランプアップ用: note チャンネルの初回エンゲージ日時(全アカウント共通の稼働開始とみなす)。
    const firstRows = await prisma.promotionSnsEngagement.findMany({
      where: { channel: NOTE_CHANNEL },
      orderBy: { created_at: 'asc' },
      take: 1,
      select: { created_at: true },
    } as unknown);
    const firstAt = (firstRows[0] as unknown as { created_at?: Date })?.created_at;
    const daysSinceStart = firstAt ? Math.floor((now().getTime() - new Date(firstAt).getTime()) / 86400_000) : 0;
    const dayStart = new Date(now().getTime() - 24 * H);

    for (const account of accounts) {
      if (!account.session_state_enc) {
        result.skipped.push(`${account.id}:no_session`);
        continue;
      }

      // 24h キャップ(note チャンネル全体で共有 = 全アカウント合算で ToS 配慮)。
      const followToday = await prisma.promotionSnsEngagement.count({
        where: { channel: NOTE_CHANNEL, action_type: 'follow', status: { in: ['done', 'already'] }, created_at: { gte: dayStart } },
      });
      const likeToday = await prisma.promotionSnsEngagement.count({
        where: { channel: NOTE_CHANNEL, action_type: 'like', status: { in: ['done', 'already'] }, created_at: { gte: dayStart } },
      });
      const followCap = overrideCap ?? followDailyCap(daysSinceStart);
      const likeCap = overrideCap ?? likeDailyCap(daysSinceStart);
      const remainingFollow = Math.min(PER_RUN_FOLLOW, Math.max(0, followCap - followToday));
      const remainingLike = Math.min(PER_RUN_LIKE, Math.max(0, likeCap - likeToday));
      const cell = {
        follow_cap: followCap,
        like_cap: likeCap,
        followed: 0,
        liked: 0,
        already: 0,
        failed: 0 as number,
        blocked: undefined as string | undefined,
      };
      result.per_account[account.id] = cell;
      if (remainingFollow <= 0 && remainingLike <= 0) {
        continue;
      }

      // 対象を growth_scout(channel=note)で特定。
      let out: GrowthScoutOutput;
      try {
        out = await generate({
          concept: account.niche || account.display_name,
          target_audience: account.target_reader ?? '',
          daily_target: 15,
        });
      } catch (err) {
        log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId: account.id, err }, 'growth_scout 生成失敗 — スキップ');
        result.skipped.push(`${account.id}:scout_failed`);
        continue;
      }

      // 既エンゲージを除外(note チャンネル全体の follow/like 実績)。
      const engagedRows = await prisma.promotionSnsEngagement.findMany({
        where: { channel: NOTE_CHANNEL },
        select: { channel: true, action_type: true, target_handle: true },
        take: 5000,
      } as unknown);
      const engaged = new Set(engagedRows.map((r) => `${r.action_type}:${r.target_handle.toLowerCase()}`));
      const targets = pickNoteTargets(out.actions, engaged, remainingFollow, remainingLike);
      if (targets.length === 0) {
        result.skipped.push(`${account.id}:no_targets`);
        continue;
      }

      // セッション復号 → ブラウザで操作。
      let sessionState: string;
      try {
        sessionState = decrypt(account.session_state_enc);
      } catch {
        result.skipped.push(`${account.id}:session_decrypt_failed`);
        continue;
      }

      const { outcomes, blocked } = await port.engageAll({
        sessionState,
        targets,
        maxFollow: remainingFollow,
        maxLike: remainingLike,
        proxy,
      });

      for (const o of outcomes) {
        if (o.status === 'done') {
          if (o.action === 'follow') cell.followed += 1;
          else cell.liked += 1;
        } else if (o.status === 'already') {
          cell.already += 1;
        } else {
          cell.failed += 1;
        }
        // 成功/既実行のみ記録(重複防止)。failed は再挑戦余地を残し記録しない。
        if (o.status === 'done' || o.status === 'already') {
          await prisma.promotionSnsEngagement
            .upsert({
              where: {
                channel_action_type_target_handle: {
                  channel: NOTE_CHANNEL,
                  action_type: o.action,
                  target_handle: o.handle,
                },
              },
              create: { channel: NOTE_CHANNEL, action_type: o.action, target_handle: o.handle, target_url: o.url, status: o.status },
              update: { status: o.status, target_url: o.url },
            } as unknown)
            .catch(() => {});
        }
      }

      if (blocked) {
        cell.blocked = blocked;
        await alert(`⚠️ note 自動フォロー/スキが「${blocked}」で中断しました。凍結回避のため本日は停止します。`);
        // ブロックされたら他アカウントも今回は止める(同一IP/プロファイル影響回避)。
        break;
      }
    }

    // 実行サマリ通知。
    const totals = Object.values(result.per_account).reduce(
      (s, c) => ({ followed: s.followed + c.followed, liked: s.liked + c.liked, already: s.already + c.already }),
      { followed: 0, liked: 0, already: 0 },
    );
    if ((totals.followed > 0 || totals.liked > 0) && lineConfigured()) {
      await alert(`🤝 note 自動エンゲージ実行: フォロー${totals.followed} / スキ${totals.liked} / 既${totals.already}`);
    }

    log.info({ task: NOTE_ENGAGE_TASK_NAME, ...result }, 'note.engage done');
    return await finalize(result);
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch {
        /* noop */
      }
    }
    log.warn({ task: NOTE_ENGAGE_TASK_NAME, err }, 'note.engage failed');
    throw err;
  }

  async function alert(text: string): Promise<void> {
    if (lineConfigured()) await pushAlert(text).catch(() => false);
  }

  async function finalize(r: NoteEngageResult): Promise<NoteEngageResult> {
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: r } });
    }
    return r;
  }
}

export const noteEngageTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteEngage(payload);
};
