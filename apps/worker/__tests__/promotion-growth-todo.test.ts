import { describe, expect, it, vi } from 'vitest';

import {
  formatGrowthTodo,
  resolveActionUrl,
  runPromotionGrowthTodo,
  type PromotionGrowthTodoPrisma,
} from '../src/tasks/promotion-growth-todo.js';
import type { GrowthScoutOutput } from '@a2p/contracts/agents/growth-scout';

const OUT: GrowthScoutOutput = {
  channel: 'instagram',
  summary: '読書系の中規模アカウントを狙う',
  actions: [
    { action_type: 'follow', platform: 'instagram', target_handle: '@book_lover', target_url: '', target_desc: '読書記録アカウント', reason: 'フォロワー層が近い', priority: 'high' },
    { action_type: 'like', platform: 'instagram', target_handle: '', target_url: 'https://insta/p/1', target_desc: '今週の一冊投稿', reason: '反応が付きやすい', priority: 'mid' },
  ],
  search_hashtags: ['#読書好きな人と繋がりたい', '#本のある暮らし'],
  notes: ['1日15件まで'],
};

function makeStrategy() {
  return { concept: 'よい本を読む習慣', target_reader: '30代の読書好き', content_pillars: [{ name: 'p1' }] };
}

describe('resolveActionUrl', () => {
  it('target_url があればそれを使う', () => {
    expect(resolveActionUrl('instagram', { action_type: 'like', platform: 'instagram', target_handle: '', target_url: 'https://insta/p/1', target_desc: 'x', reason: '', priority: 'mid' })).toBe('https://insta/p/1');
  });
  it('URLが無く綺麗なハンドルならプロフィールURLを組み立てる', () => {
    expect(resolveActionUrl('instagram', { action_type: 'follow', platform: 'instagram', target_handle: '@book_lover', target_url: '', target_desc: 'x', reason: '', priority: 'mid' })).toBe('https://www.instagram.com/book_lover/');
    expect(resolveActionUrl('tiktok', { action_type: 'follow', platform: 'tiktok', target_handle: 'reader1', target_url: '', target_desc: 'x', reason: '', priority: 'mid' })).toBe('https://www.tiktok.com/@reader1');
  });
  it('日本語表示名など組み立て不能なら空', () => {
    expect(resolveActionUrl('note', { action_type: 'follow', platform: 'note', target_handle: '@みかん 読書記録', target_url: '', target_desc: 'x', reason: '', priority: 'mid' })).toBe('');
  });
});

describe('formatGrowthTodo', () => {
  it('ハンドル/理由/チェックボックス/リンクを含む', () => {
    const msg = formatGrowthTodo('instagram', OUT);
    expect(msg).toContain('☐ @book_lover');
    expect(msg).toContain('理由: フォロワー層が近い');
    expect(msg).toContain('■ フォロー');
    expect(msg).toContain('■ いいね');
    expect(msg).toContain('#読書好きな人と繋がりたい');
    // リンク併記: フォローはハンドルからプロフィールURLを組み立て、いいねは投稿URLを直接。
    expect(msg).toContain('🔗 https://www.instagram.com/book_lover/');
    expect(msg).toContain('🔗 https://insta/p/1');
  });

  it('リンクが取れない項目は検索導線を出す', () => {
    const msg = formatGrowthTodo('note', {
      channel: 'note',
      summary: '',
      actions: [{ action_type: 'follow', platform: 'note', target_handle: '@みかん 読書記録', target_url: '', target_desc: '読書記録', reason: '', priority: 'high' }],
      search_hashtags: [],
      notes: [],
    });
    expect(msg).toContain('で「@みかん 読書記録」を検索');
  });
});

function makePrisma(overrides: {
  strategyByChannel?: Record<string, unknown>;
  autoByChannel?: Record<string, boolean>;
  existingByChannel?: Record<string, { id: string } | null>;
  onCreate?: (d: Record<string, unknown>) => void;
  onUpdate?: (id: string, d: Record<string, unknown>) => void;
}): PromotionGrowthTodoPrisma {
  return {
    promotionChannelSetting: {
      findUnique: vi.fn(async ({ where }: { where: { channel: string } }) => ({
        auto_enabled: overrides.autoByChannel?.[where.channel] ?? true,
        strategy_json: overrides.strategyByChannel?.[where.channel] ?? makeStrategy(),
      })),
    },
    orgTask: {
      findFirst: vi.fn(async ({ where }: { where: { channel?: string } }) => overrides.existingByChannel?.[where.channel ?? ''] ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        overrides.onCreate?.(data);
        return { id: 'new' };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        overrides.onUpdate?.(where.id, data);
        return {};
      }),
    },
  } as unknown as PromotionGrowthTodoPrisma;
}

describe('runPromotionGrowthTodo', () => {
  it('有効な各チャンネルにToDoを起票しLINE通知する', async () => {
    const created: Record<string, unknown>[] = [];
    const pushAlert = vi.fn(async () => true);
    const prisma = makePrisma({ onCreate: (d) => created.push(d) });
    const res = await runPromotionGrowthTodo(
      { channel: 'instagram' },
      { prisma, pushAlert, lineConfigured: () => true, generate: async () => OUT, now: () => new Date('2026-08-15T00:00:00Z') },
    );
    expect(res.tasks_upserted).toBe(1);
    expect(res.per_channel.instagram).toBe(2);
    expect(res.notified).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]!.kind).toBe('growth_manual');
    expect(created[0]!.division).toBe('promotion');
    expect(created[0]!.status).toBe('needs_human');
    expect(created[0]!.channel).toBe('instagram');
    expect(pushAlert).toHaveBeenCalledOnce();
  });

  it('既存の開いているToDoは新規作成せず更新する(重複防止)', async () => {
    const updated: string[] = [];
    const prisma = makePrisma({
      existingByChannel: { instagram: { id: 'existing-ig' } },
      onUpdate: (id) => updated.push(id),
    });
    const create = (prisma.orgTask.create as unknown as ReturnType<typeof vi.fn>);
    await runPromotionGrowthTodo(
      { channel: 'instagram' },
      { prisma, pushAlert: async () => true, lineConfigured: () => true, generate: async () => OUT },
    );
    expect(updated).toEqual(['existing-ig']);
    expect(create).not.toHaveBeenCalled();
  });

  it('戦略が無いチャンネルはスキップ', async () => {
    const prisma = makePrisma({ strategyByChannel: { tiktok: { concept: '', content_pillars: [] } } });
    const res = await runPromotionGrowthTodo(
      { channel: 'tiktok' },
      { prisma, pushAlert: async () => true, lineConfigured: () => true, generate: async () => OUT },
    );
    expect(res.skipped).toContain('tiktok');
    expect(res.tasks_upserted).toBe(0);
  });
});
