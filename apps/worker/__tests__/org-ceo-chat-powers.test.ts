import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@a2p/contracts/logger';
import { CEO_SETTINGS_WHITELIST } from '@a2p/contracts/org';

import {
  applyCeoModelChanges,
  applyCeoSettingChanges,
  saveCeoCodeRequests,
} from '../src/tasks/org-ceo-chat.js';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

type AnyPrisma = Parameters<typeof applyCeoSettingChanges>[0];

describe('applyCeoSettingChanges (F-098)', () => {
  function buildPrisma(current: Record<string, unknown>) {
    const updates: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    const prisma = {
      appSettings: {
        findUnique: async () => current,
        update: async (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return {};
        },
      },
      auditLog: {
        create: async (args: { data: Record<string, unknown> }) => {
          audits.push(args.data);
          return {};
        },
      },
    } as unknown as AnyPrisma;
    return { prisma, updates, audits };
  }

  it('ホワイトリストのトグルを反映し監査ログを残す', async () => {
    const { prisma, updates, audits } = buildPrisma({ promo_auto_post_enabled: true });
    const res = await applyCeoSettingChanges(
      prisma,
      [{ key: 'promo_auto_post_enabled', value: false, reason: '赤字のため販促を止める' }],
      'msg1',
      makeLogger(),
    );
    expect(res[0]).toMatchObject({ ok: true });
    expect(updates[0]).toEqual({ promo_auto_post_enabled: false });
    expect(audits[0]).toMatchObject({ action: 'settings.update', target_id: 'promo_auto_post_enabled' });
  });

  it('ホワイトリスト外のキーは拒否する (会話の勢いで危険な設定を変えさせない)', async () => {
    const { prisma, updates } = buildPrisma({});
    const res = await applyCeoSettingChanges(
      prisma,
      [{ key: 'kdp_submit_dry_run', value: false, reason: '実出版したい' }],
      'msg1',
      makeLogger(),
    );
    expect(res[0]!.ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(CEO_SETTINGS_WHITELIST).not.toHaveProperty('kdp_submit_dry_run');
  });

  it('既に同じ値なら更新しない', async () => {
    const { prisma, updates } = buildPrisma({ x_engage_enabled: false });
    const res = await applyCeoSettingChanges(
      prisma,
      [{ key: 'x_engage_enabled', value: false, reason: '維持' }],
      'msg1',
      makeLogger(),
    );
    expect(res[0]!.ok).toBe(true);
    expect(updates).toHaveLength(0);
  });
});

describe('applyCeoModelChanges (F-098)', () => {
  function buildPrisma(opts: { catalog?: { available: boolean | null } | null; current?: Record<string, unknown> | null }) {
    const created: Array<Record<string, unknown>> = [];
    const archived: Array<Record<string, unknown>> = [];
    const tx = {
      modelAssignment: {
        updateMany: async (args: { where: Record<string, unknown> }) => {
          archived.push(args.where);
          return { count: 1 };
        },
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return {};
        },
      },
      auditLog: { create: async () => ({}) },
    };
    const prisma = {
      modelCatalog: { findFirst: async () => opts.catalog ?? null },
      modelAssignment: { findFirst: async () => opts.current ?? null },
      $transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    } as unknown as Parameters<typeof applyCeoModelChanges>[0];
    return { prisma, created, archived };
  }

  it('カタログにあるモデルへ差し替える', async () => {
    const { prisma, created } = buildPrisma({
      catalog: { available: true },
      current: { id: 'a1', provider: 'anthropic', model: 'claude-opus-4-8', reasoning_effort: null },
    });
    const res = await applyCeoModelChanges(
      prisma,
      [{ role: 'optimizer', provider: 'openai', model: 'gpt-6-sol', reasoning_effort: 'high', reason: 'コスト削減' }],
      'msg1',
      new Date(),
      makeLogger(),
    );
    expect(res[0]!.ok).toBe(true);
    expect(created[0]).toMatchObject({ role: 'optimizer', provider: 'openai', model: 'gpt-6-sol', reasoning_effort: 'high' });
  });

  it('保護 role (ceo 等) は変更できない', async () => {
    const { prisma, created } = buildPrisma({ catalog: { available: true } });
    const res = await applyCeoModelChanges(
      prisma,
      [{ role: 'ceo_chat', provider: 'openai', model: 'gpt-6-luna', reason: '安くしたい' }],
      'msg1',
      new Date(),
      makeLogger(),
    );
    expect(res[0]!.ok).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('カタログに無い/利用不可のモデルは拒否する', async () => {
    const missing = buildPrisma({ catalog: null });
    const r1 = await applyCeoModelChanges(
      missing.prisma,
      [{ role: 'editor', provider: 'openai', model: 'gpt-9-imaginary', reason: '試したい' }],
      'msg1',
      new Date(),
      makeLogger(),
    );
    expect(r1[0]!.ok).toBe(false);

    const unavailable = buildPrisma({ catalog: { available: false } });
    const r2 = await applyCeoModelChanges(
      unavailable.prisma,
      [{ role: 'editor', provider: 'google', model: 'gemini-2.5-pro', reason: '試したい' }],
      'msg1',
      new Date(),
      makeLogger(),
    );
    expect(r2[0]!.ok).toBe(false);
  });
});

describe('saveCeoCodeRequests (F-098)', () => {
  it('コード変更要求を open で起票する (自動適用はしない)', async () => {
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      orgCodeRequest: {
        create: async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: `cr-${created.length}` };
        },
      },
    } as unknown as Parameters<typeof saveCeoCodeRequests>[0];

    const res = await saveCeoCodeRequests(
      prisma,
      [
        {
          title: '売上ダッシュボードに粗利を出す',
          intent: '赤字の把握を早くしたい',
          files: ['apps/web/app/(app)/analytics/sales/page.tsx'],
          change_summary: '印税 - コストの列を追加する',
          urgency: 'high',
        },
      ],
      'msg1',
    );

    expect(res).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'open', urgency: 'high', source_message_id: 'msg1' });
  });
});
