/**
 * 実行中ジョブ数を返す軽量エンドポイント（サイドバー下部の JobTicker が数秒間隔でポーリング）。
 * 認証は middleware が担当（同一オリジンの fetch は cookie を自動送出）。
 */
import { NextResponse } from 'next/server';
import { prisma } from '@a2p/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const running = await prisma.job.count({ where: { status: 'running' } });
  return NextResponse.json({ running });
}
