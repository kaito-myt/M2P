/**
 * IG カルーセル投稿の組み立て (運営者要望 2026-09: IG は複数枚のカルーセルにする)。
 *
 * 構成 (docs/08-promo-playbook.md §1・§9 準拠):
 *   1枚目 = 見出しフック（既存の販促画像/バリューカード、`ensureBookPromoImage`/`generateValuePostImage`）
 *   2〜N枚目 = 本文から抽出した要点1つずつのカード（`generateCarouselPointCardImage`）
 *   最終枚 = 固定テンプレ枚（ペルソナ写真＋固定CTA。チャンネルごとに1回だけ生成しキャッシュ）
 * 合計 3〜6 枚。
 */
import {
  generateImage as defaultGenerateImage,
  withImageLogging,
  withPersonaVisualRules,
  type GenerateImageFn,
  type WithImageLoggingDeps,
} from '@a2p/agents';
import { channelCarouselTemplate } from '@a2p/storage/keys';
import { createLogger, type Logger } from '@a2p/contracts/logger';

import {
  ensureBookPromoImage,
  generateValuePostImage,
  generateCarouselPointCardImage,
} from './promo-image.js';

/** IG カルーセルの要点カード枚数上限（1枚目=見出し, 最終枚=固定テンプレを除く）。 */
export const MAX_CAROUSEL_POINTS = 4;

/**
 * 投稿本文から「1要点=1カード」向けの短文を抽出する。
 * 先頭文は1枚目の見出しカードで既に使われている想定のため除外する。
 * 抽出できる文が無ければ、本文全体を短く切った1件にフォールバックする(最低1枚は確保)。
 */
export function extractKeyPoints(body: string, max: number = MAX_CAROUSEL_POINTS): string[] {
  const clean = (body || '')
    .replace(/#\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (clean.length === 0) return [];

  const sentences = clean
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.replace(/[『』「」（）()]/g, '').trim())
    .filter((s) => s.length >= 6 && s.length <= 60);

  // 先頭文は1枚目(見出しフック)で使用済みなので除く。
  const rest = sentences.slice(1);
  if (rest.length > 0) return rest.slice(0, max);

  // 抽出できる短文が無い場合は、本文全体を1枚分に丸めてフォールバック。
  const fallback = clean.slice(0, 56).trim();
  return fallback.length > 0 ? [fallback] : [];
}

/**
 * IG カルーセル固定テンプレ枚(最終枚)のプロンプト。ペルソナ写真(顔出しなし・首から下・
 * フェミニンでセクシー路線)＋固定 CTA コピーを焼き込んだ「毎回同じ画像」を意図する。
 */
export function buildCarouselTemplatePrompt(): string {
  return withPersonaVisualRules(
    'Instagram カルーセル投稿の最終ページとして毎回同じものを使う「固定テンプレート」画像。' +
      '正方形(1:1)、上質で洗練された実写風の縦構図写真。読書アカウントの人物カットを主役にする。' +
      '手元に文庫本やハードカバーの本を持つ、または開いて読んでいる様子。' +
      '背景は明るく落ち着いたカフェの窓辺や自然光の差し込む部屋、暖色系で上質な雰囲気。' +
      '下部に半透明の帯を敷き、その中に正確な日本語テキストを描く: 「フォローで毎日、本の学びをひとつ」。' +
      'その下に少し小さく: 「保存して後で読み返す」。' +
      'デザイン指針: 高コントラストで可読性を最優先、上品な暖色アクセント(ゴールド/生成り)。' +
      '厳守: 指定した日本語テキスト以外の文字・ロゴ・透かし・URL は一切描かない。日本語の漢字・かなを崩さず誤字なく描く。',
  );
}

interface CarouselTemplatePrisma {
  promotionChannelSetting: {
    findUnique: (args: {
      where: { channel: string };
      select: { config_json: true };
    }) => Promise<{ config_json: unknown } | null>;
    update: (args: {
      where: { channel: string };
      data: { config_json: Record<string, unknown> };
    }) => Promise<unknown>;
  };
}

interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<{ key: string }>;
}

export interface EnsureCarouselTemplateDeps {
  prisma?: CarouselTemplatePrisma;
  logger?: Logger;
  generateImage?: GenerateImageFn;
  withImageLoggingDeps?: WithImageLoggingDeps;
  uploadBuffer?: UploadBufferFn;
}

/** `promotion_channel_settings.config_json` 内で固定テンプレ枚のキーを保持するフィールド名。 */
export const CAROUSEL_TEMPLATE_KEY_FIELD = 'carousel_template_key';

async function defaultUploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer(key, buffer, contentType);
}

async function defaultPrisma(): Promise<CarouselTemplatePrisma> {
  const mod = await import('@a2p/db');
  return mod.prisma as unknown as CarouselTemplatePrisma;
}

/**
 * チャンネルの IG カルーセル固定テンプレ枚を返す。未生成なら1回だけ生成して R2 に保存し、
 * `promotion_channel_settings.config_json.carousel_template_key` にキャッシュする
 * (「型を決めて同じ投稿」＝毎回生成しない)。生成不可なら null。
 */
export async function ensureCarouselTemplateImage(
  channel: string,
  deps: EnsureCarouselTemplateDeps = {},
): Promise<string | null> {
  const log = deps.logger ?? createLogger('worker.promotion.carousel-template');
  const prisma = deps.prisma ?? (await defaultPrisma());
  const uploadBuffer = deps.uploadBuffer ?? defaultUploadBuffer;

  const setting = await prisma.promotionChannelSetting.findUnique({
    where: { channel },
    select: { config_json: true },
  });
  const config = (setting?.config_json as Record<string, unknown> | null) ?? {};
  const existing = config[CAROUSEL_TEMPLATE_KEY_FIELD];
  if (typeof existing === 'string' && existing.length > 0) return existing;

  const baseFn: GenerateImageFn = deps.generateImage ?? defaultGenerateImage;
  const genFn = withImageLogging(
    baseFn,
    { role: 'promo_image', themeSessionId: `carousel-template:${channel}` },
    deps.withImageLoggingDeps,
  );
  const result = await genFn({
    prompt: buildCarouselTemplatePrompt(),
    width: 1024,
    height: 1024,
    quality: 'high',
    outputFormat: 'jpeg',
    outputCompression: 90,
  });
  const image = result.images[0];
  if (!image) {
    log.warn({ channel }, 'carousel template generation returned no image');
    return null;
  }

  const key = channelCarouselTemplate(channel);
  await uploadBuffer(key, image, 'image/jpeg');
  await prisma.promotionChannelSetting.update({
    where: { channel },
    data: { config_json: { ...config, [CAROUSEL_TEMPLATE_KEY_FIELD]: key } },
  });
  log.info({ channel, key }, 'carousel template image generated (persona photo, cached)');
  return key;
}

export interface BuildInstagramCarouselDeps {
  /** 1枚目(見出しフック)の R2 キーを用意する。既定は本あり=販促画像/本なし=バリューカード。 */
  ensureHeadline?: (bookId: string | null, postId: string, body: string) => Promise<string | null>;
  /** 2〜N枚目(要点カード)を1枚生成する。 */
  generatePointCard?: (postId: string, index: number, pointText: string) => Promise<string | null>;
  /** 最終枚(固定テンプレ)を用意する。 */
  ensureTemplate?: (channel: string) => Promise<string | null>;
  /** 要点カード枚数上限（既定 {@link MAX_CAROUSEL_POINTS}）。 */
  maxPoints?: number;
}

/**
 * IG カルーセルに使う R2 キーの配列(見出し→要点×N→固定テンプレ、3〜6枚)を組み立てる。
 * 各ステップは失敗しても null を返すだけで例外にせず、生成できた分だけで配列を返す
 * (最低1枚も無ければ空配列 — 呼び出し側は画像無しで投稿するかスキップする)。
 */
export async function buildInstagramCarouselKeys(
  bookId: string | null,
  postId: string,
  body: string,
  deps: BuildInstagramCarouselDeps = {},
): Promise<string[]> {
  const ensureHeadline =
    deps.ensureHeadline ??
    ((bId: string | null, pId: string, b: string) => (bId ? ensureBookPromoImage(bId) : generateValuePostImage(pId, b)));
  const generatePointCard = deps.generatePointCard ?? generateCarouselPointCardImage;
  const ensureTemplate = deps.ensureTemplate ?? ((channel: string) => ensureCarouselTemplateImage(channel));
  const maxPoints = deps.maxPoints ?? MAX_CAROUSEL_POINTS;

  const keys: string[] = [];

  const headlineKey = await ensureHeadline(bookId, postId, body);
  if (headlineKey) keys.push(headlineKey);

  const points = extractKeyPoints(body, maxPoints);
  for (let i = 0; i < points.length; i++) {
    const pointKey = await generatePointCard(postId, i, points[i]!);
    if (pointKey) keys.push(pointKey);
  }

  const templateKey = await ensureTemplate('instagram');
  if (templateKey) keys.push(templateKey);

  return keys;
}
