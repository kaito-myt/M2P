/**
 * S-3DP-06 設定画面のタブ構成の純ロジック (docs/12 §9.8 / §7.3a)。
 * 項目の一覧・範囲は `settings-groups-core.ts` の GROUP_KEYS が持つ。ここでは書き写さず、引いて画面用に整える。
 */
import {
  GROUP_KEYS,
  KIND_WEIGHTS_KEY,
  currentValue,
  groupKeys,
  proposalState,
  type ProposalState,
  type SettingsGroup,
} from './settings-groups-core';
import { TDP_MONTHLY_LIMIT_HARD_MAX } from '@a2p/contracts/tdp/settings';

import { messages } from './messages';
import { U9U10_FIELDS, type Refusal } from './settings-groups-core';
import type { TdpSettings } from './tdp-settings';

/** Inc-1 で作るタブ。media (Inc-4) と運用 (Inc-5) は対応するタブがまだ無く、それが正常 (§7.3a)。 */
export const SETTINGS_TABS = ['safety', 'plan_price', 'generation', 'gates'] as const satisfies readonly SettingsGroup[];
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const DEFAULT_TAB: SettingsTab = 'safety';

export function resolveTab(raw: string | string[] | undefined | null): SettingsTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (SETTINGS_TABS as readonly string[]).includes(v ?? '') ? (v as SettingsTab) : DEFAULT_TAB;
}

export interface FieldView {
  key: string;
  kind: 'number' | 'weights';
  /** 空欄を null として保存できる項目 (GROUP_KEYS の schema が null を許すものだけ)。 */
  nullable: boolean;
  value: number | null | Record<string, number>;
  state: ProposalState;
}

/** group の項目を GROUP_KEYS から引いて画面用にする。`exclude` は専用フォームが持つ項目。 */
export function buildFieldViews(group: SettingsGroup, settings: TdpSettings, exclude: readonly string[] = []): FieldView[] {
  return groupKeys(group)
    .filter((key) => !exclude.includes(key))
    .map((key) => {
      const value = currentValue(key, settings) as FieldView['value'];
      return {
        key,
        kind: key === KIND_WEIGHTS_KEY ? ('weights' as const) : ('number' as const),
        nullable: GROUP_KEYS[group][key]!.schema.safeParse(null).success,
        value,
        state: proposalState(group, key, settings),
      };
    });
}

/**
 * 入力欄の文字列 → 送る値。空欄を 0 にしない (`Number('')` は 0)。
 * 数にできないものは文字列のまま送り、サーバーに拒否させる (UI 側で丸めない)。
 */
export function parseFieldInput(raw: string, nullable: boolean): number | null | string {
  const t = raw.trim();
  if (t === '') return nullable ? null : raw;
  const n = Number(t);
  return Number.isFinite(n) ? n : raw;
}

export function fieldInputText(value: number | null): string {
  return value === null ? '' : String(value);
}

/** 確認日時 (JST 表示)。未確認・壊れた値は null。 */
export function confirmedAt(group: SettingsGroup, settings: TdpSettings): string | null {
  const conf = settings.tdp_settings_confirmed_json as Record<string, { confirmed_at?: unknown } | undefined> | null;
  const at = conf && typeof conf === 'object' ? conf[group]?.confirmed_at : undefined;
  if (typeof at !== 'string') return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function show(v: unknown): string {
  if (v === undefined) return '不明';
  if (v === null) return '未設定';
  if (v === '') return '空欄';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** 拒否 (Action の refusals) を運営者向けの 1 行ずつにする。DB 列名ではなく表示名を使う。 */
export function formatRefusals(refusals: readonly Refusal[]): string[] {
  const e = messages.settings.errors;
  const limitField: Record<string, string> = {
    tdp_monthly_publish_limit: messages.settings.limit.boothLabel,
    tdp_jinxxy_monthly_limit: messages.settings.limit.jinxxyLabel,
  };
  const label = (f: string) =>
    limitField[f] ?? messages.settings.u9u10.fieldLabels[f] ?? messages.settings.fields[f]?.label ?? f;
  const yn = (v: unknown) => (v === true ? messages.settings.u9u10.yes : v === false ? messages.settings.u9u10.no : v);
  return refusals.map((r) => {
    if (r.field === U9U10_FIELDS.shares && r.reason === 'range') {
      return e.refusal(label(r.field), show(yn(r.refused)), show(yn(r.current)));
    }
    switch (r.reason) {
      case 'unknown_key':
        return e.refusalUnknownKey(label(r.field));
      case 'sum':
        return e.refusalSum(label(r.field), show(r.current));
      case 'empty':
        return e.refusalEmpty;
      case 'required':
        return e.refusalRequired(label(r.field));
      case 'total':
        return e.limitTotal(Number(r.refused), r.current === null ? null : Number(r.current), TDP_MONTHLY_LIMIT_HARD_MAX);
      default: {
        const base = e.refusal(label(r.field), show(r.refused), show(r.current)) + (messages.settings.u9u10.rangeHint[r.field] ?? '');
        return r.field in limitField ? `${base} ${e.limitCeilingHint(TDP_MONTHLY_LIMIT_HARD_MAX)}` : base;
      }
    }
  });
}

/** 画面に出す拒否文。拒否の一覧があれば 1 件ごとに改行し、無ければ Action のメッセージ。 */
export function refusalMessage(refusals: readonly Refusal[] | undefined, fallback: string): string {
  if (!refusals || refusals.length === 0) return fallback;
  // 1 件でも拒否があれば何も保存されない (all-or-nothing)。残りが保存されたと誤解させないよう先頭に出す。
  return [messages.settings.errors.validationSummary(refusals.length), ...formatRefusals(refusals)].join(String.fromCharCode(10));
}
