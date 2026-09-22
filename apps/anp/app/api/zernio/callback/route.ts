/**
 * GET /api/zernio/callback — Zernio の OAuth 接続完了の戻り先 (F-ANP-33c)。
 *
 * `startZernioConnect` が redirect_url に `note_account_id` / `channel` を載せ、Zernio が認可後に
 * `connected=<platform>&profileId=&accountId=&username=` を追加して戻す (docs.zernio.com/guides/connecting-accounts)。
 * ログイン中の運営者のブラウザで戻ってくる前提 (middleware で未ログインなら /login へ)。
 * 台帳 `promotion_accounts` (note_account_id, channel) を Zernio 接続として upsert し、/promotion へ戻す。
 */
import { NextResponse } from 'next/server';

import { Prisma, prisma } from '@a2p/db';

import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHANNELS = new Set(['x', 'instagram', 'tiktok']);

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const noteAccountId = url.searchParams.get('note_account_id') ?? '';
  const channel = url.searchParams.get('channel') ?? '';
  const accountId = url.searchParams.get('accountId') ?? '';
  const username = (url.searchParams.get('username') ?? '').replace(/^@/, '');
  const error = url.searchParams.get('error') ?? url.searchParams.get('error_description') ?? '';

  const back = new URL('/promotion', url.origin);
  if (noteAccountId) back.searchParams.set('account', noteAccountId);
  if (channel && channel !== 'x') back.searchParams.set('channel', channel);

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL('/login', url.origin);
    login.searchParams.set('callbackUrl', url.pathname + url.search);
    return NextResponse.redirect(login);
  }

  if (!noteAccountId || !CHANNELS.has(channel)) {
    back.searchParams.set('link_error', 'invalid_callback');
    return NextResponse.redirect(back);
  }
  if (error || !accountId) {
    back.searchParams.set('link_error', error || 'no_account_id');
    return NextResponse.redirect(back);
  }

  try {
    const account = await prisma.noteAccount.findUnique({ where: { id: noteAccountId }, select: { id: true, niche: true, target_reader: true } });
    if (!account) {
      back.searchParams.set('link_error', 'account_not_found');
      return NextResponse.redirect(back);
    }
    const existing = await prisma.promotionAccount.findFirst({
      where: { note_account_id: noteAccountId, channel, status: { in: ['pending', 'connected'] } },
      orderBy: { updated_at: 'desc' },
      select: { id: true, config_json: true, handle: true },
    });
    const baseConfig = (existing?.config_json && typeof existing.config_json === 'object' ? (existing.config_json as Record<string, unknown>) : {}) ?? {};
    const config: Record<string, unknown> = { ...baseConfig, source: 'anp', zernio_account_id: accountId, zernio_profile_id: url.searchParams.get('profileId') ?? null };
    delete config.last_test;
    const handle = username || existing?.handle || null;
    const row = existing
      ? await prisma.promotionAccount.update({ where: { id: existing.id }, data: { handle, status: 'connected', config_json: config as Prisma.InputJsonValue }, select: { id: true } })
      : await prisma.promotionAccount.create({
          data: { channel, handle, niche: account.niche, target_reader: account.target_reader, status: 'connected', config_json: config as Prisma.InputJsonValue, note_account_id: account.id },
          select: { id: true },
        });
    await prisma.auditLog.create({
      data: {
        actor_id: session.user.id,
        action: 'promotion.account.connect',
        target_kind: 'promotion_account',
        target_id: row.id,
        after_json: { channel, handle, connected: true, note_account_id: account.id, via: 'zernio_oauth', zernio_account_id: accountId },
      },
    });
    back.searchParams.set('linked', channel);
    if (handle) back.searchParams.set('linked_handle', handle);
    return NextResponse.redirect(back);
  } catch (err) {
    back.searchParams.set('link_error', err instanceof Error ? err.message.slice(0, 120) : 'unknown');
    return NextResponse.redirect(back);
  }
}
