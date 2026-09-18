/**
 * F-060 — promotion.video.generate タスクの単体テスト（台本/レンダリング/uploadをDI）。
 */
import { describe, expect, it, vi } from 'vitest';

import type { VideoScript } from '@a2p/contracts/agents/tiktok-video';

import { runPromotionVideoGenerate, buildVeoHookPrompt } from '../src/tasks/promotion-video-generate.js';

const script: VideoScript = {
  title: '仕事術',
  scenes: [
    { narration: 'a', caption: 'b', image_prompt: 'c', seconds: 3 },
    { narration: 'd', caption: 'e', image_prompt: 'f', seconds: 3 },
  ],
  caption: '続きが気になる本文',
  hashtags: ['#仕事術'],
};

function makeDeps() {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  const prisma = {
    promotionChannelSetting: {
      findUnique: vi.fn(async () => ({
        strategy_json: {
          concept: 'c', display_name: 'd', handle_suggestion: 'h', bio: 'b',
          content_pillars: [{ name: 'いい人をやめる', description: '', example_post: '' }],
          tone_of_voice: 't', posting_cadence: { frequency: 'f', best_times: [] },
          hashtag_strategy: { core: ['#ゆるり文庫'], rotating: [] },
          growth_tactics: ['g'], avatar_prompt: 'a', banner_prompt: 'b',
        },
      })),
    },
    book: { findMany: vi.fn(async () => [{ title: '朝1分の習慣術' }]) },
    promotionPost: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        created.push(a.data);
        return { id: 'post_1' };
      }),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => {
        updated.push(a.data);
        return {};
      }),
      delete: vi.fn(async () => ({})),
    },
  };
  return {
    prisma, created, updated, uploads,
    deps: {
      prisma: prisma as never,
      now: () => new Date('2026-07-21T00:00:00Z'),
      createScript: vi.fn(async () => script),
      renderVideo: vi.fn(async () => Buffer.from('MP4')),
      uploadBuffer: vi.fn(async (key: string) => {
        uploads.push(key);
        return { key };
      }),
    },
  };
}

describe('runPromotionVideoGenerate', () => {
  it('台本→レンダリング→R2→post を tiktok/value で予約する', async () => {
    const { deps, created, updated, uploads } = makeDeps();
    const res = await runPromotionVideoGenerate({}, deps as never);

    expect(res.post_id).toBe('post_1');
    expect(res.scenes).toBe(2);
    // draft 作成 → tiktok/value・本文にハッシュタグ
    expect(created[0]!.channel).toBe('tiktok');
    expect(created[0]!.kind).toBe('value');
    expect(String(created[0]!.body)).toContain('#');
    // R2 に mp4、update で media_key + scheduled
    expect(uploads).toEqual(['promotion/videos/post_1.mp4']);
    expect(updated[0]!.media_key).toBe('promotion/videos/post_1.mp4');
    expect(updated[0]!.status).toBe('scheduled');
    // [F-084] 同じ動画で IG リール投稿も作成（同一 media_key・instagram）
    const reel = created.find((c) => c.channel === 'instagram');
    expect(reel).toBeDefined();
    expect(reel!.media_key).toBe('promotion/videos/post_1.mp4');
    expect(reel!.status).toBe('scheduled');
    expect(res.reel_post_id).toBe('post_1');
  });

  it('also_reels=false なら IG リールを作らない', async () => {
    const { deps, created } = makeDeps();
    const res = await runPromotionVideoGenerate({ also_reels: false }, deps as never);
    expect(created.some((c) => c.channel === 'instagram')).toBe(false);
    expect(res.reel_post_id).toBeUndefined();
  });

  it('createScript にコンセプト/柱/ハッシュタグを渡す', async () => {
    const { deps } = makeDeps();
    await runPromotionVideoGenerate({ target_seconds: 20 }, deps as never);
    const arg = (deps.createScript as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.channel).toBe('tiktok');
    expect(arg.concept).toBe('c');
    expect(arg.core_hashtags).toContain('#ゆるり文庫');
    expect(arg.topic).toBe('いい人をやめる'); // 柱から自動選定
    expect(arg.target_seconds).toBe(20);
  });

  it('use_veo=true で Veo フッククリップ生成を呼ぶ（プロンプトは縦型・文字なし）', async () => {
    const { deps } = makeDeps();
    const generateHookClip = vi.fn(async (_p: string) => Buffer.from('VEO'));
    await runPromotionVideoGenerate({ use_veo: true }, { ...deps, generateHookClip } as never);
    expect(generateHookClip).toHaveBeenCalledOnce();
    const p = String(generateHookClip.mock.calls[0]![0]);
    expect(p).toContain('9:16');
    expect(p).toMatch(/no text/i);
  });

  it('use_veo 未指定なら Veo を呼ばない（フラグ無しの既定）', async () => {
    const { deps } = makeDeps();
    const generateHookClip = vi.fn(async (_p: string) => Buffer.from('VEO'));
    await runPromotionVideoGenerate({}, { ...deps, generateHookClip } as never);
    expect(generateHookClip).not.toHaveBeenCalled();
  });

  it('buildVeoHookPrompt は動き/縦型/文字なしを含む', () => {
    const p = buildVeoHookPrompt('a cozy reading nook');
    expect(p).toContain('a cozy reading nook');
    expect(p).toContain('9:16');
    expect(p).toMatch(/no text/i);
  });

  it('buildVeoHookPrompt は人物描写ルール(顔出し禁止/首から下)を含む', () => {
    const p = buildVeoHookPrompt('a cozy reading nook');
    expect(p).toContain('顔は絶対に描かない');
    expect(p).toContain('首から下');
  });

  it('レンダリング失敗時は draft を削除して再throw', async () => {
    const { deps, prisma } = makeDeps();
    (deps.renderVideo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('ffmpeg failed'));
    await expect(runPromotionVideoGenerate({}, deps as never)).rejects.toThrow('ffmpeg failed');
    expect(prisma.promotionPost.delete).toHaveBeenCalledWith({ where: { id: 'post_1' } });
  });
});
