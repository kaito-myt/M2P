/**
 * GET /api/cost/current -- CostMeter 用ポーリングエンドポイント (T-07-06).
 *
 * Header の CostMeter コンポーネントが 30 秒ごとにポーリングする。
 * 返却: { monthly_cost_jpy, budget_jpy, ratio, level, remaining, warn_count, paused_count }
 *
 * Phase 1 では SSE ではなく polling を採用 (CommentBadgeHeader と同じパターン)。
 */
import { NextResponse } from 'next/server';

import { prisma } from '@a2p/db';
import { AuthError } from '@a2p/contracts';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { getCostMeterData } from '@/lib/cost-meter-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(): Promise<Response> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (err instanceof AuthError) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    throw err;
  }

  // docs/05 §3.3 — A2P の画面のメーターなので A2P の活動分だけ。
  // 全ツール合算 (予算の赤ライン判定) はポータル側で見る。
  const data = await getCostMeterData(prisma, { tool: 'a2p' });

  return NextResponse.json(data);
}
