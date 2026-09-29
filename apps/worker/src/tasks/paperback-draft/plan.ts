/**
 * ペーパーバック化の可否判定 (F-097f)。
 *
 * ローカル専用だった `scripts/paperback/pb-plan.cjs` の**1 冊分の判定ロジック**を
 * サーバー側へ移植した純関数（運営者指示 2026-09-29「基本すべての作業をサーバー側で」）。
 * R2 からの取得や DB 参照は呼び出し側に任せ、ここは数字の判定だけを持つ。
 *
 * KDP (白黒・白紙・A5) の実測仕様:
 *   - 受け付ける頁数は 24〜828 頁。
 *   - 背幅 = 頁数 × 0.0572mm。
 *   - ノド(内側)余白の下限は頁数で変わる。現行の本文 PDF は左右 15mm 固定なので、
 *     300 頁を超えると 15.9mm が必要になり不足する = ペーパーバックにできない。
 */
export const PB_MIN_PAGES = 24;
export const PB_MAX_PAGES = 828;
export const SPINE_MM_PER_PAGE = 0.0572;
/** 本文 PDF の左右余白 (mm)。`packages/output/pdf` の組版と揃える。 */
export const INTERIOR_SIDE_MARGIN_MM = 15;

/** 頁数ごとに必要なノド余白 (mm)。 */
export function gutterRequiredMm(pages: number): number {
  if (pages <= 150) return 9.6;
  if (pages <= 300) return 12.7;
  if (pages <= 500) return 15.9;
  if (pages <= 700) return 19.1;
  return 22.3;
}

export interface PaperbackPlan {
  pages: number;
  spineMm: number;
  gutterRequiredMm: number;
  gutterOk: boolean;
  rangeOk: boolean;
  /** 下書きを作ってよいか。 */
  ready: boolean;
  /** ready=false の理由 (運用ログ/DB に残す)。 */
  reason: string | null;
}

export function computePaperbackPlan(pages: number, sideMarginMm = INTERIOR_SIDE_MARGIN_MM): PaperbackPlan {
  const required = gutterRequiredMm(pages);
  const gutterOk = sideMarginMm >= required;
  const rangeOk = pages >= PB_MIN_PAGES && pages <= PB_MAX_PAGES;
  const reason = !rangeOk
    ? `頁数レンジ外 (${String(pages)}頁: ${String(PB_MIN_PAGES)}〜${String(PB_MAX_PAGES)}頁)`
    : !gutterOk
      ? `ノド余白NG (${String(pages)}頁は${String(required)}mm必要・現行${String(sideMarginMm)}mm)`
      : null;
  return {
    pages,
    spineMm: Number((pages * SPINE_MM_PER_PAGE).toFixed(3)),
    gutterRequiredMm: required,
    gutterOk,
    rangeOk,
    ready: rangeOk && gutterOk,
    reason,
  };
}

/** PDF のバイト列から総頁数を数える (pdf-lib)。 */
export async function countPdfPages(pdf: Buffer): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  return doc.getPageCount();
}
