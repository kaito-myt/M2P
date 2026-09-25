/**
 * ペーパーバックの定価計算 (KDP 日本, A5・白黒・白紙)。
 *
 * `scripts/paperback/pb-price.mjs` と同じ式をサーバー側に移植したもの (F-097d)。
 * KDP JP の印刷コスト = 固定 206 円 + 頁数 × 2.06 円。ロイヤリティ 60% なので
 * 手取り = 定価 × 0.6 − 印刷コスト。定価 × 0.6 が印刷コストを下回る価格は出品できない。
 *
 * 方針 (2026-09-11 運営者指示): 基準価格 ¥980。ただし薄利・赤字を避けるため
 * 「手取りが MIN_ROYALTY_JPY 以上残る価格」を下限として高い方を採用し、10 円単位に切り上げる。
 */

/** 基準価格。これ未満にはしない。 */
export const BASE_PRICE_JPY = 980;
/** 1 冊あたり最低限確保する手取り(円)。 */
export const MIN_ROYALTY_JPY = 150;

const PRINT_FIXED_JPY = 206;
const PRINT_PER_PAGE_JPY = 2.06;
const ROYALTY_RATE = 0.6;

/** 頁数から印刷コスト(円)。 */
export function printCost(pages: number): number {
  return PRINT_FIXED_JPY + pages * PRINT_PER_PAGE_JPY;
}

/** 指定定価での手取り(円)。 */
export function royalty(pages: number, price: number): number {
  return price * ROYALTY_RATE - printCost(pages);
}

/** 採用定価(円, 10 円単位)。 */
export function paperbackPrice(pages: number): number {
  const needed = (printCost(pages) + MIN_ROYALTY_JPY) / ROYALTY_RATE;
  return Math.max(BASE_PRICE_JPY, Math.ceil(needed / 10) * 10);
}

/** ログ用の要約。 */
export function priceSummary(pages: number): string {
  const price = paperbackPrice(pages);
  return `頁数=${pages} 印刷費=¥${Math.round(printCost(pages))} → 定価=¥${price} (手取り¥${Math.round(royalty(pages, price))})`;
}
