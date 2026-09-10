/**
 * ペーパーバックの定価算出（KDP 日本, A5・白黒・白紙）。
 *
 * KDP JP の印刷コスト = 固定 206 円 + 頁数 × 2.06 円。ロイヤリティは 60% なので
 * 手取り = 定価 × 0.6 − 印刷コスト。定価 × 0.6 が印刷コストを下回る価格は出品できない。
 *
 * 方針 (2026-09-11 運営者指示):
 *   基準価格を **¥980** に引き下げる。ただし薄利・赤字を避けるため
 *   「手取りが MIN_ROYALTY_JPY 以上残る価格」を下限として、高い方を採用する。
 *   → 薄い本は ¥980、厚い本は必要なだけ上がる。10 円単位に切り上げ。
 *
 * 旧方針は一律 ¥1,480 下限だった (docs/05 §5.3.15b)。
 */

/** 基準価格。これ未満にはしない。 */
export const BASE_PRICE_JPY = 980;
/** 1 冊あたり最低限確保する手取り(円)。 */
export const MIN_ROYALTY_JPY = 150;
/** KDP JP の印刷コスト係数。 */
const PRINT_FIXED_JPY = 206;
const PRINT_PER_PAGE_JPY = 2.06;
const ROYALTY_RATE = 0.6;

/** 頁数から印刷コスト(円)を返す。 */
export function printCost(pages) {
  return PRINT_FIXED_JPY + pages * PRINT_PER_PAGE_JPY;
}

/** 出品可能な最低定価(円, 端数はそのまま)。これを下回ると KDP が受け付けない。 */
export function minListPrice(pages) {
  return printCost(pages) / ROYALTY_RATE;
}

/** 指定定価での手取り(円)。 */
export function royalty(pages, price) {
  return price * ROYALTY_RATE - printCost(pages);
}

/**
 * 採用定価(円, 10 円単位)。
 * max(基準価格, 手取り MIN_ROYALTY_JPY を確保できる価格) を 10 円単位に切り上げる。
 */
export function paperbackPrice(pages) {
  const needed = (printCost(pages) + MIN_ROYALTY_JPY) / ROYALTY_RATE;
  return Math.max(BASE_PRICE_JPY, Math.ceil(needed / 10) * 10);
}

/** ログ用の 1 行サマリ。 */
export function priceSummary(pages) {
  const pr = paperbackPrice(pages);
  return `頁数=${pages} 印刷費=¥${Math.round(printCost(pages))} 最低定価=¥${Math.round(minListPrice(pages))} → 定価=¥${pr} (手取り¥${Math.round(royalty(pages, pr))})`;
}
