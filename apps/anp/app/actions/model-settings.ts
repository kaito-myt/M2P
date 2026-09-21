'use server';

/**
 * ANP の AI モデル設定 Server Action (docs/11-anp-design.md §5.4)。
 * `anp.*` 役割の genre=null の active 割当を差し替える (旧 active は archived、`model_catalog` の現行かつ
 * 呼出可のモデルのみ許可、audit_log に記録)。A2P `upsertModelAssignmentCore` と同じ手順。
 */
import { revalidatePath } from 'next/cache';

import { Prisma, prisma } from '@a2p/db';

import { auth } from '@/auth';
import { setAnpModelAssignmentInput } from '@/lib/model-settings-core';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function setAnpModelAssignment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = setAnpModelAssignmentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? messages.settings.models.errors.invalid };
  const { role, provider, model } = parsed.data;
  const em = messages.settings.models.errors;

  try {
    const catalogRow = await prisma.modelCatalog.findFirst({
      where: { provider, model, is_current: true },
      select: { id: true, available: true },
    });
    if (!catalogRow) return { ok: false, error: em.notInCatalog };
    if (catalogRow.available === false) return { ok: false, error: em.unavailable };

    const created = await prisma.$transaction(async (tx) => {
      const before = await tx.modelAssignment.findFirst({ where: { role, genre: null, status: 'active' } });
      if (before && before.provider === provider && before.model === model) throw new Error(em.noChange);
      const now = new Date();
      if (before) await tx.modelAssignment.update({ where: { id: before.id }, data: { status: 'archived', archived_at: now } });
      const row = await tx.modelAssignment.create({
        data: { role, genre: null, provider, model, status: 'active', activated_at: now, created_by: userId },
      });
      await tx.auditLog.create({
        data: {
          actor_id: userId,
          action: 'model_assignment.upsert',
          target_kind: 'model_assignment',
          target_id: `${role}:default`,
          before_json: before ? { provider: before.provider, model: before.model } : Prisma.JsonNull,
          after_json: { provider, model, source: 'anp' },
        },
      });
      return row;
    });
    revalidatePath('/settings');
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : em.saveFailed };
  }
}
