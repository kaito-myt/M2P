import { describe, expect, it } from 'vitest';

import { TDP_SETTINGS_DEFAULTS } from '@a2p/contracts/tdp/settings';

import { loadTdpSettings } from '../tdp-settings';

describe('loadTdpSettings', () => {
  it('読込失敗はフラグを既定側に倒し、警告を返す (例外にしない)', async () => {
    const r = await loadTdpSettings({
      appSettings: {
        findUnique: async () => {
          throw new Error('db down');
        },
      },
    });
    expect(r.degraded).toBe(true);
    expect(r.warnings[0]).toContain('db down');
    expect(r.reason).toBe('read_failed');
    expect(r.settings.tdp_status_check_enabled).toBe(TDP_SETTINGS_DEFAULTS.tdp_status_check_enabled);
    expect(r.settings.tdp_research_enabled).toBe(false);
    expect(r.settings.tuning.stall_hours).toBe(24);
  });

  it('行が無いときも警告つきで既定', async () => {
    const r = await loadTdpSettings({ appSettings: { findUnique: async () => null } });
    expect(r.degraded).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.reason).toBe('no_row');
  });

  it('実値は widen された型で受け取れ、tuning は parseTuning で補われる', async () => {
    const r = await loadTdpSettings({
      appSettings: {
        findUnique: async () => ({
          tdp_min_price_jpy: 800,
          tdp_research_enabled: true,
          tdp_tuning_json: { stall_hours: 6 },
          tdp_kind_weights_json: { accessory: 1 },
        }),
      },
    });
    expect(r.degraded).toBe(false);
    expect(r.settings.tdp_min_price_jpy).toBe(800);
    expect(r.settings.tdp_research_enabled).toBe(true);
    expect(r.settings.tuning.stall_hours).toBe(6);
    expect(r.settings.tuning.status_check_stale_hours).toBe(48);
    expect(r.settings.kind_weights).toEqual({ accessory: 50, texture: 30, prop_furniture: 20 });
  });
});
