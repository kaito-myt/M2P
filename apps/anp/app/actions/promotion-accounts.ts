'use server';

/**
 * F-ANP-33 — note アカウントごとの販促 SNS アカウント連携 Server Actions (docs/11-anp-design.md §3.4)。
 * 台帳は A2P と共有の `promotion_accounts` (note_account_id で紐付け)。X は OAuth 1.0a 4 項目を暗号化保存、
 * Instagram / TikTok は Zernio の接続アカウント id を保存する。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { buildXAuthHeader, decryptApiKey, encryptApiKey, maskApiKey, parseXCredentials, serializeXOAuth1 } from '@a2p/crypto';
import { Prisma, prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import { loadLinkedPromotionAccount, type LinkedPromotionAccountView } from '@/lib/promotion-accounts-core';
import { listZernioAccounts, type ZernioAccountView } from '@/lib/zernio';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const m = messages.promotion.link;

const LinkXSchema = z.object({
  note_account_id: z.string().min(1),
  channel: z.literal('x'),
  handle: z.string().trim().max(64),
  api_key: z.string().trim().max(200),
  api_secret: z.string().trim().max(200),
  access_token: z.string().trim().max(200),
  access_token_secret: z.string().trim().max(200),
});
const LinkZernioSchema = z.object({
  note_account_id: z.string().min(1),
  channel: z.enum(['instagram', 'tiktok']),
  handle: z.string().trim().max(64),
  zernio_account_id: z.string().trim().min(1).max(100),
});
const LinkSchema = z.discriminatedUnion('channel', [LinkXSchema, LinkZernioSchema]);

async function requireUser(): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

async function findRow(noteAccountId: string, channel: string) {
  return prisma.promotionAccount.findFirst({
    where: { note_account_id: noteAccountId, channel, status: { in: ['pending', 'connected'] } },
    orderBy: { updated_at: 'desc' },
    select: { id: true, token_enc: true, config_json: true, handle: true },
  });
}

/** 連携を保存する (行が無ければ作成)。X は 4 項目すべて空なら資格情報は変更しない (handle だけ更新)。 */
export async function linkPromotionAccount(input: unknown): Promise<ActionResult<LinkedPromotionAccountView>> {
  const userId = await requireUser();
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = LinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? m.errors.invalid };
  const data = parsed.data;
  try {
    const account = await prisma.noteAccount.findUnique({ where: { id: data.note_account_id }, select: { id: true, niche: true, target_reader: true, display_name: true } });
    if (!account) return { ok: false, error: messages.accounts.errors.notFound };
    const existing = await findRow(data.note_account_id, data.channel);
    const baseConfig = (existing?.config_json && typeof existing.config_json === 'object' ? (existing.config_json as Record<string, unknown>) : {}) ?? {};

    let token_enc: string | null | undefined;
    let token_mask: string | null | undefined;
    let config: Record<string, unknown> = { ...baseConfig, source: 'anp' };
    if (data.channel === 'x') {
      const parts = [data.api_key, data.api_secret, data.access_token, data.access_token_secret];
      const filled = parts.filter((p) => p.length > 0).length;
      if (filled > 0 && filled < 4) return { ok: false, error: m.errors.xAllFour };
      if (filled === 4) {
        const serialized = serializeXOAuth1({ apiKey: data.api_key, apiSecret: data.api_secret, accessToken: data.access_token, accessTokenSecret: data.access_token_secret });
        token_enc = encryptApiKey(serialized);
        token_mask = `oauth1 ${maskApiKey(data.access_token)}`;
      } else if (!existing?.token_enc) {
        return { ok: false, error: m.errors.xAllFour };
      }
    } else {
      config = { ...config, zernio_account_id: data.zernio_account_id };
    }
    delete config.last_test;
    const handle = data.handle.replace(/^@/, '') || existing?.handle || null;
    const connected = data.channel === 'x' ? Boolean(token_enc ?? existing?.token_enc) : true;

    const row = existing
      ? await prisma.promotionAccount.update({
          where: { id: existing.id },
          data: {
            handle,
            status: connected ? 'connected' : 'pending',
            ...(token_enc !== undefined ? { token_enc, token_mask } : {}),
            config_json: config as Prisma.InputJsonValue,
          },
          select: { id: true },
        })
      : await prisma.promotionAccount.create({
          data: {
            channel: data.channel,
            handle,
            niche: account.niche,
            target_reader: account.target_reader,
            status: connected ? 'connected' : 'pending',
            token_enc: token_enc ?? null,
            token_mask: token_mask ?? null,
            config_json: config as Prisma.InputJsonValue,
            note_account_id: account.id,
          },
          select: { id: true },
        });
    await prisma.auditLog.create({
      data: {
        actor_id: userId,
        action: 'promotion.account.connect',
        target_kind: 'promotion_account',
        target_id: row.id,
        after_json: { channel: data.channel, handle, connected, note_account_id: account.id, token_updated: token_enc !== undefined, source: 'anp' },
      },
    });
    revalidatePath('/promotion');
    return { ok: true, data: await loadLinkedPromotionAccount(data.note_account_id, data.channel) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.errors.saveFailed };
  }
}

const UnlinkSchema = z.object({ note_account_id: z.string().min(1), channel: z.enum(['x', 'instagram', 'tiktok']) });

/** 連携を解除する (台帳行は archived、以後は channel 既定に投稿)。 */
export async function unlinkPromotionAccount(input: unknown): Promise<ActionResult<LinkedPromotionAccountView>> {
  const userId = await requireUser();
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = UnlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.invalid };
  const { note_account_id, channel } = parsed.data;
  try {
    const existing = await findRow(note_account_id, channel);
    if (!existing) return { ok: false, error: m.errors.notLinked };
    await prisma.promotionAccount.update({ where: { id: existing.id }, data: { status: 'archived' } });
    await prisma.auditLog.create({
      data: { actor_id: userId, action: 'promotion.account.archive', target_kind: 'promotion_account', target_id: existing.id, after_json: { channel, note_account_id, source: 'anp' } },
    });
    revalidatePath('/promotion');
    return { ok: true, data: await loadLinkedPromotionAccount(note_account_id, channel) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.errors.saveFailed };
  }
}

/** 疎通テスト: X は GET /2/users/me (OAuth1)、Instagram/TikTok は Zernio に該当アカウントがあり再接続不要か。 */
export async function testPromotionAccount(input: unknown): Promise<ActionResult<LinkedPromotionAccountView>> {
  const userId = await requireUser();
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = UnlinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.invalid };
  const { note_account_id, channel } = parsed.data;
  try {
    const existing = await findRow(note_account_id, channel);
    if (!existing) return { ok: false, error: m.errors.notLinked };
    let result: { ok: boolean; message: string };
    const started = Date.now();
    if (channel === 'x') {
      const creds = existing.token_enc ? parseXCredentials(decryptApiKey(existing.token_enc)) : null;
      if (!creds) result = { ok: false, message: m.test.noCredentials };
      else {
        const url = 'https://api.twitter.com/2/users/me';
        const res = await fetch(url, { headers: { authorization: buildXAuthHeader('GET', url, creds) }, signal: AbortSignal.timeout(15_000) });
        const json = (await res.json().catch(() => ({}))) as { data?: { username?: string; name?: string }; detail?: string; title?: string };
        result = res.ok
          ? { ok: true, message: m.test.xOk(json.data?.username ?? existing.handle ?? '?', Date.now() - started) }
          : { ok: false, message: `HTTP ${res.status} ${json.detail ?? json.title ?? ''}`.trim() };
      }
    } else {
      const cfg = (existing.config_json ?? {}) as { zernio_account_id?: unknown };
      const wanted = typeof cfg.zernio_account_id === 'string' ? cfg.zernio_account_id : '';
      if (!wanted) result = { ok: false, message: m.test.noCredentials };
      else {
        const accounts = await listZernioAccounts(channel);
        const hit = accounts.find((a) => a.id === wanted);
        result = !hit
          ? { ok: false, message: m.test.zernioMissing(wanted) }
          : hit.needsReconnection
            ? { ok: false, message: m.test.zernioReconnect(hit.label) }
            : { ok: true, message: m.test.zernioOk(hit.label) };
      }
    }
    const config = { ...((existing.config_json as Record<string, unknown> | null) ?? {}), last_test: { ...result, at: new Date().toISOString() } };
    await prisma.promotionAccount.update({ where: { id: existing.id }, data: { config_json: config as Prisma.InputJsonValue } });
    revalidatePath('/promotion');
    return { ok: true, data: await loadLinkedPromotionAccount(note_account_id, channel) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.errors.testFailed };
  }
}

/** Zernio の接続アカウント一覧 (Instagram / TikTok の選択肢)。未設定なら空。 */
export async function getZernioAccounts(input: unknown): Promise<ActionResult<{ configured: boolean; accounts: ZernioAccountView[] }>> {
  const userId = await requireUser();
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = z.object({ channel: z.enum(['instagram', 'tiktok']) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.invalid };
  const configured = typeof process.env.ZERNIO_API_KEY === 'string' && process.env.ZERNIO_API_KEY.length > 0;
  if (!configured) return { ok: true, data: { configured: false, accounts: [] } };
  try {
    return { ok: true, data: { configured: true, accounts: await listZernioAccounts(parsed.data.channel) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.errors.zernioFetchFailed };
  }
}
