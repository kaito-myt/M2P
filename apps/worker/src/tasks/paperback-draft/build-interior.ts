/**
 * ペーパーバック用の**本文 PDF** を組む (F-097j)。
 *
 * Kindle 用の PDF をそのまま入稿すると、KDP のプレビューが
 *   「内側マージンが不十分です。152 ページの本では、0.5" (12.700mm) 以上の内側マージンが
 *     必要です。ページの上下には 6.35 mm (0.25 インチ) 以上の外側マージンが必要です」
 * というエラーを出し、**承認ボタンが無効のまま**になる (2026-09-30 実測)。
 * Kindle 用は左右 15mm だが、余白ぎりぎりの要素があるページで基準を割る。
 *
 * そこでペーパーバック用は左右 20mm で組み直し、R2 `books/{id}/paperback/interior.pdf`
 * にキャッシュする。頁数は変わるので、表紙の背幅は**この PDF の頁数**ではなく
 * KDP が数えた頁数で作り直すこと (`build-cover.ts` 参照)。
 */
import { buildPdf } from '@a2p/output-pdf';

/** KDP が 151〜300 頁で要求する内側余白は 12.7mm。余裕を見て 20mm で組む。 */
export const PAPERBACK_SIDE_MARGIN_MM = 20;

export interface BuildPaperbackInteriorArgs {
  bookId: string;
  title: string;
  subtitle?: string | null;
  chapters: Array<{ index: number; heading: string; body_md: string }>;
  fetchAsset: (key: string) => Promise<Buffer | null>;
  putAsset: (key: string, buf: Buffer, contentType: string) => Promise<unknown>;
  /** true ならキャッシュを使わず組み直す。 */
  force?: boolean;
}

export function paperbackInteriorKey(bookId: string): string {
  return `books/${bookId}/paperback/interior.pdf`;
}

export type BuildPaperbackInteriorResult =
  | { ok: true; pdf: Buffer; key: string; rebuilt: boolean }
  | { ok: false; reason: 'no_chapters'; message: string };

export async function ensurePaperbackInterior(
  args: BuildPaperbackInteriorArgs,
): Promise<BuildPaperbackInteriorResult> {
  const key = paperbackInteriorKey(args.bookId);
  if (!args.force) {
    const cached = await args.fetchAsset(key);
    if (cached) return { ok: true, pdf: cached, key, rebuilt: false };
  }

  const chapters = [...args.chapters].sort((a, b) => a.index - b.index);
  if (chapters.length === 0) {
    return { ok: false, reason: 'no_chapters', message: '章が 1 つもないので本文を組めません' };
  }

  const pdf = await buildPdf({ title: args.title, subtitle: args.subtitle ?? null }, chapters, {
    sideMarginMm: PAPERBACK_SIDE_MARGIN_MM,
  });
  await args.putAsset(key, pdf, 'application/pdf');
  return { ok: true, pdf, key, rebuilt: true };
}
