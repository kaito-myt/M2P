/**
 * S-3DP-01 ホームの集計ロジック (純関数)。RSC から DB を読む部分と分離し、
 * ここだけをユニットテストする (apps/anp/lib/home-core.ts と同じ方針)。
 */
import { canListMore } from '@a2p/contracts/tdp/derivative-guard';
import { computeSlots } from '@a2p/contracts/tdp/hold';
import { PRODUCT_STATUSES } from '@a2p/contracts/tdp/status';

import { messages } from './messages';
import { groupKeys, proposalState, type SettingsGroup } from './settings-groups-core';
import { u9u10Status, type TdpSettings } from './tdp-settings';

/** 状態の正準順は contracts (`tdp/status`) の 1 箇所だけが持つ。ここに写さない。 */
export { PRODUCT_STATUSES };

export interface StatusCountRow {
  status: string;
  count: number;
}

/**
 * `prisma.tdpProduct.groupBy({ by: ['status'], _count: ... })` の結果を
 * 正準順の行に整える。**0 件の状態も行として残す** — 「承認待ちが 0 件」は
 * 「承認待ちという状態が存在しない」とは意味が違う (ゲートが空いていることの確認になる)。
 * 未知の status (将来追加/手動投入) は末尾に出す。消すと件数が合わなくなる。
 */
export function buildStatusRows(groups: ReadonlyArray<StatusCountRow>): StatusCountRow[] {
  const byStatus = new Map<string, number>();
  for (const g of groups) {
    byStatus.set(g.status, (byStatus.get(g.status) ?? 0) + g.count);
  }
  const rows: StatusCountRow[] = PRODUCT_STATUSES.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
  for (const [status, count] of byStatus) {
    if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) {
      rows.push({ status, count });
    }
  }
  return rows;
}

/** 合計件数。 */
export function totalCount(rows: ReadonlyArray<StatusCountRow>): number {
  return rows.reduce((sum, r) => sum + r.count, 0);
}

export interface QuotaView {
  /** 実効上限 (設定値をコード側の天井で切った値。残枠の計算に使うのはこれ)。 */
  limit: number;
  /** 設定値 (app_settings.tdp_monthly_publish_limit)。天井を超えて保存されていると limit と違う。 */
  configuredLimit: number;
  /** 設定値が天井で読み替えられているか (§17.10.4)。 */
  clamped: boolean;
  /** 当月すでに出品した件数。 */
  listed: number;
  /** あと何件出せるか。 */
  remaining: number;
  /** まだ出せるか。 */
  allowed: boolean;
  /** 出せない理由 (R-1 の文面)。 */
  reason?: string;
}

/**
 * 月間出品枠 (R-1) の表示用ビュー。判定そのものは `canListMore()` に委ね、
 * ここは表示に必要な値を揃えるだけにする (判定を 2 箇所に書かない)。
 */
export function buildQuotaView(args: { listedThisMonth: number; monthlyLimit: number }): QuotaView {
  const listed = Math.max(0, args.listedThisMonth);
  const configuredLimit = Math.max(0, args.monthlyLimit);
  const result = canListMore({ listedThisMonth: listed, monthlyLimit: configuredLimit });
  const { limit } = computeSlots({ limit: configuredLimit, publishedThisMonth: listed, activeReservations: 0 });
  return {
    limit,
    configuredLimit,
    clamped: configuredLimit > limit,
    listed,
    remaining: result.remaining,
    allowed: result.allowed,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}

export interface QuotaSummary {
  /** null = 設定を読めず上限が分からない (0 = 出品停止、とは別物)。 */
  limit: number | null;
  configuredLimit: number | null;
  clamped: boolean;
  /** null = 当月の出品数を取得できなかった (0 件、とは別物)。 */
  listed: number | null;
  /** 上限も出品数も分かるときだけ判定する。 */
  allowed: boolean | null;
  reason?: string;
}

/**
 * ホームの「当月の出品枠」。数値は必ず `buildQuotaView` を通す (設定画面と別の数を言わないため)。
 * 読めなかったものは 0 に丸めず null で返す。
 */
export function buildQuotaSummary(args: {
  listedThisMonth: number | null;
  monthlyLimit: number | null;
}): QuotaSummary {
  const { listedThisMonth, monthlyLimit } = args;
  const view = buildQuotaView({ listedThisMonth: listedThisMonth ?? 0, monthlyLimit: monthlyLimit ?? 0 });
  const known = listedThisMonth !== null && monthlyLimit !== null;
  return {
    limit: monthlyLimit === null ? null : view.limit,
    configuredLimit: monthlyLimit === null ? null : view.configuredLimit,
    clamped: monthlyLimit !== null && view.clamped,
    listed: listedThisMonth === null ? null : view.listed,
    allowed: known ? view.allowed : null,
    ...(known && view.reason !== undefined ? { reason: view.reason } : {}),
  };
}

export type Stage = 'stage0' | 'stage1' | 'stage2';

/** docs/12 §9.6.1。データから自動判定する (設定項目にしない)。 */
export function determineStage(args: { total: number; listed: number }): Stage {
  if (args.listed > 0) return 'stage2';
  return args.total > 0 ? 'stage1' : 'stage0';
}

export interface HeroMetric {
  /** 表示する値。売上が無い間は '—' (0 円とは別物)。 */
  value: string;
  /** value が '—' のときの理由。値があるときは null。 */
  reason: string | null;
  available: boolean;
}

function yen(n: number): string {
  return `${n < 0 ? '−' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;
}

/**
 * ヒーロー (UR-1/UR-2)。売上を取得していない間は '0' を返さず '—' + 理由。
 * 取得済みで売上ゼロ (`salesTotalJpy === 0`) は '¥0' になり、未取得と区別される。
 */
export function buildHero(args: {
  salesFetched: boolean;
  netProfitJpy: number | null;
  salesTotalJpy: number | null;
  listedProducts: number;
}): { netProfit: HeroMetric; salesPerProduct: HeroMetric } {
  const h = messages.home.hero;
  const none = (reason: string): HeroMetric => ({ value: h.none, reason, available: false });
  if (!args.salesFetched) {
    return { netProfit: none(h.notStarted), salesPerProduct: none(h.notStarted) };
  }
  const netProfit: HeroMetric =
    args.netProfitJpy === null
      ? none(h.costUnknown)
      : { value: yen(args.netProfitJpy), reason: null, available: true };
  let salesPerProduct: HeroMetric;
  if (args.salesTotalJpy === null) salesPerProduct = none(h.notStarted);
  else if (args.listedProducts <= 0) salesPerProduct = none(h.noListed);
  else {
    salesPerProduct = {
      value: yen(Math.round(args.salesTotalJpy / args.listedProducts)),
      reason: null,
      available: true,
    };
  }
  return { netProfit, salesPerProduct };
}

export type CheckState = 'done' | 'todo' | 'unknown';
export type CheckId = 'confirm_proposals' | 'first_prototype' | 'u9u10';

export interface CheckItem {
  id: CheckId;
  state: CheckState;
}

/** 立ち上げチェックが「確認済」を要求する設定グループ (docs/12 §9.6.2 項目 1。媒体は Inc-4)。 */
export const CHECKED_GROUPS: readonly SettingsGroup[] = ['safety', 'plan_price', 'generation', 'gates'];

export function unconfirmedGroups(settings: TdpSettings): SettingsGroup[] {
  return CHECKED_GROUPS.filter((g) => !groupKeys(g).every((k) => proposalState(g, k, settings) === 'confirmed'));
}

/**
 * 立ち上げチェック (docs/12 §9.6.2 の項目 1 / 3 / 4)。運営者の手が要るものだけ。
 * 読めなかったものは 'unknown' (済にも未にも倒さない)。
 * @param settingsOk 設定を DB から実際に読めたか (false なら項目 1 / 4 は確認できない)
 * @param productTotal null = 商品件数を取得できなかった
 */
export function buildLaunchChecklist(args: {
  settings: TdpSettings;
  settingsOk: boolean;
  productTotal: number | null;
}): CheckItem[] {
  const { settings, settingsOk, productTotal } = args;
  return [
    {
      id: 'confirm_proposals',
      state: !settingsOk ? 'unknown' : unconfirmedGroups(settings).length === 0 ? 'done' : 'todo',
    },
    {
      id: 'first_prototype',
      state: productTotal === null ? 'unknown' : productTotal > 0 ? 'done' : 'todo',
    },
    {
      id: 'u9u10',
      state: !settingsOk ? 'unknown' : u9u10Status(settings).state === 'answered' ? 'done' : 'todo',
    },
  ];
}

/** Stage 0 は全項目、Stage 1 以降は済でない項目だけ (全部済なら空 = 節ごと畳む)。 */
export function visibleChecklist(stage: Stage, items: ReadonlyArray<CheckItem>): CheckItem[] {
  return stage === 'stage0' ? [...items] : items.filter((i) => i.state !== 'done');
}
