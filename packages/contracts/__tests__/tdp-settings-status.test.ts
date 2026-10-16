import { describe, expect, it } from 'vitest';

import {
  TDP_MONTHLY_LIMIT_HARD_MAX,
  TDP_SETTINGS_DEFAULTS,
  TdpTuningSchema,
  kindGroup,
  parseTuning,
} from '../src/tdp/settings';
import {
  ALLOWED_TRANSITIONS,
  PRODUCT_STATUSES,
  TERMINAL_STATUSES,
  canTransition,
  type ProductStatus,
} from '../src/tdp/status';

// docs/12 §7.3 の表 (Meshy 系 4 列を除く)。実装から導出しない。
const EXPECTED_KEYS = [
  'tdp_research_enabled', 'tdp_planner_enabled', 'tdp_sales_fetch_enabled', 'tdp_status_check_enabled',
  'tdp_booth_public_fetch_enabled', 'tdp_kill_switch_on', 'tdp_kill_switch_since', 'tdp_retire_mode',
  'tdp_degrade_mode', 'tdp_jinxxy_monthly_limit', 'tdp_jinxxy_counts_toward_gate',
  'tdp_jinxxy_gate_switched_at', 'tdp_u9_json', 'tdp_u10_json', 'tdp_settings_confirmed_json',
  'tdp_min_price_jpy', 'tdp_regen_limit_asset', 'tdp_regen_limit_product', 'tdp_gate_b_min_sales',
  'tdp_gate_b_window_days', 'tdp_gate_c_point_days', 'tdp_gate_e_monthly_minutes', 'tdp_yield_warn_pct',
  'tdp_derivative_reject_warn_pct', 'tdp_kind_weights_json', 'tdp_tuning_json',
];

const EXPECTED_TUNING_KEYS = [
  'stall_hours', 'status_check_stale_hours', 'status_check_full_below', 'status_check_cycle_days',
  'status_check_unreachable_warn_days', 'stock_cap_multiplier', 'intermediate_keep_versions', 'r2_warn_gb',
  'credit_warn_per_product', 'credit_cap_per_product', 'meshy_monthly_credit_cap', 'meshy_balance_warn',
  'meshy_poll_interval_sec', 'meshy_poll_max_minutes', 'slot_reserve_expire_days', 'work_cap_review_min',
  'work_cap_publish_min', 'release_reason_min_chars', 'reject_reason_min_chars', 'listing_extra_forbidden',
  'render_selfcheck', 'sales_source', 'booth_fetch',
];

describe('TDP_SETTINGS_DEFAULTS', () => {
  it('上限は 12', () => expect(TDP_MONTHLY_LIMIT_HARD_MAX).toBe(12));
  it('キー集合が §7.3 (Meshy 系除く) と完全一致', () => {
    expect(Object.keys(TDP_SETTINGS_DEFAULTS).sort()).toEqual([...EXPECTED_KEYS].sort());
  });
  it('主要な既定値', () => {
    expect(TDP_SETTINGS_DEFAULTS.tdp_status_check_enabled).toBe(true);
    expect(TDP_SETTINGS_DEFAULTS.tdp_min_price_jpy).toBe(500);
    expect(TDP_SETTINGS_DEFAULTS.tdp_jinxxy_monthly_limit).toBe(0);
  });
});

describe('TdpTuning', () => {
  it('parseTuning({}) は全キー既定', () => {
    const t = parseTuning({});
    expect(Object.keys(t).sort()).toEqual([...EXPECTED_TUNING_KEYS].sort());
    expect(t.stall_hours).toBe(24);
    expect(t.meshy_poll_interval_sec).toBeNull();
    expect(t.render_selfcheck).toEqual({ min_non_bg_ratio: 0.02, min_stddev: 6 });
    expect(t.booth_fetch).toEqual({ interval_ms: 3000, max_pages: 10, contact: null });
    expect(t.sales_source).toBe('manual');
  });
  it('null / 配列 / 文字列でも throw せず既定', () => {
    for (const v of [null, undefined, [], 'x', 3]) expect(parseTuning(v).stall_hours).toBe(24);
  });
  it('型違いは既定に戻し、正しい他キーは保つ', () => {
    const t = parseTuning({ stall_hours: 'x', r2_warn_gb: 30, meshy_poll_max_minutes: 91 });
    expect(t.stall_hours).toBe(24);
    expect(t.r2_warn_gb).toBe(30);
    expect(t.meshy_poll_max_minutes).toBeNull();
  });
  it('入れ子は部分的に補う', () => {
    const t = parseTuning({ booth_fetch: { interval_ms: 'bad', max_pages: 5, contact: 'a@b.c' } });
    expect(t.booth_fetch).toEqual({ interval_ms: 3000, max_pages: 5, contact: 'a@b.c' });
  });
  it('meshy_poll_max_minutes: 91 は拒否、90 は可、null 可', () => {
    expect(TdpTuningSchema.safeParse({ meshy_poll_max_minutes: 91 }).success).toBe(false);
    expect(TdpTuningSchema.safeParse({ meshy_poll_max_minutes: 90 }).success).toBe(true);
    expect(TdpTuningSchema.safeParse({ meshy_poll_max_minutes: null }).success).toBe(true);
  });
});

describe('kindGroup', () => {
  it('D-16', () => {
    expect(kindGroup('accessory')).toBe('accessory');
    expect(kindGroup('texture')).toBe('texture');
    expect(kindGroup('prop')).toBe('prop_furniture');
    expect(kindGroup('furniture')).toBe('prop_furniture');
  });
});

describe('status machine', () => {
  it('PRODUCT_STATUSES は §9.5 の順の 11 値', () => {
    expect([...PRODUCT_STATUSES]).toEqual([
      'planned', 'generating', 'inspecting', 'needs_fix', 'ready', 'review',
      'approved', 'listed', 'withdrawn', 'failed', 'rejected',
    ]);
  });
  // §17.3 の T-2b〜T-16 を辺として列挙 (T-1/T-2 は新規行で辺ではない)
  const EDGES: Array<[ProductStatus, ProductStatus]> = [
    ['planned', 'rejected'], ['needs_fix', 'rejected'], ['generating', 'rejected'],
    ['planned', 'generating'], ['generating', 'inspecting'], ['inspecting', 'generating'],
    ['inspecting', 'needs_fix'], ['needs_fix', 'generating'],
    ['needs_fix', 'failed'], ['generating', 'failed'], ['inspecting', 'failed'],
    ['inspecting', 'ready'], ['ready', 'review'], ['review', 'approved'],
    ['review', 'generating'], ['review', 'ready'], ['review', 'rejected'],
    ['approved', 'listed'], ['listed', 'withdrawn'],
  ];
  it('§17.3 の全辺が許可', () => {
    for (const [f, t] of EDGES) expect(canTransition(f, t), `${f}->${t}`).toBe(true);
  });
  it('辺の総数が表と一致 (余計な辺が無い)', () => {
    const total = Object.values(ALLOWED_TRANSITIONS).reduce((n, a) => n + a.length, 0);
    expect(total).toBe(EDGES.length);
  });
  it('表に無い辺は拒否', () => {
    expect(canTransition('planned', 'listed')).toBe(false);
    expect(canTransition('review', 'listed')).toBe(false);
    expect(canTransition('listed', 'approved')).toBe(false);
  });
  it('listed への入辺は approved のただ 1 本', () => {
    expect(PRODUCT_STATUSES.filter((s) => canTransition(s, 'listed'))).toEqual(['approved']);
  });
  it('terminal の出辺は 0', () => {
    for (const s of TERMINAL_STATUSES) expect(ALLOWED_TRANSITIONS[s]).toHaveLength(0);
    expect([...TERMINAL_STATUSES].sort()).toEqual(['failed', 'rejected', 'withdrawn']);
  });
});
