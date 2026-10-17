/**
 * 3DP の設定を型付きで読むローダ (docs/12 §7.3 / C-5)。判定ロジックはしきい値の数値リテラルを持たず、
 * ここが返すオブジェクトを引数で受ける。既定値の定義は contracts の TDP_SETTINGS_DEFAULTS の 1 箇所だけ。
 */
import {
  TDP_DEFAULT_KIND_WEIGHTS,
  TDP_MONTHLY_LIMIT_DEFAULT,
  TDP_SETTINGS_DEFAULTS,
  parseTuning,
  type TdpTuning,
} from '@a2p/contracts/tdp/settings';

type Defaults = typeof TDP_SETTINGS_DEFAULTS;
// `as const` のリテラル型 (false / 0 / 500) のままだと実値を代入できないので widen する。
type Widen<T> = { -readonly [K in keyof T]: T[K] extends boolean ? boolean : T[K] extends number ? number : T[K] };

export interface KindWeights {
  accessory: number;
  texture: number;
  prop_furniture: number;
}

export type TdpSettings = Omit<Widen<Defaults>, 'tdp_kind_weights_json' | 'tdp_tuning_json'> & {
  tdp_monthly_publish_limit: number;
  tdp_derivative_denylist: string[];
  kind_weights: KindWeights;
  tuning: TdpTuning;
};

export interface LoadedTdpSettings {
  settings: TdpSettings;
  /** true = DB から読めず全項目が既定。呼び出し側は「既定だから安全」と決めつけず警告を出す。 */
  degraded: boolean;
  warnings: string[];
}

/** 最小の DI 面。テストで差し替える。 */
export interface TdpSettingsReader {
  appSettings: { findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null> };
}

export function parseKindWeights(json: unknown): KindWeights {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    const a = o.accessory;
    const t = o.texture;
    const p = o.prop_furniture;
    if (
      [a, t, p].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0) &&
      (a as number) + (t as number) + (p as number) === 100
    ) {
      return { accessory: a as number, texture: t as number, prop_furniture: p as number };
    }
  }
  return { ...TDP_DEFAULT_KIND_WEIGHTS };
}

/** DB 行 → 型付き設定。型の合わない列は既定に倒す (フラグは flag_default の側)。 */
export function settingsFromRow(row: Record<string, unknown> | null): TdpSettings {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(TDP_SETTINGS_DEFAULTS)) {
    const v = row?.[key];
    if (typeof def === 'boolean') out[key] = typeof v === 'boolean' ? v : def;
    else if (typeof def === 'number') out[key] = typeof v === 'number' ? v : def;
    else if (key.endsWith('_json')) out[key] = v ?? null;
    else out[key] = v instanceof Date ? v : null;
  }
  const limit = row?.tdp_monthly_publish_limit;
  const deny = row?.tdp_derivative_denylist;
  return {
    ...(out as Omit<TdpSettings, 'tdp_monthly_publish_limit' | 'tdp_derivative_denylist' | 'kind_weights' | 'tuning'>),
    tdp_monthly_publish_limit: typeof limit === 'number' ? limit : TDP_MONTHLY_LIMIT_DEFAULT,
    tdp_derivative_denylist: Array.isArray(deny) ? deny.filter((d): d is string => typeof d === 'string') : [],
    kind_weights: parseKindWeights(row?.tdp_kind_weights_json),
    tuning: parseTuning(row?.tdp_tuning_json),
  };
}

export async function loadTdpSettings(db: TdpSettingsReader): Promise<LoadedTdpSettings> {
  try {
    const row = await db.appSettings.findUnique({ where: { id: 'singleton' } });
    if (!row) {
      return { settings: settingsFromRow(null), degraded: true, warnings: ['app_settings の singleton 行がありません。既定値で動作します'] };
    }
    return { settings: settingsFromRow(row), degraded: false, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { settings: settingsFromRow(null), degraded: true, warnings: [`設定の読込に失敗したため既定値で動作します: ${msg}`] };
  }
}
