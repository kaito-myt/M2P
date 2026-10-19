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

/** U-9 (F-3DP-42): 同じ pixiv (BOOTH) アカウントを BOOTH 以外にも使っているか。 */
export interface U9Answer {
  answered_at: string;
  shares_pixiv_account: boolean;
  note: string;
}

/** U-10 (F-3DP-42): A2P の BOOTH 書籍売上が A2P 全体の何 % か。0 は「ゼロ」という意味のある回答。 */
export interface U10Answer {
  answered_at: string;
  booth_share_pct: number;
}

export type TdpSettings = Omit<Widen<Defaults>, 'tdp_kind_weights_json' | 'tdp_tuning_json'> & {
  tdp_monthly_publish_limit: number;
  tdp_derivative_denylist: string[];
  kind_weights: KindWeights;
  tuning: TdpTuning;
  /** null = 未回答 (列が空、または壊れていて読めない)。 */
  u9: U9Answer | null;
  u10: U10Answer | null;
};

function isoOrNull(v: unknown): string | null {
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : null;
}

function asObject(json: unknown): Record<string, unknown> | null {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
}

/** 壊れた値は「未回答」に倒す (回答済みと誤認して出品を通さないため)。 */
export function parseU9(json: unknown): U9Answer | null {
  const o = asObject(json);
  const at = isoOrNull(o?.answered_at);
  if (!o || !at || typeof o.shares_pixiv_account !== 'boolean') return null;
  return { answered_at: at, shares_pixiv_account: o.shares_pixiv_account, note: typeof o.note === 'string' ? o.note : '' };
}

export function parseU10(json: unknown): U10Answer | null {
  const o = asObject(json);
  const at = isoOrNull(o?.answered_at);
  const pct = o?.booth_share_pct;
  if (!o || !at || typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return { answered_at: at, booth_share_pct: pct };
}

/** 立ち上げチェック (T-3DP-02-10) と出品の保留判定 (hold_u9_u10) が読む 2 状態。両方そろって初めて answered。 */
export function u9u10Status(settings: Pick<TdpSettings, 'u9' | 'u10'>): {
  state: 'answered' | 'unanswered';
  u9Answered: boolean;
  u10Answered: boolean;
} {
  const u9Answered = settings.u9 !== null;
  const u10Answered = settings.u10 !== null;
  return { state: u9Answered && u10Answered ? 'answered' : 'unanswered', u9Answered, u10Answered };
}

export interface LoadedTdpSettings {
  settings: TdpSettings;
  /** true = DB から読めず全項目が既定。呼び出し側は「既定だから安全」と決めつけず警告を出す。 */
  degraded: boolean;
  /** degraded の原因 (画面は生の例外文ではなくこれで固定文を選ぶ)。 */
  reason: 'no_row' | 'read_failed' | null;
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
    ...(out as Omit<
      TdpSettings,
      'tdp_monthly_publish_limit' | 'tdp_derivative_denylist' | 'kind_weights' | 'tuning' | 'u9' | 'u10'
    >),
    tdp_monthly_publish_limit: typeof limit === 'number' ? limit : TDP_MONTHLY_LIMIT_DEFAULT,
    tdp_derivative_denylist: Array.isArray(deny) ? deny.filter((d): d is string => typeof d === 'string') : [],
    kind_weights: parseKindWeights(row?.tdp_kind_weights_json),
    tuning: parseTuning(row?.tdp_tuning_json),
    u9: parseU9(row?.tdp_u9_json),
    u10: parseU10(row?.tdp_u10_json),
  };
}

export async function loadTdpSettings(db: TdpSettingsReader): Promise<LoadedTdpSettings> {
  try {
    const row = await db.appSettings.findUnique({ where: { id: 'singleton' } });
    if (!row) {
      return { settings: settingsFromRow(null), degraded: true, reason: 'no_row', warnings: ['app_settings の singleton 行がありません。既定値で動作します'] };
    }
    return { settings: settingsFromRow(row), degraded: false, reason: null, warnings: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { settings: settingsFromRow(null), degraded: true, reason: 'read_failed', warnings: [`設定の読込に失敗したため既定値で動作します: ${msg}`] };
  }
}
