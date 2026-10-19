/**
 * S-3DP-01 ホームの集計ロジック (純関数)。RSC から DB を読む部分と分離し、
 * ここだけをユニットテストする (apps/anp/lib/home-core.ts と同じ方針)。
 */
import { canListMore } from '@a2p/contracts/tdp/derivative-guard';
import { computeSlots } from '@a2p/contracts/tdp/hold';

/** docs/12 §7 `tdp_products.status` の正準順。UI の並びもこの順に固定する。 */
export const PRODUCT_STATUSES = [
  'planned',
  'generating',
  'inspecting',
  'needs_fix',
  'ready',
  'review',
  'listed',
  'failed',
  'rejected',
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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

/**
 * JST の当月範囲 (UTC の Date で返す)。
 *
 * `listed_at` は timestamp に UTC を入れているので、JST の月初は UTC 月初 -9h。
 * (`@a2p/contracts/cost-attribution` の `jstMonthRange` と同一の考え方。
 *  ここで 1 時間ずれると「当月の出品枠」が月初/月末に食い違う。)
 */
export function jstMonthRange(now: Date): { start: Date; end: Date } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const at = (year: number, month: number) => new Date(Date.UTC(year, month, 1) - 9 * 3600_000);
  return { start: at(y, m), end: at(y, m + 1) };
}
