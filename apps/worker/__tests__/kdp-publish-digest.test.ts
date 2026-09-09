import { describe, expect, it, vi } from 'vitest';

import {
  formatDigestMessage,
  runKdpPublishDigest,
  summarizePublishDigest,
  type KdpPublishDigestPrisma,
  type PublishDigestBook,
} from '../src/tasks/kdp-publish-digest.js';

const NOW = new Date('2026-08-14T00:00:00.000Z');
const future = new Date(NOW.getTime() + 3600_000);
const past = new Date(NOW.getTime() - 3600_000);

describe('summarizePublishDigest', () => {
  it('submitted/blocked(cooldown中)/ready を集計する', () => {
    const books: PublishDigestBook[] = [
      { title: 'A', publish_status: 'submitted', kdp_submit_cooldown_until: null },
      { title: 'B', publish_status: 'unlisted', kdp_submit_cooldown_until: future }, // blocked
      { title: 'C', publish_status: 'unlisted', kdp_submit_cooldown_until: past }, // ready
      { title: 'D', publish_status: 'unlisted', kdp_submit_cooldown_until: null }, // ready
    ];
    const s = summarizePublishDigest(books, ['P1', 'P2'], NOW);
    expect(s.published_24h).toBe(2);
    expect(s.submitted_waiting).toBe(1);
    expect(s.blocked_creation_limit).toBe(1);
    expect(s.queued_ready).toBe(2);
    expect(s.blockedTitles).toEqual(['B']);
  });
});

describe('formatDigestMessage', () => {
  it('作成上限で待機がある場合は原因を明記する', () => {
    const s = summarizePublishDigest(
      [{ title: 'B', publish_status: 'unlisted', kdp_submit_cooldown_until: future }],
      [],
      NOW,
    );
    const msg = formatDigestMessage(s, []);
    expect(msg).toContain('作成上限で待機');
    expect(msg).toContain('1日5冊');
    expect(msg).toContain('本日LIVEになった本: なし');
  });

  it('LIVE本がある場合は書名を列挙する', () => {
    const s = summarizePublishDigest([], ['素敵な本'], NOW);
    const msg = formatDigestMessage(s, ['素敵な本']);
    expect(msg).toContain('販売開始(LIVE): 1冊');
    expect(msg).toContain('・素敵な本');
  });
});

describe('runKdpPublishDigest', () => {
  it('LINE設定済みなら必ず1通通知する(完了ゼロでも)', async () => {
    const pushAlert = vi.fn(async () => true);
    const prisma = {
      book: {
        findMany: vi.fn(async (args: { where: { publish_status: string } }) => {
          if (args.where.publish_status === 'submitted')
            return [{ title: 'S', publish_status: 'submitted', kdp_submit_cooldown_until: null }];
          if (args.where.publish_status === 'unlisted')
            return [{ title: 'Q', publish_status: 'unlisted', kdp_submit_cooldown_until: future }];
          return []; // published
        }),
      },
    } as unknown as KdpPublishDigestPrisma;
    const res = await runKdpPublishDigest({}, { prisma, now: () => NOW, pushAlert, lineConfigured: () => true });
    expect(res.notified).toBe(true);
    expect(res.submitted_waiting).toBe(1);
    expect(res.blocked_creation_limit).toBe(1);
    expect(pushAlert).toHaveBeenCalledOnce();
  });

  it('LINE未設定なら通知しない', async () => {
    const pushAlert = vi.fn(async () => true);
    const prisma = {
      book: { findMany: vi.fn(async () => []) },
    } as unknown as KdpPublishDigestPrisma;
    const res = await runKdpPublishDigest({}, { prisma, now: () => NOW, pushAlert, lineConfigured: () => false });
    expect(res.notified).toBe(false);
    expect(pushAlert).not.toHaveBeenCalled();
  });
});
