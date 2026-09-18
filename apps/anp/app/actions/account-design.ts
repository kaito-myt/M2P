'use server';

/**
 * NoteAccountDesign Server Actions (docs/11-anp-design.md §3.1/§7, F-ANP-01/03)。
 *
 * 運営者要望「note は別アカウントを作ります。どのようなアカウントにするかの設計もツール上で
 * 行えるようにしといてくださいね」への対応。
 *
 * - `createAccountDesign`: ブリーフから `NoteAccountDesign` を作成し `note.account.design` を enqueue。
 * - `updateDesignAndGenerateVisuals`: 編集済み設計案を保存し `note.account.visuals` を enqueue。
 * - `regenerateDesignWithFeedback`: フィードバックを brief に追記した新しい `NoteAccountDesign` を作成。
 * - `adoptDesign`: 編集済み設計案から `note_accounts` を新規作成 (status='pending_session')、
 *   design を adopted にする。
 * - `rejectDesign`: 設計案を却下する。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { Prisma, prisma } from '@a2p/db';
import {
  NOTE_HANDLE_PATTERN,
  NoteAccountDesignBriefSchema,
  NoteAccountDesignSchema,
  type NoteAccountDesignBrief,
} from '@a2p/contracts/agents/anp';

import { auth } from '@/auth';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOTE_ACCOUNT_DESIGN_TASK_NAME = 'note.account.design';
const NOTE_ACCOUNT_VISUALS_TASK_NAME = 'note.account.visuals';

const m = messages.accountDesign.errors;

// ---------------------------------------------------------------------------
// createAccountDesign
// ---------------------------------------------------------------------------

const CreateDesignBriefFormSchema = z.object({
  idea: z.string().trim().min(1, m.ideaRequired).max(2000),
  goal: z.string().trim().max(1000).optional(),
  target_reader_hint: z.string().trim().max(500).optional(),
  monetization_hint: z.string().trim().max(500).optional(),
  constraints: z.string().trim().max(1000).optional(),
  persona_type: z.enum(['auto', 'person', 'brand']).default('auto'),
  /** 1行1件のテキストエリア入力。空行は無視する。 */
  reference_accounts: z.string().trim().max(3000).optional(),
});

export async function createAccountDesign(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = CreateDesignBriefFormSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? m.createFailed };
  }
  const v = parsed.data;

  try {
    const referenceAccounts = (v.reference_accounts ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 10);

    const brief: NoteAccountDesignBrief = NoteAccountDesignBriefSchema.parse({
      idea: v.idea,
      ...(v.goal ? { goal: v.goal } : {}),
      ...(v.target_reader_hint ? { target_reader_hint: v.target_reader_hint } : {}),
      ...(v.monetization_hint ? { monetization_hint: v.monetization_hint } : {}),
      ...(v.constraints ? { constraints: v.constraints } : {}),
      persona_type: v.persona_type,
      ...(referenceAccounts.length > 0 ? { reference_accounts: referenceAccounts } : {}),
    });

    const design = await prisma.noteAccountDesign.create({
      data: { brief_json: brief as unknown as Prisma.InputJsonValue, status: 'generating' },
      select: { id: true },
    });

    const job = await prisma.job.create({
      data: {
        kind: NOTE_ACCOUNT_DESIGN_TASK_NAME,
        status: 'queued',
        payload_json: { design_id: design.id },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_DESIGN_TASK_NAME,
      { design_id: design.id, job_id: job.id },
      { maxAttempts: 3 },
    );

    revalidatePath('/accounts/design');
    return { ok: true, data: { id: design.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.createFailed };
  }
}

// ---------------------------------------------------------------------------
// updateDesignAndGenerateVisuals
// ---------------------------------------------------------------------------

const UpdateVisualsSchema = z.object({
  design_id: z.string().min(1),
  design: NoteAccountDesignSchema,
});

export async function updateDesignAndGenerateVisuals(
  input: unknown,
): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = UpdateVisualsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.invalidEdit };
  const { design_id: designId, design } = parsed.data;

  try {
    // 提案済み/採用済みの設計のみ画像生成対象 (生成中・失敗・却下は対象外)。
    const guard = await prisma.noteAccountDesign.updateMany({
      where: { id: designId, status: { in: ['proposed', 'adopted'] } },
      data: { design_json: design as unknown as Prisma.InputJsonValue },
    });
    if (guard.count === 0) return { ok: false, error: m.notReady };

    const job = await prisma.job.create({
      data: {
        kind: NOTE_ACCOUNT_VISUALS_TASK_NAME,
        status: 'queued',
        payload_json: { design_id: designId },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_VISUALS_TASK_NAME,
      { design_id: designId, job_id: job.id },
      { jobKey: `note-account-visuals-${designId}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );

    revalidatePath(`/accounts/design/${designId}`);
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.generateImagesFailed };
  }
}

// ---------------------------------------------------------------------------
// regenerateDesignWithFeedback
// ---------------------------------------------------------------------------

const RegenerateSchema = z.object({
  design_id: z.string().min(1),
  feedback: z.string().trim().min(1).max(2000),
});

export async function regenerateDesignWithFeedback(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = RegenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.regenerateFailed };
  const { design_id: designId, feedback } = parsed.data;

  try {
    const prev = await prisma.noteAccountDesign.findUnique({
      where: { id: designId },
      select: { brief_json: true },
    });
    if (!prev) return { ok: false, error: m.notFound };

    const prevBrief = NoteAccountDesignBriefSchema.parse(prev.brief_json);
    const nextBrief: NoteAccountDesignBrief = { ...prevBrief, feedback };

    const created = await prisma.noteAccountDesign.create({
      data: { brief_json: nextBrief as unknown as Prisma.InputJsonValue, status: 'generating' },
      select: { id: true },
    });

    const job = await prisma.job.create({
      data: {
        kind: NOTE_ACCOUNT_DESIGN_TASK_NAME,
        status: 'queued',
        payload_json: { design_id: created.id },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_DESIGN_TASK_NAME,
      { design_id: created.id, job_id: job.id },
      { maxAttempts: 3 },
    );

    revalidatePath('/accounts/design');
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.regenerateFailed };
  }
}

// ---------------------------------------------------------------------------
// adoptDesign
// ---------------------------------------------------------------------------

const AdoptDesignSchema = z.object({
  design_id: z.string().min(1),
  selected_display_name: z.string().trim().min(1).max(100),
  selected_handle: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .refine((v) => NOTE_HANDLE_PATTERN.test(v), m.handleInvalid),
  design: NoteAccountDesignSchema,
});

export interface AdoptedAccountInfo {
  note_account_id: string;
  display_name: string;
  handle: string;
  bio: string;
}

export async function adoptDesign(input: unknown): Promise<ActionResult<AdoptedAccountInfo>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = AdoptDesignSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? m.adoptFailed };
  }
  const { design_id: designId, selected_display_name: displayName, selected_handle: handle, design } =
    parsed.data;

  try {
    const row = await prisma.noteAccountDesign.findUnique({
      where: { id: designId },
      select: { brief_json: true },
    });
    if (!row) return { ok: false, error: m.notFound };
    const brief = NoteAccountDesignBriefSchema.safeParse(row.brief_json);
    const niche = (brief.success ? brief.data.idea : design.concept).slice(0, 200);

    const result = await prisma.$transaction(async (tx) => {
      // 二重クリック対策: status='proposed' の行のみ対象にした CAS 更新。
      const guard = await tx.noteAccountDesign.updateMany({
        where: { id: designId, status: 'proposed' },
        data: { design_json: design as unknown as Prisma.InputJsonValue },
      });
      if (guard.count === 0) return null;

      const account = await tx.noteAccount.create({
        data: {
          niche,
          display_name: displayName,
          handle,
          target_reader: design.target_reader,
          tone: design.tone,
          monetization_policy_json: {
            free_ratio: design.monetization_policy.free_ratio,
            price_band: design.monetization_policy.price_band,
            membership: design.monetization_policy.membership,
          },
          // note_accounts.genre_policy_json は現状 { slugs: string[] } で保存する
          // (docs/11 §6 は note.theme.generate 等では未参照。将来のジャンル別方針拡張のための下地)。
          genre_policy_json: { slugs: design.genre_policy },
          status: 'pending_session',
        },
        select: { id: true },
      });

      await tx.noteAccountDesign.update({
        where: { id: designId },
        data: { status: 'adopted', note_account_id: account.id },
      });

      return account;
    });

    if (!result) return { ok: false, error: m.adoptFailed };

    revalidatePath('/accounts');
    revalidatePath(`/accounts/design/${designId}`);
    return {
      ok: true,
      data: { note_account_id: result.id, display_name: displayName, handle, bio: design.bio },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.adoptFailed };
  }
}

// ---------------------------------------------------------------------------
// rejectDesign
// ---------------------------------------------------------------------------

const RejectDesignSchema = z.object({ design_id: z.string().min(1) });

export async function rejectDesign(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = RejectDesignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.rejectFailed };
  const { design_id: designId } = parsed.data;

  try {
    const guard = await prisma.noteAccountDesign.updateMany({
      where: { id: designId, status: 'proposed' },
      data: { status: 'rejected' },
    });
    if (guard.count === 0) return { ok: false, error: m.rejectFailed };

    revalidatePath('/accounts/design');
    revalidatePath(`/accounts/design/${designId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.rejectFailed };
  }
}
