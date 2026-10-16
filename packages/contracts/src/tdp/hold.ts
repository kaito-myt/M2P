/** 3DP R-1 の枠計算 (docs/12 §17.10.4 / D-2)。 */
import { TDP_MONTHLY_LIMIT_HARD_MAX } from './settings';

export interface TdpSlots {
  limit: number;
  published: number;
  reserved: number;
  used: number;
  remaining: number;
  allowed: boolean;
}

/** R-1 の枠 (docs/12 §17.10.4)。limit は天井 TDP_MONTHLY_LIMIT_HARD_MAX で切る。 */
export function computeSlots(a: {
  limit: number;
  publishedThisMonth: number;
  activeReservations: number;
}): TdpSlots {
  const limit = Math.min(a.limit, TDP_MONTHLY_LIMIT_HARD_MAX);
  const used = a.publishedThisMonth + a.activeReservations;
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    published: a.publishedThisMonth,
    reserved: a.activeReservations,
    used,
    remaining,
    allowed: remaining > 0,
  };
}
