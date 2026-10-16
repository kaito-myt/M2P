import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, findUnique, authMock } = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@a2p/db', () => ({ prisma: { appSettings: { update, findUnique } } }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { updateMonthlyPublishLimit } from '../settings';

beforeEach(() => {
  update.mockReset();
  findUnique.mockReset();
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'u' } });
  findUnique.mockResolvedValue({ tdp_monthly_publish_limit: 8 });
});

describe('updateMonthlyPublishLimit', () => {
  it('天井超過は DB を更新せず、拒否値・最大・現在値を文面に出す', async () => {
    const r = await updateMonthlyPublishLimit(13);
    expect(update).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('13');
      expect(r.error).toContain('最大 12');
      expect(r.error).toContain('現在の値: 8');
    }
  });

  it('12 は保存される', async () => {
    update.mockResolvedValue({});
    expect(await updateMonthlyPublishLimit(12)).toEqual({ ok: true, data: 12 });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('未認証は何も読まず書かない', async () => {
    authMock.mockResolvedValue(null);
    const r = await updateMonthlyPublishLimit(5);
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('空文字は 0 (出品停止) として保存されず拒否される', async () => {
    const r = await updateMonthlyPublishLimit('');
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
