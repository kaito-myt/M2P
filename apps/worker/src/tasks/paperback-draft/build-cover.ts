/**
 * ペーパーバックのラップカバー PDF を用意する (F-097f/g)。
 *
 * 下書き作成 (`paperback.draft`) と出版 (`paperback.submit`) の両方から使う。
 * 出版側でも要るのは、**古いローカル実行で作られた下書きには Kindle 用の表紙 (A4 縦) が
 * 上がっていることがある**ため (2026-09-29 に KDP のプレビューが
 * 「適切な表紙のサイズは 12.000x8.520 ですが、提出されたファイル サイズは 8.264x11.694」
 * と出しているのを実測。これで承認ボタンが無効になり `not_approved` になっていた)。
 *
 * R2 `books/{id}/paperback/cover.pdf` にキャッシュする。ページ数が変われば背幅が変わるので、
 * `force` でキャッシュを無視して作り直せる。
 */
import { buildPaperbackWrapCover, safeAreaPixels } from '@a2p/output-pdf';

export interface EnsurePaperbackCoverArgs {
  bookId: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  /** 本文の総頁数 (背幅の計算に使う)。 */
  pages: number;
  /** Kindle 用表紙画像の R2 キー (`covers.status='adopted'` の最新)。 */
  coverImageKey: string;
  fetchAsset: (key: string) => Promise<Buffer | null>;
  putAsset: (key: string, buf: Buffer, contentType: string) => Promise<unknown>;
  /** true ならキャッシュを使わず作り直す。 */
  force?: boolean;
}

export function paperbackCoverKey(bookId: string): string {
  return `books/${bookId}/paperback/cover.pdf`;
}

export type EnsurePaperbackCoverResult =
  | { ok: true; pdf: Buffer; key: string; rebuilt: boolean }
  | { ok: false; reason: 'no_cover_image'; message: string };

export async function ensurePaperbackCover(
  args: EnsurePaperbackCoverArgs,
): Promise<EnsurePaperbackCoverResult> {
  const key = paperbackCoverKey(args.bookId);
  if (!args.force) {
    const cached = await args.fetchAsset(key);
    if (cached) return { ok: true, pdf: cached, key, rebuilt: false };
  }

  const coverImage = await args.fetchAsset(args.coverImageKey);
  if (!coverImage) {
    return { ok: false, reason: 'no_cover_image', message: `表紙画像が R2 にありません (${args.coverImageKey})` };
  }

  const sharp = (await import('sharp')).default;
  const stats = await sharp(coverImage).stats();
  const [r, g, b] = stats.channels.map((ch) => Math.round(ch.mean));
  const safe = safeAreaPixels();
  const frontImagePng = await sharp(coverImage)
    .resize(safe.width, safe.height, { fit: 'contain', kernel: 'lanczos3', background: { r: r!, g: g!, b: b! } })
    .png()
    .toBuffer();

  const pdf = await buildPaperbackWrapCover({
    title: args.title,
    subtitle: args.subtitle ?? null,
    description: args.description ?? null,
    pages: args.pages,
    coverImage,
    frontImagePng,
    averageColor: { r: r!, g: g!, b: b! },
  });
  await args.putAsset(key, pdf, 'application/pdf');
  return { ok: true, pdf, key, rebuilt: true };
}
