/**
 * S-3DP-06 設定グループの純ロジック (docs/12 §7.3 / §15.7 / §17.4)。
 * 検証は「丸めず拒否」— 範囲外を黙って寄せると、運営者が決めた値と実際の動作が食い違う。
 * `parseTuning` (寛容: 読み出し用) と `TdpTuningSchema` (厳格: 保存用) を混ぜない。保存は常に後者。
 */
import { z } from 'zod';

import {
  BoothFetchSchema,
  RenderSelfcheckSchema,
  TDP_MONTHLY_LIMIT_HARD_MAX,
  TdpTuningSchema,
  parseTuning,
  type TdpTuning,
} from '@a2p/contracts/tdp/settings';

import { validateMonthlyLimit } from './settings-core';
import type { TdpSettings } from './tdp-settings';

export const SETTINGS_GROUPS = ['safety', 'plan_price', 'generation', 'gates', 'media'] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export const SettingsGroupSchema = z.enum(SETTINGS_GROUPS);

export type ProposalState = 'proposed' | 'confirmed' | 'changed';

export interface Refusal {
  field: string;
  refused: unknown;
  current: unknown;
  reason: 'unknown_key' | 'range' | 'sum' | 'total' | 'empty' | 'required';
}

interface KeySpec {
  source: 'column' | 'tuning';
  schema: z.ZodTypeAny;
}

const col = (schema: z.ZodTypeAny): KeySpec => ({ source: 'column', schema });
const intRange = (min: number, max: number) => z.number().int().min(min).max(max);

const tun = (key: keyof TdpTuning): KeySpec => ({ source: 'tuning', schema: TdpTuningSchema.shape[key] });

const monthlyLimit = intRange(0, TDP_MONTHLY_LIMIT_HARD_MAX);

export const KIND_WEIGHTS_KEY = 'tdp_kind_weights_json';
const KindWeightsInputSchema = z
  .object({ accessory: intRange(0, 100), texture: intRange(0, 100), prop_furniture: intRange(0, 100) })
  .strict();

export const GROUP_KEYS: Record<SettingsGroup, Record<string, KeySpec>> = {
  safety: {
    tdp_monthly_publish_limit: col(monthlyLimit),
    tdp_jinxxy_monthly_limit: col(monthlyLimit),
    release_reason_min_chars: tun('release_reason_min_chars'),
    reject_reason_min_chars: tun('reject_reason_min_chars'),
    slot_reserve_expire_days: tun('slot_reserve_expire_days'),
  },
  plan_price: {
    tdp_min_price_jpy: col(intRange(500, 100000)),
    [KIND_WEIGHTS_KEY]: col(KindWeightsInputSchema),
    stock_cap_multiplier: tun('stock_cap_multiplier'),
  },
  generation: {
    tdp_regen_limit_asset: col(intRange(1, 20)),
    tdp_regen_limit_product: col(intRange(1, 50)),
    tdp_yield_warn_pct: col(intRange(0, 100)),
    credit_warn_per_product: tun('credit_warn_per_product'),
    credit_cap_per_product: tun('credit_cap_per_product'),
    meshy_monthly_credit_cap: tun('meshy_monthly_credit_cap'),
    meshy_balance_warn: tun('meshy_balance_warn'),
    meshy_poll_interval_sec: tun('meshy_poll_interval_sec'),
    meshy_poll_max_minutes: tun('meshy_poll_max_minutes'),
    r2_warn_gb: tun('r2_warn_gb'),
    intermediate_keep_versions: tun('intermediate_keep_versions'),
  },
  gates: {
    tdp_gate_b_min_sales: col(intRange(1, 10000)),
    tdp_gate_b_window_days: col(intRange(1, 730)),
    tdp_gate_c_point_days: col(intRange(1, 730)),
    tdp_gate_e_monthly_minutes: col(intRange(1, 100000)),
    tdp_derivative_reject_warn_pct: col(intRange(0, 100)),
    stall_hours: tun('stall_hours'),
    status_check_stale_hours: tun('status_check_stale_hours'),
    work_cap_review_min: tun('work_cap_review_min'),
    work_cap_publish_min: tun('work_cap_publish_min'),
  },
  media: {
    sales_source: tun('sales_source'),
    booth_fetch: { source: 'tuning', schema: BoothFetchSchema.strict() },
    render_selfcheck: { source: 'tuning', schema: RenderSelfcheckSchema.strict() },
    listing_extra_forbidden: {
      source: 'tuning',
      schema: z.array(z.string().trim().min(1).max(80)).max(500),
    },
    status_check_full_below: tun('status_check_full_below'),
    status_check_cycle_days: tun('status_check_cycle_days'),
    status_check_unreachable_warn_days: tun('status_check_unreachable_warn_days'),
  },
};

/** group が扱うキー (確認・バッジの単位)。 */
export function groupKeys(group: SettingsGroup): string[] {
  return Object.keys(GROUP_KEYS[group]);
}

/** group ごとの zod (未知キー拒否)。UI が型を引くための口で、検証の本体は validateGroupPatch。 */
export function groupSchema(group: SettingsGroup) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, spec] of Object.entries(GROUP_KEYS[group])) shape[k] = spec.schema.optional();
  return z.object(shape).strict();
}

function sourceOf(key: string): 'column' | 'tuning' {
  for (const g of Object.values(GROUP_KEYS)) if (g[key]) return g[key].source;
  return 'column';
}

export function currentValue(key: string, settings: TdpSettings): unknown {
  if (key === KIND_WEIGHTS_KEY) return settings.kind_weights;
  if (sourceOf(key) === 'tuning') return (settings.tuning as Record<string, unknown>)[key];
  return (settings as unknown as Record<string, unknown>)[key];
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** `tdp_settings_confirmed_json[group].values[key]` と現在値の比較。確認後に値を変えたら 'changed'。 */
export function proposalState(group: SettingsGroup, key: string, settings: TdpSettings): ProposalState {
  const conf = settings.tdp_settings_confirmed_json as Record<string, { values?: Record<string, unknown> } | undefined> | null;
  const entry = conf && typeof conf === 'object' ? conf[group] : undefined;
  const values = entry?.values;
  if (!values || typeof values !== 'object' || !(key in values)) return 'proposed';
  return canonical(values[key]) === canonical(currentValue(key, settings)) ? 'confirmed' : 'changed';
}

export type GroupPatchResult =
  | { ok: true; columns: Record<string, unknown>; tuning: TdpTuning | null }
  | { ok: false; refusals: Refusal[] };

/** 月間枠 (booth + jinxxy) の検証。各枠にも合計にも同じ天井を掛ける (媒体を増やして総量を増やす抜け道を塞ぐ)。 */
export function validateMonthlyLimitPair(
  input: { booth?: unknown; jinxxy?: unknown },
  current: { booth: number; jinxxy: number },
): { ok: true; booth: number; jinxxy: number } | { ok: false; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const out = { booth: current.booth, jinxxy: current.jinxxy };
  for (const k of ['booth', 'jinxxy'] as const) {
    if (input[k] === undefined) continue;
    const r = validateMonthlyLimit(input[k]);
    if (!r.ok) {
      refusals.push({
        field: k === 'booth' ? 'tdp_monthly_publish_limit' : 'tdp_jinxxy_monthly_limit',
        refused: input[k],
        current: current[k],
        reason: 'range',
      });
    } else out[k] = r.value;
  }
  if (refusals.length > 0) return { ok: false, refusals };
  if (out.booth + out.jinxxy > TDP_MONTHLY_LIMIT_HARD_MAX) {
    return {
      ok: false,
      refusals: [
        { field: 'total', refused: out.booth + out.jinxxy, current: current.booth + current.jinxxy, reason: 'total' },
      ],
    };
  }
  return { ok: true, ...out };
}

export function validateGroupPatch(group: SettingsGroup, patch: unknown, settings: TdpSettings): GroupPatchResult {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return { ok: false, refusals: [{ field: '(patch)', refused: patch, current: null, reason: 'empty' }] };
  }
  const specs = GROUP_KEYS[group];
  const refusals: Refusal[] = [];
  const columns: Record<string, unknown> = {};
  const tuningPatch: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const spec = Object.prototype.hasOwnProperty.call(specs, key) ? specs[key] : undefined;
    if (!spec) {
      refusals.push({ field: key, refused: value, current: null, reason: 'unknown_key' });
      continue;
    }
    const current = currentValue(key, settings);
    if (value === undefined) {
      refusals.push({ field: key, refused: value, current, reason: 'required' });
      continue;
    }
    const r = spec.schema.safeParse(value);
    if (!r.success) {
      refusals.push({ field: key, refused: value, current, reason: 'range' });
      continue;
    }
    if (key === KIND_WEIGHTS_KEY) {
      const w = r.data as { accessory: number; texture: number; prop_furniture: number };
      if (w.accessory + w.texture + w.prop_furniture !== 100) {
        refusals.push({ field: key, refused: value, current, reason: 'sum' });
        continue;
      }
      columns[key] = w;
    } else if (spec.source === 'tuning') tuningPatch[key] = r.data;
    else columns[key] = r.data;
  }

  if ('tdp_monthly_publish_limit' in columns || 'tdp_jinxxy_monthly_limit' in columns) {
    const pair = validateMonthlyLimitPair(
      { booth: columns.tdp_monthly_publish_limit, jinxxy: columns.tdp_jinxxy_monthly_limit },
      { booth: settings.tdp_monthly_publish_limit, jinxxy: settings.tdp_jinxxy_monthly_limit },
    );
    if (!pair.ok) refusals.push(...pair.refusals);
  }

  if (refusals.length > 0) return { ok: false, refusals };

  let tuning: TdpTuning | null = null;
  if (Object.keys(tuningPatch).length > 0) {
    const merged = TdpTuningSchema.safeParse({ ...parseTuning(settings.tuning), ...tuningPatch });
    if (!merged.success) {
      return {
        ok: false,
        refusals: Object.keys(tuningPatch).map((k) => ({
          field: k,
          refused: tuningPatch[k],
          current: currentValue(k, settings),
          reason: 'range' as const,
        })),
      };
    }
    tuning = merged.data;
  }
  return { ok: true, columns, tuning };
}

/** 確認時点の値の写し。他グループの確認は壊さない。 */
export function buildConfirmed(group: SettingsGroup, settings: TdpSettings, now: Date): Record<string, unknown> {
  const prev = settings.tdp_settings_confirmed_json;
  const base = prev && typeof prev === 'object' && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const values: Record<string, unknown> = {};
  for (const key of groupKeys(group)) values[key] = currentValue(key, settings);
  return { ...base, [group]: { confirmed_at: now.toISOString(), values } };
}
