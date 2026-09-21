/**
 * `promotion.note.article` タスク (docs/11-anp-design.md §3.4 F-ANP-30 / §7 Phase3)。
 *
 * `NoteArticle(publish_status='published')` の告知投稿を X / Instagram 向けに
 * content_creator 相当の `anp.promo` 役割で生成し、既存 `promotion_posts` に
 * `kind='anp_article'`(book_id=null) で INSERT する。配信は既存の `promotion.dispatch` /
 * `promotion.post.publish` にそのまま乗る (新規配信経路は作らない)。
 * **TikTok は既定で対象外**（記事に無関係な動画をオンデマンド生成する経路 `tiktok-video.ts`
 * `ensureTikTokVideoForPost` に乗ってしまうため独立させた）。ただし Phase 4 (F-ANP-30続き) で
 * `note_accounts.settings_json.tiktok_enabled=true`(既定OFF、コスト保護) のアカウントに限り
 * `promotion.note.article.video` を追加 enqueue し、記事連動 TikTok スライド動画も生成する
 * (下記 `PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME` 参照)。
 *
 * ペルソナは 5 チャンネル共通の `promotion_channel_settings.strategy_json`
 * (`AccountStrategyProfile`) を使う。content_creator (role='content_creator') は
 * 「自社本の宣伝・購入導線・URL は入れない」ことを明示ルール化しているため、note 記事の
 * URL を必ず含める本タスクとはプロンプト方針が根本的に矛盾する。そのため role/プロンプトを
 * `anp.promo` として独立させた (`packages/agents/src/anp/promo.ts` 冒頭コメント参照)。
 *
 * トリガ: `pipeline.note.publish` の公開成功時に 1 記事 1 回 enqueue (job_key で重複防止)。
 * 本タスク自身も `promotion_posts` に同一記事の `kind='anp_article'` 行が既にあれば
 * 二重生成しない (再試行時の冪等性)。
 *
 * **頻度制御 (2026-09-16 code review 対応)**: SNS投稿は 2/日ルール(`promotion-content-generate.ts`
 * の value 投稿・`promotion-posts-generate.ts` の promo 投稿)で運用している。本タスクの投稿を
 * 無条件に「今日+数時間後」へ積むと合計 3〜4投稿/日になりスパム対策を破るため、チャンネル別に
 * `promotion_posts(status in scheduled/draft)` を JST 暦日単位で数え、**日次上限(既存2+anp1=3)未満の
 * 最初の未来日**の「枠外」時刻(既存 value の 09:00/20:00 と衝突しない JST 12:00 / 15:00)に配置する
 * (`findScheduledFor`)。
 */
import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createAnpArticlePromoContent as defaultCreateAnpArticlePromoContent } from '@a2p/agents/anp/promo';
import { AccountStrategyProfileSchema, resolveCharacterSheet } from '@a2p/contracts/agents';
import { isNotePromotionChannelEnabled, parseNoteAccountSettings, parseNotePromotionPolicy, type AnpPromoContentInput } from '@a2p/contracts/agents/anp';
import { PromoPlaybookSchema, playbookToGuidance } from '@a2p/contracts/agents/promo-strategist';
import {
  appendArticleLink,
  appendHashtags,
  pickTopicHashtags,
  resolveHashtags,
} from '@a2p/contracts/promotion/channels';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { resolveTiktokEnabled } from './lib/note-account-settings.js';
import { jstDayBoundsUtc, offpeakScheduledForUtc } from './lib/promo-schedule.js';
import { PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME } from './promotion-note-article-video.js';

export { jstDayBoundsUtc, offpeakScheduledForUtc };

export const PROMOTION_NOTE_ARTICLE_TASK_NAME = 'promotion.note.article';

export const PromotionNoteArticlePayloadSchema = z.object({
  note_article_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type PromotionNoteArticlePayload = z.infer<typeof PromotionNoteArticlePayloadSchema>;

/** F-ANP-30: 告知対象の 2 チャンネル (note 自体・blog・TikTok は対象外。理由は冒頭コメント)。 */
const PROMO_CHANNELS = ['x', 'instagram'] as const;
type PromoChannel = (typeof PROMO_CHANNELS)[number];

/** 既存 value(09:00/20:00 JST)と衝突しない「枠外」時刻(分, JST)。チャンネル毎に固定で振る。 */
const OFFPEAK_MIN_JST: Record<PromoChannel, number> = { x: 12 * 60, instagram: 15 * 60 };

/** 1 チャンネル・1 JST 暦日あたりの投稿上限 (既存 value/promo 分2 + anp_article 分1)。 */
const DAILY_CHANNEL_CAP = 3;

/** 空き日を探す上限(日)。万一ずっと埋まっていても無限ループにしない。 */
const MAX_LOOKAHEAD_DAYS = 30;

interface NoteArticleRow {
  id: string;
  note_account_id: string;
  title: string;
  lead: string | null;
  note_url: string | null;
  publish_status: string;
}
interface NoteAccountRow {
  id: string;
  handle: string | null;
  niche: string;
  settings_json?: unknown;
  /** [F-ANP-32] アカウント別・媒体別の販促施策 (`NotePromotionPolicySchema`)。旧テストでは undefined。 */
  promotion_policy_json?: unknown;
}

export interface PromotionNoteArticlePrisma {
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
    /** [F-ANP-30続き] tiktok_enabled=true のアカウントで `promotion.note.article.video` の内部 Job を作る。 */
    create: (args: {
      data: { kind: string; status: string; payload_json: unknown };
    }) => Promise<{ id: string }>;
  };
  noteArticle: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; note_account_id: true; title: true; lead: true; note_url: true; publish_status: true };
    }) => Promise<NoteArticleRow | null>;
  };
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; handle: true; niche: true; settings_json?: true; promotion_policy_json?: true };
    }) => Promise<NoteAccountRow | null>;
  };
  promotionChannelSetting: {
    findMany: (args: {
      where: { channel: { in: string[] } };
      select: { channel: true; strategy_json: true; playbook_json: true };
    }) => Promise<Array<{ channel: string; strategy_json: unknown; playbook_json: unknown }>>;
  };
  promotionPost: {
    findFirst: (args: {
      where: { note_article_id: string; kind: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    /** 頻度制御用: 同チャンネル・同JST暦日の scheduled/draft 件数を数える。 */
    count: (args: {
      where: { channel: string; status: { in: string[] }; scheduled_for: { gte: Date; lt: Date } };
    }) => Promise<number>;
    createMany: (args: {
      data: Array<{
        book_id: null;
        channel: string;
        kind: string;
        account_id: null;
        note_article_id: string;
        title: null;
        body: string;
        scheduled_for: Date;
        status: string;
      }>;
    }) => Promise<{ count: number }>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface PromotionNoteArticleDeps {
  prisma?: PromotionNoteArticlePrisma;
  logger?: Logger;
  now?: () => Date;
  createContent?: (input: AnpPromoContentInput, jobId?: string) => Promise<{ body: string }>;
  /** [F-ANP-30続き] tiktok_enabled=true のアカウント向けに `promotion.note.article.video` を enqueue する。 */
  addJob?: AddJobLike;
}

export interface PromotionNoteArticleResult {
  ok: boolean;
  status: 'created' | 'skipped';
  reason?: string;
  created?: number;
}

/** 各チャンネルの投稿を近接時刻に固めない (発生源=既存 2/日 ルールの JST 09:00/20:00 帯を踏襲)。 */
const STAGGER_HOURS = [1, 6, 11] as const;

export async function runPromotionNoteArticle(
  payload: unknown,
  deps: PromotionNoteArticleDeps = {},
): Promise<PromotionNoteArticleResult> {
  const parsed = PromotionNoteArticlePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('promotion.note.article payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_article_id: articleId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${PROMOTION_NOTE_ARTICLE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionNoteArticlePrisma);
  const now = deps.now ?? (() => new Date());
  const createContent =
    deps.createContent ??
    ((input: AnpPromoContentInput, jid?: string) => defaultCreateAnpArticlePromoContent(input, { jobId: jid }));

  const existingJob = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existingJob) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, articleId } });
  }
  if (existingJob.status === 'done') {
    log.info({ task: PROMOTION_NOTE_ARTICLE_TASK_NAME, jobId }, 'job already done — skipping');
    return { ok: true, status: 'skipped', reason: 'already_done' };
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now() },
  });
  if (cas.count === 0) {
    log.info({ task: PROMOTION_NOTE_ARTICLE_TASK_NAME, jobId }, 'job not in queued/failed — skipping');
    return { ok: true, status: 'skipped', reason: 'not_queued' };
  }

  try {
    const article = await prisma.noteArticle.findUnique({
      where: { id: articleId },
      select: { id: true, note_account_id: true, title: true, lead: true, note_url: true, publish_status: true },
    });
    if (!article) {
      throw new NotFoundError(`NoteArticle not found: ${articleId}`, { details: { articleId, jobId } });
    }
    if (article.publish_status !== 'published' || !article.note_url) {
      await finishJob(prisma, jobId, now(), { status: 'skipped', reason: 'not_published' });
      return { ok: false, status: 'skipped', reason: 'not_published' };
    }

    // 冪等性: 既に同一記事の告知投稿が生成済みなら再生成しない (1記事1回)。
    const dup = await prisma.promotionPost.findFirst({
      where: { note_article_id: articleId, kind: 'anp_article' },
      select: { id: true },
    });
    if (dup) {
      await finishJob(prisma, jobId, now(), { status: 'skipped', reason: 'already_generated' });
      return { ok: false, status: 'skipped', reason: 'already_generated' };
    }

    const account = await prisma.noteAccount.findUnique({
      where: { id: article.note_account_id },
      select: { id: true, handle: true, niche: true, settings_json: true, promotion_policy_json: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${article.note_account_id}`, {
        details: { noteAccountId: article.note_account_id, jobId },
      });
    }

    const settings = await prisma.promotionChannelSetting.findMany({
      where: { channel: { in: [...PROMO_CHANNELS] } },
      select: { channel: true, strategy_json: true, playbook_json: true },
    });
    const settingByChannel = new Map(settings.map((s) => [s.channel, s]));

    const rows: Array<{
      book_id: null;
      channel: string;
      kind: string;
      account_id: null;
      note_article_id: string;
      title: null;
      body: string;
      scheduled_for: Date;
      status: string;
    }> = [];

    // [F-ANP-32] アカウント別・媒体別の販促施策。enabled=false の媒体は告知しない。
    const promoPolicy = parseNotePromotionPolicy(account.promotion_policy_json);
    const accountSettingsForPromo = parseNoteAccountSettings(account.settings_json);

    for (let i = 0; i < PROMO_CHANNELS.length; i++) {
      const channel: PromoChannel = PROMO_CHANNELS[i]!;
      if (!isNotePromotionChannelEnabled(promoPolicy, channel, accountSettingsForPromo)) {
        log.info({ articleId, channel }, 'account promotion policy disabled for channel — skip');
        continue;
      }
      const channelPolicy = promoPolicy[channel];
      const setting = settingByChannel.get(channel);
      const profile = setting?.strategy_json ? AccountStrategyProfileSchema.safeParse(setting.strategy_json) : null;
      // 運営者要望「投稿にSNSのキャラクター性が出るように」— 戦略未設定なら既定ペルソナ「ことは」。
      const persona = profile?.success
        ? {
            concept: profile.data.concept,
            tone_of_voice: profile.data.tone_of_voice,
            character_sheet: resolveCharacterSheet(profile.data),
          }
        : { character_sheet: resolveCharacterSheet(null) };
      const pbParsed = setting?.playbook_json ? PromoPlaybookSchema.safeParse(setting.playbook_json) : null;
      const playbookGuidance = pbParsed?.success ? playbookToGuidance(pbParsed.data) : '';

      const input: AnpPromoContentInput = {
        channel,
        persona,
        article: {
          title: article.title,
          note_url: article.note_url,
          niche: account.niche,
          ...(article.lead ? { lead: article.lead } : {}),
        },
        ...(playbookGuidance ? { playbook_guidance: playbookGuidance } : {}),
        ...(channelPolicy?.policy ? { account_policy: channelPolicy.policy } : {}),
        ...(channelPolicy?.cta ? { account_cta: channelPolicy.cta } : {}),
      };

      let generated: { body: string };
      try {
        generated = await createContent(input, jobId);
      } catch (err) {
        log.warn({ err: errMsg(err), articleId, channel }, 'anp.promo 生成失敗 — このチャンネルはスキップ');
        continue;
      }

      // handle は appendArticleLink (X の重み付き切り詰め) より必ず前に本文へ含める。
      // 後から足すと切り詰め後の 280 上限を超過しうる(2026-09-16 code review 指摘)。
      let body = generated.body;
      if (account.handle) body = `${body}\n(@${account.handle})`;
      body = appendArticleLink(channel, body, article.note_url);

      // [F-ANP-32] アカウント設定のハッシュタグを常時タグの先頭に足す (重複は除く)。
      const accountTags = (channelPolicy?.hashtags ?? []).map((t) => t.replace(/^#/, '')).filter((t) => t.length > 0);
      const coreTags = [...new Set([...accountTags, ...resolveHashtags(profile?.success ? profile.data.hashtag_strategy?.core : null)])];
      const rotatingTags = profile?.success ? profile.data.hashtag_strategy?.rotating ?? [] : [];
      const topicTags = pickTopicHashtags(body, coreTags, rotatingTags);
      body = appendHashtags(channel, body, topicTags);

      const scheduledFor = await findScheduledFor(prisma, channel, OFFPEAK_MIN_JST[channel], now);

      rows.push({
        book_id: null,
        channel,
        kind: 'anp_article',
        account_id: null,
        note_article_id: articleId,
        title: null,
        body,
        scheduled_for: scheduledFor,
        status: 'scheduled',
      });
    }

    if (rows.length === 0) {
      await finishJob(prisma, jobId, now(), { status: 'skipped', reason: 'no_content_generated' });
      return { ok: false, status: 'skipped', reason: 'no_content_generated' };
    }

    const created = await prisma.promotionPost.createMany({ data: rows });

    // [F-ANP-30続き] アカウント設定で tiktok_enabled=true の場合のみ、記事連動 TikTok 動画も作る
    // (既定 OFF・コスト保護)。失敗しても X/IG 告知自体の成功結果には影響させない。
    if (resolveTiktokEnabled(account.settings_json) && deps.addJob) {
      try {
        const videoJob = await prisma.job.create({
          data: { kind: PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME, status: 'queued', payload_json: { note_article_id: articleId } },
        });
        await deps.addJob(
          PROMOTION_NOTE_ARTICLE_VIDEO_TASK_NAME,
          { note_article_id: articleId, job_id: videoJob.id },
          { jobKey: `anp-promo-video-${articleId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
        );
      } catch (err) {
        log.warn({ err: errMsg(err), articleId }, 'promotion.note.article.video の enqueue に失敗(無視)');
      }
    }

    await finishJob(prisma, jobId, now(), { status: 'created', created: created.count });
    log.info(
      { task: PROMOTION_NOTE_ARTICLE_TASK_NAME, articleId, created: created.count },
      'promotion.note.article done',
    );
    return { ok: true, status: 'created', created: created.count };
  } catch (err) {
    await failJob(prisma, jobId, now(), err, log);
    throw err;
  }
}


/**
 * チャンネル別の 2/日(既存value/promo)+anp1 の日次上限(`DAILY_CHANNEL_CAP`)を守り、
 * 明日以降で最初に空きのある JST 暦日の「枠外」時刻(`OFFPEAK_MIN_JST`)を返す。
 * `MAX_LOOKAHEAD_DAYS` 日以内に空きが無い場合はその翌日に強制配置する(無限ループ防止)。
 */
async function findScheduledFor(
  prisma: Pick<PromotionNoteArticlePrisma, 'promotionPost'>,
  channel: string,
  minuteOfDayJst: number,
  now: () => Date,
): Promise<Date> {
  for (let dayOffset = 1; dayOffset <= MAX_LOOKAHEAD_DAYS; dayOffset++) {
    const { start, end } = jstDayBoundsUtc(now(), dayOffset);
    const count = await prisma.promotionPost.count({
      where: { channel, status: { in: ['scheduled', 'draft'] }, scheduled_for: { gte: start, lt: end } },
    });
    if (count < DAILY_CHANNEL_CAP) {
      return offpeakScheduledForUtc(now(), dayOffset, minuteOfDayJst);
    }
  }
  return offpeakScheduledForUtc(now(), MAX_LOOKAHEAD_DAYS + 1, minuteOfDayJst);
}

async function finishJob(
  prisma: { job: PromotionNoteArticlePrisma['job'] },
  jobId: string,
  finishedAt: Date,
  resultJson: Record<string, unknown>,
): Promise<void> {
  await prisma.job
    .update({ where: { id: jobId }, data: { status: 'done', finished_at: finishedAt, error: null, result_json: resultJson } })
    .catch(() => {});
}

async function failJob(
  prisma: { job: PromotionNoteArticlePrisma['job'] },
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
    log.warn({ task: PROMOTION_NOTE_ARTICLE_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

export const promotionNoteArticleTask: Task = async (payload: unknown, helpers: JobHelpers) => {
  await runPromotionNoteArticle(payload, { addJob: helpers.addJob as unknown as AddJobLike });
};
