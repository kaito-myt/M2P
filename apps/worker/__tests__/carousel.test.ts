/**
 * IG カルーセル組み立て (運営者要望 2026-09) の単体テスト。
 *  - extractKeyPoints: 本文から要点カード用の短文を抽出
 *  - buildCarouselTemplatePrompt: 固定テンプレ枚のプロンプトに人物描写ルールを含む
 *  - ensureCarouselTemplateImage: 生成はチャンネルごとに1回だけ (config_json キャッシュ)
 *  - buildInstagramCarouselKeys: 見出し→要点×N→固定テンプレ を組み立てる
 */
import { describe, expect, it, vi } from 'vitest';

import {
  extractKeyPoints,
  buildCarouselTemplatePrompt,
  ensureCarouselTemplateImage,
  buildInstagramCarouselKeys,
  CAROUSEL_TEMPLATE_KEY_FIELD,
} from '../src/tasks/promotion-post/carousel.js';
import { generateCarouselPointCardImage } from '../src/tasks/promotion-post/promo-image.js';

describe('extractKeyPoints', () => {
  it('先頭文(見出し済み)を除いた要点文を最大件数まで返す', () => {
    const body = '毎朝5分の読書で人生が変わる。まず1冊決める。次に時間を固定する。最後に記録をつける。#読書 https://x.co/a';
    const points = extractKeyPoints(body, 4);
    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThanOrEqual(4);
    // 先頭文(見出し)は含まれない
    expect(points.join(' ')).not.toContain('毎朝5分の読書で人生が変わる');
    expect(points.some((p) => p.includes('時間を固定する'))).toBe(true);
  });

  it('抽出できる短文が無ければ本文全体を1件にフォールバックする', () => {
    const points = extractKeyPoints('今日の一言');
    expect(points).toHaveLength(1);
    expect(points[0]).toContain('今日の一言');
  });

  it('本文が空なら空配列', () => {
    expect(extractKeyPoints('')).toEqual([]);
    expect(extractKeyPoints('   ')).toEqual([]);
  });

  it('max を超えないよう切り詰める', () => {
    const body = 'A。1つ目のポイントです。2つ目のポイントです。3つ目のポイントです。4つ目のポイントです。5つ目のポイントです。';
    const points = extractKeyPoints(body, 2);
    expect(points).toHaveLength(2);
  });
});

describe('buildCarouselTemplatePrompt', () => {
  it('人物描写ルール(顔出し禁止/首から下/実写)と固定CTA文言を含む', () => {
    const p = buildCarouselTemplatePrompt();
    expect(p).toContain('顔は絶対に描かない');
    expect(p).toContain('首から下');
    expect(p).toContain('実写');
    expect(p).toContain('フォローで毎日、本の学びをひとつ');
  });
});

describe('generateCarouselPointCardImage', () => {
  it('要点カード画像を生成し、post毎/index毎のユニークキーへ保存する', async () => {
    const generateImage = vi.fn(async (_args: { prompt: string }) => ({
      images: [Buffer.from('card')],
      costJpy: 0,
      usage: { imageCount: 1 },
    }));
    const uploadBuffer = vi.fn(async (key: string) => ({ key }));
    const key = await generateCarouselPointCardImage('post_1', 1, '時間を固定すると続く', {
      generateImage: generateImage as never,
      uploadBuffer,
      withImageLoggingDeps: { prisma: { tokenUsage: { create: vi.fn() }, book: { update: vi.fn() } } as never },
    });
    expect(key).toBe('promotion/posts/post_1-p1.jpg');
    expect(uploadBuffer).toHaveBeenCalledWith('promotion/posts/post_1-p1.jpg', expect.any(Buffer), 'image/jpeg');
    const prompt = generateImage.mock.calls[0]![0].prompt;
    expect(prompt).toContain('時間を固定すると続く');
  });

  it('画像が空なら null', async () => {
    const generateImage = vi.fn(async () => ({ images: [], costJpy: 0, usage: { imageCount: 0 } }));
    const key = await generateCarouselPointCardImage('post_1', 0, 'x', {
      generateImage: generateImage as never,
      uploadBuffer: vi.fn(),
      withImageLoggingDeps: { prisma: { tokenUsage: { create: vi.fn() }, book: { update: vi.fn() } } as never },
    });
    expect(key).toBeNull();
  });
});

describe('ensureCarouselTemplateImage', () => {
  it('既にキャッシュ済みキーがあれば再生成しない', async () => {
    const generateImage = vi.fn();
    const uploadBuffer = vi.fn();
    const update = vi.fn();
    const prisma = {
      promotionChannelSetting: {
        findUnique: vi.fn(async () => ({ config_json: { [CAROUSEL_TEMPLATE_KEY_FIELD]: 'promotion/instagram/meta/carousel-template.jpg' } })),
        update,
      },
    };
    const key = await ensureCarouselTemplateImage('instagram', {
      prisma: prisma as never,
      generateImage: generateImage as never,
      uploadBuffer,
    });
    expect(key).toBe('promotion/instagram/meta/carousel-template.jpg');
    expect(generateImage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('未生成なら1枚生成しアップロード後、config_jsonへ他の既存値を保ったままキーを保存する', async () => {
    const generateImage = vi.fn(async () => ({ images: [Buffer.from('template')], costJpy: 0, usage: { imageCount: 1 } }));
    const uploadBuffer = vi.fn(async (key: string) => ({ key }));
    const update = vi.fn(async (_args: { data: { config_json: Record<string, unknown> } }) => ({}));
    const prisma = {
      promotionChannelSetting: {
        findUnique: vi.fn(async () => ({ config_json: { webhook_url: 'https://hook.test' } })),
        update,
      },
    };
    const key = await ensureCarouselTemplateImage('instagram', {
      prisma: prisma as never,
      generateImage: generateImage as never,
      uploadBuffer,
      withImageLoggingDeps: { prisma: { tokenUsage: { create: vi.fn() }, book: { update: vi.fn() } } as never },
    });
    expect(key).toBe('promotion/instagram/meta/carousel-template.jpg');
    expect(uploadBuffer).toHaveBeenCalledWith('promotion/instagram/meta/carousel-template.jpg', expect.any(Buffer), 'image/jpeg');
    const updateArg = update.mock.calls[0]![0] as { data: { config_json: Record<string, unknown> } };
    expect(updateArg.data.config_json.webhook_url).toBe('https://hook.test');
    expect(updateArg.data.config_json[CAROUSEL_TEMPLATE_KEY_FIELD]).toBe('promotion/instagram/meta/carousel-template.jpg');
  });

  it('生成失敗(画像空)なら null で更新もしない', async () => {
    const generateImage = vi.fn(async () => ({ images: [], costJpy: 0, usage: { imageCount: 0 } }));
    const update = vi.fn();
    const prisma = {
      promotionChannelSetting: { findUnique: vi.fn(async () => null), update },
    };
    const key = await ensureCarouselTemplateImage('instagram', {
      prisma: prisma as never,
      generateImage: generateImage as never,
      uploadBuffer: vi.fn(),
    });
    expect(key).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('buildInstagramCarouselKeys', () => {
  it('見出し→要点カード×N→固定テンプレの順で配列を組み立てる (3〜6枚)', async () => {
    const ensureHeadline = vi.fn(async () => 'books/b1/promo/social.jpg');
    const generatePointCard = vi.fn(async (_postId: string, index: number) => `promotion/posts/p1-p${index}.jpg`);
    const ensureTemplate = vi.fn(async () => 'promotion/instagram/meta/carousel-template.jpg');

    const body = '毎朝5分の読書で人生が変わる。まず1冊決める。次に時間を固定する。最後に記録をつける。';
    const keys = await buildInstagramCarouselKeys('b1', 'p1', body, {
      ensureHeadline,
      generatePointCard,
      ensureTemplate,
    });

    expect(keys[0]).toBe('books/b1/promo/social.jpg');
    expect(keys.at(-1)).toBe('promotion/instagram/meta/carousel-template.jpg');
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(keys.length).toBeLessThanOrEqual(6);
    expect(ensureHeadline).toHaveBeenCalledWith('b1', 'p1', body);
  });

  it('一部の生成が失敗(null)しても、成功分だけで配列を返す', async () => {
    const ensureHeadline = vi.fn(async () => null);
    const generatePointCard = vi.fn(async () => 'promotion/posts/p1-p0.jpg');
    const ensureTemplate = vi.fn(async () => null);

    const keys = await buildInstagramCarouselKeys(null, 'p1', '学びを1つ。今日はこれを実践する。', {
      ensureHeadline,
      generatePointCard,
      ensureTemplate,
    });
    expect(keys).toEqual(['promotion/posts/p1-p0.jpg']);
  });

  it('全て失敗すれば空配列', async () => {
    const keys = await buildInstagramCarouselKeys(null, 'p1', '本文', {
      ensureHeadline: vi.fn(async () => null),
      generatePointCard: vi.fn(async () => null),
      ensureTemplate: vi.fn(async () => null),
    });
    expect(keys).toEqual([]);
  });
});
