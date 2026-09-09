/**
 * GET /api/books/[id]/thumbnail — 書籍の採用カバー画像を署名付き URL へリダイレクト。
 *
 * 売上・KPI テーブル (S-017) のサムネ列など、book_id しか手元に無い箇所から
 * `<img src="/api/books/{id}/thumbnail">` で参照する。
 *
 * - 採用カバー (covers.status = 'adopted') の最新 1 件の r2_key を解決
 * - getSignedDownloadUrl で 15 分有効の署名付き URL を生成し 302 リダイレクト
 * - 認証必須 (ブラウザの <img> リクエストは Cookie を伴い middleware を通過する)
 *
 * 注意: /api/covers/[id]/image は cover_id 起点。こちらは book_id 起点で
 * 採用カバーを解決する薄いラッパ。next/image 最適化経由は Cookie を持たず
 * middleware に弾かれるため素の <img> で参照すること。
 */
import { NextResponse } from 'next/server';

import { prisma } from '@a2p/db';
import { AuthError } from '@a2p/contracts';
import { getSignedDownloadUrl } from '@a2p/storage';

import { getSessionOrThrow } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (err instanceof AuthError) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    throw err;
  }

  const { id } = await params;

  const cover = await prisma.cover.findFirst({
    where: { book_id: id, status: 'adopted' },
    orderBy: { created_at: 'desc' },
    select: { r2_key: true },
  });

  if (!cover) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const signedUrl = await getSignedDownloadUrl(cover.r2_key, 900);

  return NextResponse.redirect(signedUrl, 302);
}
