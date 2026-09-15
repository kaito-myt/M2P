'use server';

/**
 * NoteAccount Server Actions (docs/11-anp-design.md §6, F-ANP-01)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CreateAccountSchema = z.object({
  niche: z.string().trim().min(1, messages.accounts.errors.nicheRequired).max(200),
  display_name: z.string().trim().min(1, messages.accounts.errors.displayNameRequired).max(100),
  target_reader: z.string().trim().max(300).optional(),
  tone: z.string().trim().max(200).optional(),
  free_ratio: z.coerce.number().min(0.05).max(0.95).default(0.3),
  price_min: z.coerce.number().int().min(0).max(50000).default(100),
  price_max: z.coerce.number().int().min(0).max(50000).default(1000),
  membership: z.coerce.boolean().default(false),
});

export async function createAccount(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? messages.accounts.errors.unknown };
  }
  const v = parsed.data;

  try {
    const account = await prisma.noteAccount.create({
      data: {
        niche: v.niche,
        display_name: v.display_name,
        target_reader: v.target_reader || null,
        tone: v.tone || null,
        monetization_policy_json: {
          free_ratio: v.free_ratio,
          price_band: [v.price_min, v.price_max],
          membership: v.membership,
        },
        genre_policy_json: {},
        status: 'active',
      },
      select: { id: true },
    });
    revalidatePath('/accounts');
    return { ok: true, data: { id: account.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accounts.errors.unknown,
    };
  }
}
