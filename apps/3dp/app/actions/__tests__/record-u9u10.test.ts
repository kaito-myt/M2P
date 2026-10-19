import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, findUnique, authMock } = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@a2p/db', () => ({ prisma: { appSettings: { update, findUnique } } }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { recordU9U10 } from '../settings';

beforeEach(() => {
  update.mockReset();
  findUnique.mockReset();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u' } });
  findUnique.mockResolvedValue({ tdp_monthly_publish_limit: 8 });
});

describe('recordU9U10', () => {
  it('範囲外は DB を更新せず、先頭行に「何も保存していません」を出す', async () => {
    const r = await recordU9U10({ u9: { shares_pixiv_account: true }, u10: { booth_share_pct: 101 } });
    expect(update).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refusals).toHaveLength(1);
      expect(r.error.split(String.fromCharCode(10))[0]).toContain('何も保存していません');
    }
  });

  it('メモ 501 字は拒否される', async () => {
    const r = await recordU9U10({ u9: { shares_pixiv_account: false, note: 'あ'.repeat(501) } });
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('answered_at つきで保存し、送らなかった側は更新しない。0 は回答として保存される', async () => {
    update.mockResolvedValue({});
    const r = await recordU9U10({ u10: { booth_share_pct: 0 } });
    expect(r.ok).toBe(true);
    const data = update.mock.calls[0]![0].data as Record<string, { answered_at: string; booth_share_pct: number }>;
    expect(Object.keys(data)).toEqual(['tdp_u10_json']);
    expect(data.tdp_u10_json!.booth_share_pct).toBe(0);
    expect(Number.isNaN(Date.parse(data.tdp_u10_json!.answered_at))).toBe(false);
    if (r.ok) {
      expect(r.data.u10?.booth_share_pct).toBe(0);
      expect(r.data.u9).toBeNull();
    }
  });

  it('行が無いときは保存しない', async () => {
    findUnique.mockResolvedValue(null);
    expect((await recordU9U10({ u10: { booth_share_pct: 5 } })).ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('読み込み失敗・書き込み失敗でも DB の生メッセージを返さない', async () => {
    findUnique.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.1:5432 SELECT secret'));
    const r1 = await recordU9U10({ u10: { booth_share_pct: 5 } });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).not.toContain('ECONNREFUSED');
    expect(update).not.toHaveBeenCalled();

    findUnique.mockResolvedValue({});
    update.mockRejectedValue(new Error('Invalid prisma.appSettings.update() invocation'));
    const r2 = await recordU9U10({ u10: { booth_share_pct: 5 } });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).not.toContain('prisma');
  });

  it('未認証は何も読まず書かない', async () => {
    authMock.mockResolvedValue(null);
    const r = await recordU9U10({ u10: { booth_share_pct: 5 } });
    expect(r.ok).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
