import { beforeEach, describe, expect, it, vi } from 'vitest';

const { update, findUnique, authMock } = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@a2p/db', () => ({ prisma: { appSettings: { update, findUnique } } }));
vi.mock('@/auth', () => ({ auth: authMock }));

import { confirmSettingsGroup, updateMonthlyPublishLimit, updateTdpSettings } from '../settings';

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

describe('updateMonthlyPublishLimit (媒体別)', () => {
  it('合計 13 は拒否され DB を更新しない', async () => {
    const r = await updateMonthlyPublishLimit({ booth: 8, jinxxy: 5 });
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('booth 12 / jinxxy 0 は成功', async () => {
    update.mockResolvedValue({});
    expect(await updateMonthlyPublishLimit({ booth: 12, jinxxy: 0 })).toEqual({
      ok: true,
      data: { booth: 12, jinxxy: 0 },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'singleton' },
      data: { tdp_monthly_publish_limit: 12, tdp_jinxxy_monthly_limit: 0 },
    });
  });

  it('未認証は code:auth', async () => {
    authMock.mockResolvedValue(null);
    expect(await updateMonthlyPublishLimit({ booth: 1 })).toMatchObject({ ok: false, code: 'auth' });
  });
});

describe('updateTdpSettings / confirmSettingsGroup', () => {
  it('未認証は code:auth で何も読まない', async () => {
    authMock.mockResolvedValue(null);
    expect(await updateTdpSettings({ group: 'gates', patch: { stall_hours: 3 } })).toMatchObject({
      ok: false,
      code: 'auth',
    });
    expect(await confirmSettingsGroup({ group: 'gates' })).toMatchObject({ ok: false, code: 'auth' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('範囲外は拒否値と現在値を返し保存しない', async () => {
    findUnique.mockResolvedValue({ tdp_gate_b_window_days: 90 });
    const r = await updateTdpSettings({ group: 'gates', patch: { tdp_gate_b_window_days: 0 } });
    expect(r).toMatchObject({ ok: false, code: 'validation' });
    if (!r.ok) expect(r.refusals?.[0]).toMatchObject({ refused: 0, current: 90 });
    expect(update).not.toHaveBeenCalled();
  });

  it('有効キーと無効キーの混在は update を呼ばない', async () => {
    findUnique.mockResolvedValue({});
    const r = await updateTdpSettings({ group: 'gates', patch: { stall_hours: 12, tdp_gate_b_window_days: 9999 } });
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('正常値は保存し、tuning は全体を書く', async () => {
    findUnique.mockResolvedValue({});
    update.mockResolvedValue({});
    const r = await updateTdpSettings({ group: 'gates', patch: { stall_hours: 12, tdp_gate_b_min_sales: 6 } });
    expect(r.ok).toBe(true);
    const data = update.mock.calls[0]![0].data;
    expect(data.tdp_gate_b_min_sales).toBe(6);
    expect(data.tdp_tuning_json.stall_hours).toBe(12);
  });

  it('confirm は values を写して保存する', async () => {
    findUnique.mockResolvedValue({});
    update.mockResolvedValue({});
    expect((await confirmSettingsGroup({ group: 'gates' })).ok).toBe(true);
    const saved = update.mock.calls[0]![0].data.tdp_settings_confirmed_json;
    expect(saved.gates.values.tdp_gate_b_min_sales).toBe(5);
  });
});
