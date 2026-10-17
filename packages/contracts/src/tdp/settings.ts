/**
 * 3DP の設定値のうち「コード側の固定値」と既定値 (docs/12 §7.3)。判定値・上限の定義箇所は
 * ここの 1 つだけ (C-5)。migration の DEFAULT とは一致テストで結ぶ。
 */
import { z } from 'zod';

// 定義を derivative-guard.ts に置かないのは、定義が 2 箇所になり片方だけ下げる事故を避けるため (SP-3DP-02 T-3DP-02-01)。
/** 月間出品上限として設定できる最大。既定 8 の 1.5 倍で、「今月だけ 30 商品」ができない線 (docs/12 F-3DP-41)。 */
export const TDP_MONTHLY_LIMIT_HARD_MAX = 12;

/** Meshy 系 4 列 (tdp_meshy_*) は SP-3DP-03 の migration で足すのでここには入れない。 */
export const TDP_SETTINGS_DEFAULTS = {
  tdp_research_enabled: false,
  tdp_planner_enabled: false,
  tdp_sales_fetch_enabled: false,
  tdp_status_check_enabled: true,
  tdp_booth_public_fetch_enabled: false,
  tdp_kill_switch_on: false,
  tdp_kill_switch_since: null as Date | null,
  tdp_retire_mode: false,
  tdp_degrade_mode: false,
  tdp_jinxxy_monthly_limit: 0,
  tdp_jinxxy_counts_toward_gate: false,
  tdp_jinxxy_gate_switched_at: null as Date | null,
  tdp_u9_json: null as unknown,
  tdp_u10_json: null as unknown,
  tdp_settings_confirmed_json: null as unknown,
  tdp_min_price_jpy: 500,
  tdp_regen_limit_asset: 3,
  tdp_regen_limit_product: 10,
  tdp_gate_b_min_sales: 5,
  tdp_gate_b_window_days: 90,
  tdp_gate_c_point_days: 180,
  tdp_gate_e_monthly_minutes: 240,
  tdp_yield_warn_pct: 50,
  tdp_derivative_reject_warn_pct: 50,
  tdp_kind_weights_json: null as unknown,
  tdp_tuning_json: null as unknown,
} as const;

export const TDP_KINDS = ['accessory', 'texture', 'prop', 'furniture'] as const;
/** tdp_monthly_publish_limit の既定 (DB の DEFAULT と同値)。worker も読むので contracts の 1 箇所に置く。 */
export const TDP_MONTHLY_LIMIT_DEFAULT = 8;

/** tdp_kind_weights_json の null = この構成比 (合計 100)。DB 側に DEFAULT は無い。 */
export const TDP_DEFAULT_KIND_WEIGHTS = { accessory: 50, texture: 30, prop_furniture: 20 } as const;

export type TdpKind = (typeof TDP_KINDS)[number];
export type TdpKindGroup = 'accessory' | 'texture' | 'prop_furniture';

/** 構成比は 3 区分 (D-16)。kind は 4 値のまま。 */
export function kindGroup(kind: TdpKind): TdpKindGroup {
  if (kind === 'accessory') return 'accessory';
  if (kind === 'texture') return 'texture';
  return 'prop_furniture';
}

const posInt = z.number().int().min(0);
// 0 だと「理由が空でよい」「0 日ごと」など判定が壊れる項目 (docs/12 §17.4 / A-10)
const posIntMin1 = z.number().int().min(1);

export const RenderSelfcheckSchema = z.object({
  min_non_bg_ratio: z.number().min(0).max(1).default(0.02),
  min_stddev: z.number().min(0).default(6),
});

export const BoothFetchSchema = z.object({
  interval_ms: posInt.default(3000),
  max_pages: posInt.default(10),
  // UA に明示する運営者の連絡先 (F-3DP-23/39)。未設定のまま BOOTH を取得するタスクは実行しない。
  contact: z.string().nullable().default(null),
});

export const TdpTuningSchema = z.object({
  stall_hours: posIntMin1.default(24),
  status_check_stale_hours: posIntMin1.default(48),
  status_check_full_below: posInt.default(30),
  status_check_cycle_days: posIntMin1.default(3),
  status_check_unreachable_warn_days: posInt.default(2),
  stock_cap_multiplier: z.number().min(0).default(2),
  intermediate_keep_versions: posIntMin1.default(3),
  r2_warn_gb: z.number().min(0).default(20),
  credit_warn_per_product: posInt.default(60),
  credit_cap_per_product: posInt.default(250),
  meshy_monthly_credit_cap: posInt.default(900),
  meshy_balance_warn: posInt.default(150),
  meshy_poll_interval_sec: z.number().int().min(1).nullable().default(null),
  // sweepStaleJobs の 120 分より短く (docs/12 §17.5.2)
  meshy_poll_max_minutes: z.number().int().min(1).max(90).nullable().default(null),
  slot_reserve_expire_days: posIntMin1.default(14),
  work_cap_review_min: posInt.default(30),
  work_cap_publish_min: posInt.default(60),
  release_reason_min_chars: posIntMin1.default(20),
  reject_reason_min_chars: posIntMin1.default(5),
  listing_extra_forbidden: z.array(z.string()).default([]),
  render_selfcheck: RenderSelfcheckSchema.default({}),
  sales_source: z.enum(['manual', 'booth_manage_readonly']).default('manual'),
  booth_fetch: BoothFetchSchema.default({}),
});

export type TdpTuning = z.infer<typeof TdpTuningSchema>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 欠けたキーは既定で補い、型違いのキーは既定に戻す (throw しない)。保存時の厳格検証は TdpTuningSchema 側。 */
export function parseTuning(json: unknown): TdpTuning {
  const src = isPlainObject(json) ? json : {};
  const defaults = TdpTuningSchema.parse({}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(TdpTuningSchema.shape)) {
    const d = defaults[key];
    if (!(key in src)) {
      out[key] = d;
      continue;
    }
    if (isPlainObject(d)) {
      const sub = isPlainObject(src[key]) ? (src[key] as Record<string, unknown>) : {};
      const inner = (key === 'render_selfcheck' ? RenderSelfcheckSchema : BoothFetchSchema).shape;
      const merged: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(inner)) {
        const r = (f as z.ZodTypeAny).safeParse(sub[k]);
        merged[k] = k in sub && r.success ? r.data : d[k];
      }
      out[key] = merged;
      continue;
    }
    const r = (field as z.ZodTypeAny).safeParse(src[key]);
    out[key] = r.success ? r.data : d;
  }
  return out as TdpTuning;
}
