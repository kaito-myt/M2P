/**
 * F-ANP-33 — note アカウントごとの販促 SNS アカウント連携 (docs/11-anp-design.md §3.4)。
 *
 * 運営者要望 (2026-09-22)「販促施策で各媒体と連携する機能がないから実装して。note アカウントごとに販促を行う SNS
 * アカウントも違うはずだからそれも考慮して」。A2P の販促アカウント台帳 `promotion_accounts` に `note_account_id` を持たせ、
 * (note_account_id, channel) で 1 行 = そのアカウントの投稿先。worker `promotion.note.article` / `.video` が
 * status='connected' の行を `promotion_posts.account_id` に載せ、`promotion.post.publish` がその資格情報で投稿する。
 *   - X: OAuth 1.0a の 4 つ (API Key / API Secret / Access Token / Access Token Secret) を `serializeXOAuth1` → 暗号化保存
 *   - Instagram / TikTok: Zernio に接続済みのアカウントを選ぶ (`config_json.zernio_account_id`)
 *   - ブログ: 所有ブログは A2P 共通のため連携対象外
 * 未連携の媒体は従来どおり channel 既定 (A2P 共通ペルソナ) に投稿される。
 */
import { prisma } from '@a2p/db';

import type { NotePromotionChannel } from './promotion-view';

export interface LinkedPromotionAccountView {
  channel: NotePromotionChannel;
  /** 台帳行があるか (pending でも true)。 */
  exists: boolean;
  connected: boolean;
  handle: string | null;
  token_mask: string | null;
  zernio_account_id: string | null;
  last_test: { ok: boolean; message: string; at: string } | null;
  updated_at: string | null;
}

export function emptyLinkedView(channel: NotePromotionChannel): LinkedPromotionAccountView {
  return { channel, exists: false, connected: false, handle: null, token_mask: null, zernio_account_id: null, last_test: null, updated_at: null };
}

export async function loadLinkedPromotionAccount(noteAccountId: string, channel: NotePromotionChannel): Promise<LinkedPromotionAccountView> {
  const row = await prisma.promotionAccount.findFirst({
    where: { note_account_id: noteAccountId, channel, status: { in: ['pending', 'connected'] } },
    orderBy: { updated_at: 'desc' },
    select: { handle: true, status: true, token_mask: true, config_json: true, updated_at: true },
  });
  if (!row) return emptyLinkedView(channel);
  const cfg = (row.config_json ?? {}) as { zernio_account_id?: unknown; last_test?: { ok?: unknown; message?: unknown; at?: unknown } };
  const lt = cfg.last_test;
  return {
    channel,
    exists: true,
    connected: row.status === 'connected',
    handle: row.handle,
    token_mask: row.token_mask,
    zernio_account_id: typeof cfg.zernio_account_id === 'string' ? cfg.zernio_account_id : null,
    last_test: lt && typeof lt.ok === 'boolean' && typeof lt.message === 'string' ? { ok: lt.ok, message: lt.message, at: typeof lt.at === 'string' ? lt.at : '' } : null,
    updated_at: row.updated_at.toISOString(),
  };
}
