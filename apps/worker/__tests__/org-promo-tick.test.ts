import { describe, expect, it, vi } from 'vitest';

import {
  evaluateGrowth,
  runOrgPromoTick,
  summarizeEngagement,
  summarizeTrend,
  type GrowthSnapshotRow,
  type OrgPromoTickPrisma,
  type PromoPostMetricRow,
} from '../src/tasks/org-promo-tick.js';

const NOW = new Date('2026-08-12T00:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86400_000);

function makePrisma(overrides: {
  posts?: PromoPostMetricRow[];
  snaps?: GrowthSnapshotRow[];
  openAlerts?: Array<{ id: string }>;
  onCreate?: (data: Record<string, unknown>) => void;
}): OrgPromoTickPrisma {
  return {
    promotionPost: {
      findMany: vi.fn(async () => overrides.posts ?? []),
    },
    promotionGrowthSnapshot: {
      findMany: vi.fn(async () => overrides.snaps ?? []),
    },
    orgTask: {
      findMany: vi.fn(async () => overrides.openAlerts ?? []),
      create: vi.fn(async ({ data }) => {
        overrides.onCreate?.(data);
        return { id: 'task-new' };
      }),
    },
  };
}

describe('summarizeEngagement', () => {
  it('平均/合計/最大を集計する', () => {
    const rows: PromoPostMetricRow[] = [
      { impressions: 1, likes: 0 },
      { impressions: 9, likes: 1 },
      { impressions: 2, likes: 0 },
    ];
    const e = summarizeEngagement(rows);
    expect(e.sample).toBe(3);
    expect(e.avg_impressions).toBe(4); // (1+9+2)/3 = 4
    expect(e.max_impressions).toBe(9);
    expect(e.sum_likes).toBe(1);
  });

  it('空配列は 0 を返す', () => {
    const e = summarizeEngagement([]);
    expect(e).toEqual({ sample: 0, avg_impressions: 0, sum_likes: 0, max_impressions: 0 });
  });
});

describe('summarizeTrend', () => {
  it('最新とスパン先頭の差分でフォロワー推移を出す', () => {
    const snaps: GrowthSnapshotRow[] = [
      { followers: 20, captured_at: days(10) },
      { followers: 22, captured_at: days(3) },
    ];
    const t = summarizeTrend(snaps, NOW);
    expect(t.latest_followers).toBe(22);
    expect(t.prior_followers).toBe(20);
    expect(t.delta).toBe(2);
    expect(t.span_days).toBe(7);
  });

  it('スナップショットが1件なら prior/delta は null', () => {
    const t = summarizeTrend([{ followers: 20, captured_at: days(1) }], NOW);
    expect(t.latest_followers).toBe(20);
    expect(t.prior_followers).toBeNull();
    expect(t.delta).toBeNull();
  });
});

describe('evaluateGrowth', () => {
  it('十分なサンプルで平均インプレッションが床値未満なら reach_critical', () => {
    const breaches = evaluateGrowth(
      { sample: 100, avg_impressions: 1, sum_likes: 1, max_impressions: 9 },
      { latest_followers: 30, prior_followers: null, span_days: 0, delta: null },
    );
    expect(breaches.map((b) => b.code)).toContain('reach_critical');
  });

  it('サンプルが少なければ reach 判定を保留する', () => {
    const breaches = evaluateGrowth(
      { sample: 3, avg_impressions: 1, sum_likes: 0, max_impressions: 2 },
      { latest_followers: 500, prior_followers: 500, span_days: 7, delta: 0 },
    );
    // reach は保留。ただしフォロワー500で停滞 → growth_stalled は出る。
    expect(breaches.map((b) => b.code)).not.toContain('reach_critical');
    expect(breaches.map((b) => b.code)).toContain('growth_stalled');
  });

  it('十分なスパンでフォロワーが増えていないなら growth_stalled', () => {
    const breaches = evaluateGrowth(
      { sample: 50, avg_impressions: 200, sum_likes: 30, max_impressions: 900 },
      { latest_followers: 300, prior_followers: 300, span_days: 7, delta: 0 },
    );
    expect(breaches.map((b) => b.code)).toContain('growth_stalled');
    expect(breaches.map((b) => b.code)).not.toContain('reach_critical');
  });

  it('健全(到達あり・フォロワー増)なら違反なし', () => {
    const breaches = evaluateGrowth(
      { sample: 50, avg_impressions: 300, sum_likes: 40, max_impressions: 1200 },
      { latest_followers: 320, prior_followers: 300, span_days: 7, delta: 20 },
    );
    expect(breaches).toHaveLength(0);
  });
});

describe('runOrgPromoTick', () => {
  it('到達危機時に growth_alert を起票し LINE アラートを送る', async () => {
    const created: Record<string, unknown>[] = [];
    const pushAlert = vi.fn(async () => true);
    const prisma = makePrisma({
      posts: Array.from({ length: 100 }, () => ({ impressions: 1, likes: 0 })),
      snaps: [{ followers: 30, captured_at: days(1) }],
      openAlerts: [],
      onCreate: (d) => created.push(d),
    });
    const res = await runOrgPromoTick({}, { prisma, now: () => NOW, pushAlert });
    expect(res.alert_created).toBe(true);
    expect(res.breaches.map((b) => b.code)).toContain('reach_critical');
    expect(created).toHaveLength(1);
    expect(created[0]!.division).toBe('promotion');
    expect(created[0]!.kind).toBe('growth_alert');
    expect(created[0]!.status).toBe('needs_human');
    expect(pushAlert).toHaveBeenCalledOnce();
  });

  it('既に開いている growth_alert があれば重複起票しない', async () => {
    const pushAlert = vi.fn(async () => true);
    const prisma = makePrisma({
      posts: Array.from({ length: 100 }, () => ({ impressions: 1, likes: 0 })),
      snaps: [{ followers: 30, captured_at: days(1) }],
      openAlerts: [{ id: 'existing-alert' }],
    });
    const res = await runOrgPromoTick({}, { prisma, now: () => NOW, pushAlert });
    expect(res.skipped_existing).toBe(true);
    expect(res.alert_created).toBe(false);
    expect(prisma.orgTask.create).not.toHaveBeenCalled();
    expect(pushAlert).not.toHaveBeenCalled();
  });

  it('健全なら起票もアラートもしない', async () => {
    const pushAlert = vi.fn(async () => true);
    const prisma = makePrisma({
      posts: Array.from({ length: 50 }, () => ({ impressions: 300, likes: 1 })),
      snaps: [
        { followers: 300, captured_at: days(8) },
        { followers: 330, captured_at: days(1) },
      ],
      openAlerts: [],
    });
    const res = await runOrgPromoTick({}, { prisma, now: () => NOW, pushAlert });
    expect(res.breaches).toHaveLength(0);
    expect(res.alert_created).toBe(false);
    expect(prisma.orgTask.create).not.toHaveBeenCalled();
    expect(pushAlert).not.toHaveBeenCalled();
  });
});
