'use server';

/**
 * ANP の AI モデル設定 Server Action (docs/11-anp-design.md §5.4)。
 * `anp.*` 役割の genre=null の active 割当を差し替える (旧 active は archived、`model_catalog` の現行かつ
 * 呼出可のモデルのみ許可、audit_log に記録)。A2P `upsertModelAssignmentCore` と同じ手順。
 */
import { revalidatePath } from 'next/cache';

import { Prisma, prisma } from '@a2p/db';

import { auth } from '@/auth';
import { createAnpRoleInput, customRoleFromSlug, deleteAnpRoleInput, isBuiltinAnpRole, setAnpModelAssignmentInput } from '@/lib/model-settings-core';
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

// ---------------------------------------------------------------------------
// カスタム AI ロール (docs/11 §5.4)
// ---------------------------------------------------------------------------

/**
 * 新しい AI ロールを作る: `anp_agent_roles` (表示名/説明) + `prompts` (システムプロンプト v1, active) +
 * `model_assignments` (genre=null, active)。同名ロールが既にあれば拒否。
 */
export async function createAnpAgentRole(input: unknown): Promise<ActionResult<{ role: string }>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = createAnpRoleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? messages.settings.customRoles.errors.invalid };
  const { slug, label, description, system_prompt, provider, model } = parsed.data;
  const role = customRoleFromSlug(slug);
  const em = messages.settings.customRoles.errors;
  if (isBuiltinAnpRole(role)) return { ok: false, error: em.duplicate };

  try {
    const catalogRow = await prisma.modelCatalog.findFirst({ where: { provider, model, is_current: true }, select: { id: true, available: true } });
    if (!catalogRow) return { ok: false, error: messages.settings.models.errors.notInCatalog };
    if (catalogRow.available === false) return { ok: false, error: messages.settings.models.errors.unavailable };

    await prisma.$transaction(async (tx) => {
      const [existingRole, existingPrompt, existingAssignment] = await Promise.all([
        tx.anpAgentRole.findUnique({ where: { role }, select: { role: true } }),
        tx.prompt.findFirst({ where: { role, genre: null }, select: { id: true } }),
        tx.modelAssignment.findFirst({ where: { role, genre: null, status: 'active' }, select: { id: true } }),
      ]);
      if (existingRole || existingPrompt || existingAssignment) throw new Error(em.duplicate);
      const now = new Date();
      await tx.anpAgentRole.create({ data: { role, label, description: description && description.length > 0 ? description : null, created_by: userId } });
      await tx.prompt.create({
        data: { role, genre: null, version: 1, body: system_prompt, placeholders_json: [], status: 'active', created_by: 'human', activated_at: now },
      });
      await tx.modelAssignment.create({ data: { role, genre: null, provider, model, status: 'active', activated_at: now, created_by: userId } });
      await tx.auditLog.create({
        data: {
          actor_id: userId,
          action: 'anp_agent_role.create',
          target_kind: 'anp_agent_role',
          target_id: role,
          before_json: Prisma.JsonNull,
          after_json: { label, provider, model, prompt_chars: system_prompt.length },
        },
      });
    });
    revalidatePath('/settings');
    return { ok: true, data: { role } };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : em.createFailed };
  }
}

/** カスタムロールを削除する (プロンプト・割当は archived にして履歴を残す)。 */
export async function deleteAnpAgentRole(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: messages.common.unauthorized };
  const parsed = deleteAnpRoleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? messages.settings.customRoles.errors.invalid };
  const { role } = parsed.data;
  const em = messages.settings.customRoles.errors;
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.anpAgentRole.findUnique({ where: { role }, select: { role: true, label: true } });
      if (!existing) throw new Error(em.notFound);
      const now = new Date();
      await tx.anpAgentRole.delete({ where: { role } });
      await tx.prompt.updateMany({ where: { role, status: 'active' }, data: { status: 'archived', archived_at: now } });
      await tx.modelAssignment.updateMany({ where: { role, status: 'active' }, data: { status: 'archived', archived_at: now } });
      await tx.auditLog.create({
        data: { actor_id: userId, action: 'anp_agent_role.delete', target_kind: 'anp_agent_role', target_id: role, before_json: { label: existing.label }, after_json: Prisma.JsonNull },
      });
    });
    revalidatePath('/settings');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : em.deleteFailed };
  }
}
