'use server';

/**
 * ANP パイプライン設定 Server Action (docs/11-anp-design.md §7 Phase2)。
 * A2P の `apps/web/lib/pipeline-settings-core.ts` と同じ DI パターン(部分更新・AppSettings singleton)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UpdateAnpSettingsSchema = z.object({
  anp_auto_publish_enabled: z.boolean().optional(),
  anp_publish_dry_run: z.boolean().optional(),
  // F-ANP-17 (docs/11 §7 Phase4): 日次テーマ自動生成 + 自動採用パイプライン起動。
  anp_auto_theme_enabled: z.boolean().optional(),
  anp_themes_per_day: z.coerce.number().int().min(1).max(20).optional(),
  anp_autopass_enabled: z.boolean().optional(),
});

export async function updateAnpSettings(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = UpdateAnpSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.settings.errors.saveFailed };
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return { ok: true, data: undefined };
  }

  try {
    await prisma.appSettings.update({ where: { id: 'singleton' }, data });
    revalidatePath('/settings');
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.settings.errors.saveFailed,
    };
  }
}
