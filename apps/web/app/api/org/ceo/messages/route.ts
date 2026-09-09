/**
 * GET /api/org/ceo/messages — CEO ⇔ 運営者 の対話ログ（新しい順に最大50件→時系列で返す）。
 *
 * CEO チャット UI が送信後にポーリングして、worker が生成した CEO 応答を反映する。
 * 認証必須。
 */
import { NextResponse } from 'next/server';

import { prisma } from '@a2p/db';
import { AuthError } from '@a2p/contracts';

import { getSessionOrThrow } from '@/lib/auth-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<Response> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (err instanceof AuthError) return new NextResponse('Unauthorized', { status: 401 });
    throw err;
  }

  const rows = await prisma.orgCeoMessage.findMany({
    orderBy: { created_at: 'desc' },
    take: 50,
    select: { id: true, role: true, content: true, status: true, created_at: true },
  });

  const messages = rows
    .reverse()
    .map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      status: r.status,
      created_at: r.created_at.toISOString(),
    }));

  // pending/processing の operator メッセージがあれば「CEO 応答待ち」を UI に伝える。
  const awaitingReply = rows.some((r) => r.role === 'operator' && (r.status === 'pending' || r.status === 'processing'));

  return NextResponse.json({ messages, awaiting_reply: awaitingReply });
}
