'use server';

/**
 * S-ANP-10 販促施策 Server Actions (docs/11-anp-design.md §3.4 F-ANP-32)。
 * `note_accounts.promotion_policy_json` の媒体別項目を保存し、AI 生成は `note.account.profile`
 * (targets=['promotion'], channel) を `generateAccountProfile` 経由で enqueue する。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { NOTE_PROMOTION_CHANNELS, NotePromotionChannelPolicySchema, parseNotePromotionPolicy } from '@a2p/contracts/agents/anp';
import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import { loadAccountPromotionState } from '@/lib/promotion-core';
import { parseHashtagsText, type AccountPromotionState } from '@/lib/promotion-view';

import { generateAccountProfile } from './accounts';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UpdatePolicySchema = z.object({
  note_account_id: z.string().min(1),
  channel: z.enum(NOTE_PROMOTION_CHANNELS),
  /** null = 既定に戻す (明示 enabled を消す)。 */
  enabled: z.boolean().nullable(),
  policy: z.string().trim().max(3000),
  hashtags_text: z.string().max(2000),
  posts_per_week: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'string' ? (v.trim().length === 0 ? undefined : Number(v)) : v))
    .pipe(z.number().int().min(0).max(70).optional()),
  cta: z.string().trim().max(300),
});

export async function updateAccountPromotionPolicy(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const parsed = UpdatePolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? messages.promotion.errors.saveFailed };
  const { note_account_id: accountId, channel, enabled, policy, hashtags_text, posts_per_week, cta } = parsed.data;
  try {
    const account = await prisma.noteAccount.findUnique({ where: { id: accountId }, select: { promotion_policy_json: true } });
    if (!account) return { ok: false, error: messages.accounts.errors.notFound };
    const current = parseNotePromotionPolicy(account.promotion_policy_json);
    const existing = current[channel] ?? { hashtags: [] };
    const next = NotePromotionChannelPolicySchema.parse({
      ...existing,
      ...(enabled === null ? { enabled: undefined } : { enabled }),
      policy: policy.length > 0 ? policy : undefined,
      hashtags: parseHashtagsText(hashtags_text),
      posts_per_week,
      cta: cta.length > 0 ? cta : undefined,
      updated_at: new Date().toISOString(),
    });
    await prisma.noteAccount.update({ where: { id: accountId }, data: { promotion_policy_json: { ...current, [channel]: next } } });
    revalidatePath('/promotion');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : messages.promotion.errors.saveFailed };
  }
}

const GenerateSchema = z.object({
  note_account_id: z.string().min(1),
  channel: z.enum(NOTE_PROMOTION_CHANNELS),
  instruction: z.string().trim().max(1000).optional(),
  reference_image_keys: z.array(z.string()).max(4).optional(),
});

/** 媒体別の販促施策を AI に作らせる (note.account.profile targets=['promotion'])。 */
export async function generateAccountPromotionPolicy(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const parsed = GenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.promotion.errors.generateFailed };
  const { note_account_id, channel, instruction, reference_image_keys } = parsed.data;
  return generateAccountProfile({
    note_account_id,
    targets: ['promotion'],
    channel,
    ...(instruction ? { instruction } : {}),
    ...(reference_image_keys && reference_image_keys.length > 0 ? { reference_image_keys } : {}),
  });
}

const StateSchema = z.object({ note_account_id: z.string().min(1), channel: z.enum(NOTE_PROMOTION_CHANNELS) });

export async function getAccountPromotionState(input: unknown): Promise<ActionResult<AccountPromotionState>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const parsed = StateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accounts.errors.unknown };
  const state = await loadAccountPromotionState(parsed.data.note_account_id, parsed.data.channel);
  if (!state) return { ok: false, error: messages.accounts.errors.notFound };
  return { ok: true, data: state };
}
