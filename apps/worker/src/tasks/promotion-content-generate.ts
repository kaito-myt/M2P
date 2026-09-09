import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createAccountContent as defaultCreateAccountContent } from '@a2p/agents';
import {
  PromotionChannelSchema,
  appendHashtags,
  resolveHashtags,
  pickTopicHashtags,
  type PromotionChannel,
} from '@a2p/contracts/promotion/channels';
import {
  AccountStrategyProfileSchema,
  type ContentCreatorInput,
  type AccountContentOutput,
} from '@a2p/contracts/agents';
import { PromoPlaybookSchema, playbookToGuidance } from '@a2p/contracts/agents/promo-strategist';
import { ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `promotion.content.generate` タスク (F-059)
 *
 * アカウント戦略(strategy_json)の「発信の柱」から、宣伝ではない育成投稿(価値提供型)を
 * content_creator で生成し、`promotion_posts`(kind='value', book_id=null)に日程付きで登録する。
 * 宣伝(promo)投稿と混ざって dispatcher が投稿する。フォロワー獲得のための投稿。
 *
 * 冪等: 当該チャンネルの未投稿 value(scheduled)を削除してから作り直す。promo は温存。
 */

export const PROMOTION_CONTENT_GENERATE_TASK_NAME = 'promotion.content.generate';

export const PromotionContentGeneratePayloadSchema = z.object({
  channel: PromotionChannelSchema,
  /** 生成数 (既定 12)。 */
  count: z.number().int().min(1).max(30).optional(),
  /** 何日に分散するか (既定 7)。 */
  days: z.number().int().min(1).max(30).optional(),
});

interface ContentGeneratePrisma {
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { strategy_json: true; playbook_json: true };
    }) => Promise<{ strategy_json: unknown; playbook_json: unknown } | null>;
  };
  book: {
    findMany: (args: {
      select: { title: true; theme: { select: { target_reader: true } } };
    }) => Promise<Array<{ title: string; theme: { target_reader: string | null } | null }>>;
  };
  promotionPost: {
    deleteMany: (args: {
      where: { channel: string; kind: string; status: { in: string[] } };
    }) => Promise<{ count: number }>;
    createMany: (args: {
      data: Array<{
        book_id: null;
        channel: string;
        kind: string;
        account_id: null;
        title: null;
        body: string;
        scheduled_for: Date;
        status: string;
      }>;
    }) => Promise<{ count: number }>;
  };
}

export interface PromotionContentGenerateDeps {
  prisma?: ContentGeneratePrisma;
  logger?: Logger;
  now?: () => Date;
  createAccountContent?: (input: ContentCreatorInput) => Promise<AccountContentOutput>;
}

export interface PromotionContentGenerateResult {
  created: number;
  removed: number;
}

// 育成投稿の投稿枠 (JST): 09:00 / 20:00。
// 2026-09-02 SNS成長診断: 7投稿/日の過剰頻度がスパム判定(X平均表示3.5・IG時間上限)を招いたため
// value は最大2/日に削減 (promo と合わせても ~2-3/日)。量より同型反復で伸ばす方針へ。
const VALUE_SLOTS_JST_MIN = [540, 1200];
const H = 3600_000;

export async function runPromotionContentGenerate(
  payload: unknown,
  deps: PromotionContentGenerateDeps = {},
): Promise<PromotionContentGenerateResult> {
  const parsed = PromotionContentGeneratePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('promotion.content.generate payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const channel = parsed.data.channel;
  const count = parsed.data.count ?? 12;
  const days = parsed.data.days ?? 7;

  const log = deps.logger ?? createLogger(`worker.${PROMOTION_CONTENT_GENERATE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as ContentGeneratePrisma);
  const now = deps.now ?? (() => new Date());
  const create = deps.createAccountContent ?? ((input: ContentCreatorInput) => defaultCreateAccountContent(input));

  // 1. 戦略(発信の柱)を取得。無ければ生成できない。
  const setting = await prisma.promotionChannelSetting.findUnique({
    where: { channel },
    select: { strategy_json: true, playbook_json: true },
  });
  const profile = setting?.strategy_json
    ? AccountStrategyProfileSchema.safeParse(setting.strategy_json)
    : null;
  // F-064: web検索リサーチのプレイブックを生成材料として畳み込む(壊れていれば空)。
  const pbParsed = setting?.playbook_json ? PromoPlaybookSchema.safeParse(setting.playbook_json) : null;
  const playbookGuidance = pbParsed?.success ? playbookToGuidance(pbParsed.data) : '';
  if (!profile || !profile.success || profile.data.content_pillars.length === 0) {
    log.info({ task: PROMOTION_CONTENT_GENERATE_TASK_NAME, channel }, 'no account strategy — generate strategy first');
    return { created: 0, removed: 0 };
  }
  const p = profile.data;

  // 2. 世界観の材料(書名/読者)を集約。
  const books = await prisma.book.findMany({
    select: { title: true, theme: { select: { target_reader: true } } },
  });
  const readerSet = new Set<string>();
  const titles: string[] = [];
  for (const b of books) {
    if (b.theme?.target_reader) readerSet.add(b.theme.target_reader.slice(0, 120));
    if (titles.length < 15 && b.title) titles.push(b.title);
  }

  // 3. 育成投稿を生成。
  const out = await create({
    channel,
    concept: p.concept,
    tone_of_voice: p.tone_of_voice,
    pillars: p.content_pillars.map((c) => ({ name: c.name, description: c.description, example_post: c.example_post })),
    target_readers: [...readerSet],
    sample_titles: titles,
    count,
    playbook_guidance: playbookGuidance,
  });

  // 4. 既存の未投稿 value を作り直す (promo は温存)。
  const removed = await prisma.promotionPost.deleteMany({
    where: { channel, kind: 'value', status: { in: ['scheduled', 'draft'] } },
  });

  const posts = out.posts.slice(0, count);
  if (posts.length === 0) {
    return { created: 0, removed: removed.count };
  }

  // 5. 日程付与 (明日から VALUE_SLOTS を days 日に分散) + ハッシュタグ付与。
  // [F-078] core は常時、rotating は各投稿の話題に合致するものだけ足して発見性を上げる
  // (競馬投稿に #競馬、貯金投稿に #貯金 等)。戦略にタグが無くてもデフォルト本紹介タグにフォールバック。
  const coreTags = resolveHashtags(p.hashtag_strategy?.core);
  const rotatingTags = p.hashtag_strategy?.rotating ?? [];
  const slots = VALUE_SLOTS_JST_MIN;
  // JST の暦日(明日)を基準にスロット時刻を割り当てる。
  const jst = new Date(now().getTime() + 9 * H);
  const jy = jst.getUTCFullYear();
  const jm = jst.getUTCMonth();
  const jd = jst.getUTCDate();

  const data = posts.map((post, i) => {
    const dayOffset = 1 + (Math.floor(i / slots.length) % days); // 明日から days 日に分散
    const slotMin = slots[i % slots.length]!;
    // JST 壁時計 (jy/jm/(jd+dayOffset) 00:00 + slotMin 分) → UTC = それ - 9h
    const scheduledFor = new Date(Date.UTC(jy, jm, jd + dayOffset, 0, slotMin) - 9 * H);
    const topicTags = pickTopicHashtags(post.body, coreTags, rotatingTags);
    const body = channel === 'blog' ? post.body.trim() : appendHashtags(channel, post.body.trim(), topicTags);
    return {
      book_id: null,
      channel,
      kind: 'value',
      account_id: null,
      title: null,
      body,
      scheduled_for: scheduledFor,
      status: 'scheduled',
    };
  });

  const created = await prisma.promotionPost.createMany({ data });
  log.info(
    { task: PROMOTION_CONTENT_GENERATE_TASK_NAME, channel, created: created.count, removed: removed.count },
    'value(growth) posts generated',
  );
  return { created: created.count, removed: removed.count };
}

export const promotionContentGenerateTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionContentGenerate(payload);
};

export type { PromotionChannel };
