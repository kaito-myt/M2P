import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';

/**
 * `recurring.cost.refresh` タスク (F-085, 2026-08-20) — 固定/従量原価の最新化。
 *
 * token_usage(AI従量)に載らないサブスク/インフラ原価(recurring_costs)を最新の実態に更新する:
 *   - auto_source='fx'   : USD建て(amount_usd)を **最新FX**(app_settings.latest_fx_rate)で円換算し直す。
 *   - auto_source='x_usage': X API は従量課金(2026: $0.015/write, $0.005/read)なので、**実使用量**
 *                            (当月のX投稿数＋フォロー/いいね数＋検索回数)から月額を推定して更新する。
 *   - auto_source=null   : 手動固定（変更しない）。
 * 合計が前回から一定以上変わったら LINE 通知。月次 cron。
 */

export const RECURRING_COST_REFRESH_TASK_NAME = 'recurring.cost.refresh';

/** X API 従量単価(USD, 2026)。write=投稿作成/フォロー/いいね, read=検索等で取得したポスト。 */
export const X_WRITE_USD = 0.015;
export const X_READ_USD = 0.005;
/** X能動エンゲージの検索は1日3回・1回あたり最大25件取得(promotion.x.engage の設定に一致)。 */
const X_SEARCHES_PER_DAY = 3;
const X_RESULTS_PER_SEARCH = 25;

const D = 86400_000;

export const RecurringCostRefreshPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  trigger: z.string().optional(),
});

/** X API の月額(USD)を実使用量から推定(月初からの実績を当月フル月に外挿)。 */
export function estimateXMonthlyUsd(input: {
  writesToDate: number;
  daysElapsed: number;
  daysInMonth: number;
}): number {
  const elapsed = Math.max(1, input.daysElapsed);
  const readsToDate = elapsed * X_SEARCHES_PER_DAY * X_RESULTS_PER_SEARCH;
  const usdToDate = input.writesToDate * X_WRITE_USD + readsToDate * X_READ_USD;
  const perDay = usdToDate / elapsed;
  return perDay * input.daysInMonth;
}

export interface RecurringCostRow {
  id: string;
  label: string;
  monthly_jpy: number;
  currency: string;
  amount_usd: number | null;
  auto_source: string | null;
  active: boolean;
}

export interface RecurringCostRefreshPrisma {
  appSettings: { findUnique: (args: unknown) => Promise<{ latest_fx_rate: unknown } | null> };
  recurringCost: {
    findMany: (args: unknown) => Promise<RecurringCostRow[]>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  promotionPost: { count: (args: unknown) => Promise<number> };
  promotionXEngagement: { count: (args: unknown) => Promise<number> };
  job?: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
}

export interface RecurringCostRefreshDeps {
  prisma?: RecurringCostRefreshPrisma;
  logger?: Logger;
  now?: () => Date;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface RecurringCostRefreshResult {
  fx_rate: number;
  updated: Array<{ label: string; from: number; to: number }>;
  total_before: number;
  total_after: number;
}

export async function runRecurringCostRefresh(
  payload: unknown,
  deps: RecurringCostRefreshDeps = {},
): Promise<RecurringCostRefreshResult> {
  const log = deps.logger ?? createLogger(`worker.${RECURRING_COST_REFRESH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as RecurringCostRefreshPrisma);
  const now = deps.now ?? (() => new Date());
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const parsed = RecurringCostRefreshPayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;

  const nowTs = now();
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { latest_fx_rate: true } });
  const fx = Number(settings?.latest_fx_rate ?? 150) || 150;

  const monthStart = new Date(Date.UTC(nowTs.getUTCFullYear(), nowTs.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(nowTs.getUTCFullYear(), nowTs.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextMonth.getTime() - monthStart.getTime()) / D);
  const daysElapsed = Math.max(1, Math.ceil((nowTs.getTime() - monthStart.getTime()) / D));

  const rows = await prisma.recurringCost.findMany({
    where: { active: true },
    select: { id: true, label: true, monthly_jpy: true, currency: true, amount_usd: true, auto_source: true, active: true },
  });

  const totalBefore = rows.reduce((a, r) => a + (r.monthly_jpy ?? 0), 0);
  const updated: Array<{ label: string; from: number; to: number }> = [];

  for (const r of rows) {
    let next: number | null = null;
    if (r.auto_source === 'fx' && r.amount_usd != null) {
      next = Math.round(Number(r.amount_usd) * fx);
    } else if (r.auto_source === 'x_usage') {
      // 当月の X 書き込み数 = X投稿(posted) + フォロー/いいね実行。
      const [xPosts, xEngage] = await Promise.all([
        prisma.promotionPost.count({ where: { channel: 'x', status: 'posted', posted_at: { gte: monthStart } } }),
        prisma.promotionXEngagement.count({ where: { status: { in: ['done'] }, created_at: { gte: monthStart } } }),
      ]);
      const usd = estimateXMonthlyUsd({ writesToDate: xPosts + xEngage, daysElapsed, daysInMonth });
      next = Math.round(usd * fx);
    }
    if (next != null && next !== r.monthly_jpy) {
      await prisma.recurringCost.update({ where: { id: r.id }, data: { monthly_jpy: next, updated_at: nowTs } }).catch(() => {});
      updated.push({ label: r.label, from: r.monthly_jpy ?? 0, to: next });
    }
  }

  const totalAfter = rows.reduce((a, r) => {
    const u = updated.find((x) => x.label === r.label);
    return a + (u ? u.to : r.monthly_jpy ?? 0);
  }, 0);

  const result: RecurringCostRefreshResult = { fx_rate: fx, updated, total_before: totalBefore, total_after: totalAfter };

  // 合計が 10% 以上動いたら通知。
  if (lineConfigured() && totalBefore > 0 && Math.abs(totalAfter - totalBefore) / totalBefore >= 0.1) {
    await pushAlert(
      [
        '💴 固定費の見直し（自動）',
        `合計固定費: ¥${totalBefore.toLocaleString('ja-JP')} → ¥${totalAfter.toLocaleString('ja-JP')}/月（FX ${fx.toFixed(1)}）`,
        ...updated.map((u) => `・${u.label}: ¥${u.from.toLocaleString('ja-JP')} → ¥${u.to.toLocaleString('ja-JP')}`),
      ].join('\n'),
    ).catch(() => false);
  }

  if (jobId && prisma.job) {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: result } }).catch(() => {});
  }
  log.info({ task: RECURRING_COST_REFRESH_TASK_NAME, ...result }, 'recurring.cost.refresh done');
  return result;
}

export const recurringCostRefreshTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runRecurringCostRefresh(payload);
};
