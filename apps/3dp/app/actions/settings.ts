'use server';

/**
 * 3DP 設定 Server Action (docs/12-3dp-design.md §2.1 R-1 / R-2)。
 * 更新先は `app_settings` singleton の 2 列:
 *   - `tdp_monthly_publish_limit` (R-1 月間出品上限)
 *   - `tdp_derivative_denylist`   (R-2 運営者が登録する禁止語)
 * ANP の `apps/anp/app/actions/settings.ts` と同じ DI/部分更新パターン。
 */
import { revalidatePath } from 'next/cache';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import {
  DENYLIST_MAX_TERMS,
  TDP_MONTHLY_LIMIT_HARD_MAX,
  parseDenylist,
  validateMonthlyLimit,
} from '@/lib/settings-core';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * 月間出品上限を保存する。
 *
 * **範囲外は丸めずに失敗させる** (settings-core.validateMonthlyLimit)。R-1 で守りたいのは
 * 「うっかり出しすぎる」事故なので、黙って上限いっぱいに丸めるのは逆方向の挙動になる。
 */
export async function updateMonthlyPublishLimit(raw: unknown): Promise<ActionResult<number>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = validateMonthlyLimit(raw);
  if (!parsed.ok) {
    // 拒否文面に現在値を出すため。読めなくても拒否自体は返す (null = 不明)。
    const row = await prisma.appSettings
      .findUnique({ where: { id: 'singleton' }, select: { tdp_monthly_publish_limit: true } })
      .catch(() => null);
    return {
      ok: false,
      error: messages.settings.errors.limitRange(
        parsed.refused,
        row?.tdp_monthly_publish_limit ?? null,
        TDP_MONTHLY_LIMIT_HARD_MAX,
      ),
    };
  }

  try {
    await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: { tdp_monthly_publish_limit: parsed.value },
    });
    revalidatePath('/settings');
    revalidatePath('/');
    return { ok: true, data: parsed.value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.settings.errors.saveFailed,
    };
  }
}

/**
 * 禁止語リストを保存する (textarea の生テキストを受け取り、正規化して配列にする)。
 *
 * 保存するのは原文で、重複判定だけ NFKC + 小文字化 + 空白除去で行う
 * (`derivative-guard.ts` の照合規則と同じ — ここだけ別規則にすると
 *  「登録したのに弾かれない」が起きる)。
 */
export async function updateDerivativeDenylist(raw: unknown): Promise<ActionResult<string[]>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  if (typeof raw !== 'string') return { ok: false, error: messages.settings.errors.saveFailed };

  const terms = parseDenylist(raw);
  if (terms.length > DENYLIST_MAX_TERMS) {
    return { ok: false, error: messages.settings.errors.denylistTooMany };
  }

  try {
    await prisma.appSettings.update({
      where: { id: 'singleton' },
      data: { tdp_derivative_denylist: terms },
    });
    revalidatePath('/settings');
    return { ok: true, data: terms };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.settings.errors.saveFailed,
    };
  }
}
