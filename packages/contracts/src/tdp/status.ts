/** 3DP 商品の状態機械 (docs/12 §9.5 / §17.3)。この表以外の遷移は拒否する。 */

export const PRODUCT_STATUSES = [
  'planned',
  'generating',
  'inspecting',
  'needs_fix',
  'ready',
  'review',
  'approved',
  'listed',
  'withdrawn',
  'failed',
  'rejected',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const TERMINAL_STATUSES = ['failed', 'rejected', 'withdrawn'] as const satisfies readonly ProductStatus[];

/** T-1/T-2 の (新規) 起点は行が無いので辺に含めない。 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ProductStatus, readonly ProductStatus[]>> = {
  planned: ['generating', 'rejected'], // T-3, T-2b
  generating: ['inspecting', 'failed', 'rejected'], // T-4, T-8, T-2b (review 差戻し後 = generating)
  inspecting: ['generating', 'needs_fix', 'ready', 'failed'], // T-5, T-6, T-9, T-8
  needs_fix: ['generating', 'failed', 'rejected'], // T-7, T-8, T-2b
  ready: ['review'], // T-10
  review: ['approved', 'generating', 'ready', 'rejected'], // T-11, T-12, T-13, T-14
  approved: ['listed'], // T-15
  listed: ['withdrawn'], // T-16
  withdrawn: [],
  failed: [],
  rejected: [],
};

export function canTransition(from: ProductStatus, to: ProductStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
