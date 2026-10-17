import { describe, expect, it } from 'vitest';

import { TDP_SETTINGS_DEFAULTS, TdpTuningSchema } from '@a2p/contracts/tdp/settings';

import {
  GROUP_KEYS,
  SETTINGS_GROUPS,
  buildConfirmed,
  groupKeys,
  proposalState,
  validateGroupPatch,
  validateMonthlyLimitPair,
} from '../settings-groups-core';
import { settingsFromRow } from '../tdp-settings';

const base = () => settingsFromRow({ ...TDP_SETTINGS_DEFAULTS, tdp_monthly_publish_limit: 8 });

describe('validateGroupPatch', () => {
  it('範囲外は丸めず拒否し、拒否値と現在値を返す', () => {
    const r = validateGroupPatch('gates', { tdp_gate_b_window_days: 9999 }, base());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals[0]).toMatchObject({ field: 'tdp_gate_b_window_days', refused: 9999, current: 90 });
  });

  it('未知キーと他グループのキーは拒否する', () => {
    const r = validateGroupPatch('gates', { nope: 1, tdp_min_price_jpy: 600 }, base());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals.map((x) => x.reason)).toEqual(['unknown_key', 'unknown_key']);
  });

  it('構成比は合計 100 のみ', () => {
    const bad = validateGroupPatch(
      'plan_price',
      { tdp_kind_weights_json: { accessory: 50, texture: 30, prop_furniture: 30 } },
      base(),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.refusals[0]).toMatchObject({
        reason: 'sum',
        current: { accessory: 50, texture: 30, prop_furniture: 20 },
      });
    }
    const good = validateGroupPatch(
      'plan_price',
      { tdp_kind_weights_json: { accessory: 40, texture: 40, prop_furniture: 20 } },
      base(),
    );
    expect(good.ok).toBe(true);
  });

  it('tuning は TdpTuningSchema で厳格に検証し、範囲外を丸めない', () => {
    const r = validateGroupPatch('generation', { meshy_poll_max_minutes: 91 }, base());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals[0]).toMatchObject({ field: 'meshy_poll_max_minutes', refused: 91, current: null });
  });

  it('tuning の保存は他キーを保ったまま全体を返す', () => {
    const r = validateGroupPatch('gates', { stall_hours: 12 }, base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tuning).toMatchObject({ stall_hours: 12, status_check_stale_hours: 48 });
  });

  it('理由の最小文字数は 0 を拒否する', () => {
    expect(validateGroupPatch('safety', { release_reason_min_chars: 0 }, base()).ok).toBe(false);
    expect(validateGroupPatch('safety', { reject_reason_min_chars: 0 }, base()).ok).toBe(false);
  });

  it('入れ子の未知キーを拒否する', () => {
    const r = validateGroupPatch('media', { booth_fetch: { interval_ms: 3000, bogus: 1 } }, base());
    expect(r.ok).toBe(false);
  });

  it('空の patch / undefined 値は拒否', () => {
    expect(validateGroupPatch('gates', {}, base()).ok).toBe(false);
    expect(validateGroupPatch('gates', { stall_hours: undefined }, base()).ok).toBe(false);
  });

  it('safety の月間枠にも合計 12 の天井が掛かる', () => {
    const r = validateGroupPatch('safety', { tdp_monthly_publish_limit: 8, tdp_jinxxy_monthly_limit: 5 }, base());
    expect(r.ok).toBe(false);
  });
});

describe('validateMonthlyLimitPair', () => {
  it('合計 13 は拒否、12/0 は可', () => {
    const cur = { booth: 8, jinxxy: 0 };
    expect(validateMonthlyLimitPair({ booth: 8, jinxxy: 5 }, cur).ok).toBe(false);
    expect(validateMonthlyLimitPair({ booth: 12, jinxxy: 0 }, cur)).toEqual({ ok: true, booth: 12, jinxxy: 0 });
  });

  it('片方だけの指定は現在値の他方と合算で判定', () => {
    expect(validateMonthlyLimitPair({ booth: 12 }, { booth: 8, jinxxy: 3 }).ok).toBe(false);
  });
});

describe('proposalState', () => {
  it('確認前は全て proposed、確認後に変えた項目だけ changed', () => {
    const s0 = base();
    expect(proposalState('gates', 'tdp_gate_b_min_sales', s0)).toBe('proposed');
    const confirmed = buildConfirmed('gates', s0, new Date('2026-10-16T00:00:00Z'));
    const s1 = settingsFromRow({
      ...TDP_SETTINGS_DEFAULTS,
      tdp_settings_confirmed_json: confirmed,
      tdp_gate_b_min_sales: 7,
    });
    expect(proposalState('gates', 'tdp_gate_b_min_sales', s1)).toBe('changed');
    expect(proposalState('gates', 'tdp_gate_b_window_days', s1)).toBe('confirmed');
    expect(proposalState('gates', 'stall_hours', s1)).toBe('confirmed');
    expect(proposalState('plan_price', 'tdp_min_price_jpy', s1)).toBe('proposed');
  });

  it('確認は他グループの確認を壊さない', () => {
    const c1 = buildConfirmed('gates', base(), new Date());
    const s1 = settingsFromRow({ ...TDP_SETTINGS_DEFAULTS, tdp_settings_confirmed_json: c1 });
    const c2 = buildConfirmed('media', s1, new Date());
    expect(Object.keys(c2).sort()).toEqual(['gates', 'media']);
  });
});

describe('GROUP_KEYS の実在 (綴り違いは型にも prisma モックにも出ない)', () => {
  const all = SETTINGS_GROUPS.flatMap((g) => groupKeys(g).map((k) => ({ g, k, spec: GROUP_KEYS[g][k]! })));

  it('column のキーは app_settings の実在列', () => {
    const real = new Set([...Object.keys(TDP_SETTINGS_DEFAULTS), 'tdp_monthly_publish_limit']);
    for (const { k, spec } of all.filter((x) => x.spec.source === 'column')) expect(real.has(k), k).toBe(true);
  });

  it('tuning のキーは TdpTuningSchema に実在し、5 グループが全 tuning キーを覆う', () => {
    const shape = Object.keys(TdpTuningSchema.shape);
    const tuningKeys = all.filter((x) => x.spec.source === 'tuning').map((x) => x.k);
    for (const k of tuningKeys) expect(shape, k).toContain(k);
    expect(new Set(tuningKeys)).toEqual(new Set(shape));
  });

  it('R2 の保持方針は generation にある', () => {
    expect(groupKeys('generation')).toEqual(expect.arrayContaining(['r2_warn_gb', 'intermediate_keep_versions']));
  });

  it('価格下限は 500 未満を拒否する', () => {
    expect(validateGroupPatch('plan_price', { tdp_min_price_jpy: 499 }, base()).ok).toBe(false);
    expect(validateGroupPatch('plan_price', { tdp_min_price_jpy: 500 }, base()).ok).toBe(true);
  });
});

describe('部分適用禁止', () => {
  it('有効キーと無効キーの混在は全体を拒否する', () => {
    const r = validateGroupPatch('gates', { stall_hours: 12, tdp_gate_b_window_days: 9999 }, base());
    expect(r.ok).toBe(false);
  });
});
