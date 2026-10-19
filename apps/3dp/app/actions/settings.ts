'use server';

/**
 * 3DP 設定 Server Action (docs/12-3dp-design.md §2.1 R-1 / R-2 / §17.4)。
 * 全 Action は `auth()` → zod → ドメイン関数 (lib/*-core.ts) → `revalidatePath` の順 (C-8)。
 * ANP の `apps/anp/app/actions/settings.ts` と同じ DI/部分更新パターン。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';

import { auth } from '@/auth';
import { messages } from '@/lib/messages';
import { DENYLIST_MAX_TERMS, TDP_MONTHLY_LIMIT_HARD_MAX, parseDenylist } from '@/lib/settings-core';
import {
  SettingsGroupSchema,
  buildConfirmed,
  validateGroupPatch,
  validateMonthlyLimitPair,
  type Refusal,
} from '@/lib/settings-groups-core';
import { settingsFromRow } from '@/lib/tdp-settings';

export type ActionErrorCode = 'auth' | 'validation' | 'limit_range' | 'save_failed';
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: ActionErrorCode; refusals?: Refusal[] };

const m = messages.settings.errors;
const authError = { ok: false, error: messages.common.unauthorized, code: 'auth' } as const;
const SINGLETON = { id: 'singleton' } as const;

function show(v: unknown): string {
  return v === undefined ? '不明' : typeof v === 'string' ? v : JSON.stringify(v);
}

function refusalText(r: Refusal): string {
  switch (r.reason) {
    case 'unknown_key':
      return m.refusalUnknownKey(r.field);
    case 'sum':
      return m.refusalSum(r.field, show(r.current));
    case 'empty':
      return m.refusalEmpty;
    case 'required':
      return m.refusalRequired(r.field);
    case 'total':
      return m.limitTotal(Number(r.refused), r.current === null ? null : Number(r.current), TDP_MONTHLY_LIMIT_HARD_MAX);
    default:
      return m.refusal(r.field, show(r.refused), show(r.current));
  }
}

function validationError(refusals: Refusal[], code: ActionErrorCode = 'validation') {
  return {
    ok: false,
    code,
    refusals,
    error: [m.validationSummary(refusals.length), ...refusals.map(refusalText)].join('\n'),
  } as const;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 月間出品上限を保存する。入力は 2 形式:
 *   - 数値 / 文字列 (従来): BOOTH 枠のみ
 *   - `{booth?, jinxxy?}`: 媒体別。各枠も**合計も** TDP_MONTHLY_LIMIT_HARD_MAX 以下
 *
 * **範囲外は丸めずに失敗させる** (settings-core.validateMonthlyLimit)。R-1 で守りたいのは
 * 「うっかり出しすぎる」事故なので、黙って上限いっぱいに丸めるのは逆方向の挙動になる。
 */
export async function updateMonthlyPublishLimit(raw: {
  booth?: number;
  jinxxy?: number;
}): Promise<ActionResult<{ booth: number; jinxxy: number }>>;
export async function updateMonthlyPublishLimit(raw: unknown): Promise<ActionResult<number>>;
export async function updateMonthlyPublishLimit(
  raw: unknown,
): Promise<ActionResult<number | { booth: number; jinxxy: number }>> {
  const session = await auth();
  if (!session?.user) return authError;

  const pairMode = isPlainObject(raw);
  const input: { booth?: unknown; jinxxy?: unknown } = pairMode ? raw : { booth: raw };
  if (input.booth === undefined && input.jinxxy === undefined) {
    return validationError([{ field: '(patch)', refused: raw, current: null, reason: 'empty' }]);
  }

  // 拒否文面に現在値を出すため。読めなくても拒否自体は返す (null = 不明)。
  const row = await prisma.appSettings
    .findUnique({
      where: SINGLETON,
      select: { tdp_monthly_publish_limit: true, tdp_jinxxy_monthly_limit: true },
    })
    .catch(() => null);
  const current = {
    booth: row?.tdp_monthly_publish_limit ?? 0,
    jinxxy: row?.tdp_jinxxy_monthly_limit ?? 0,
  };

  const parsed = validateMonthlyLimitPair(input, current);
  if (!parsed.ok) {
    const first = parsed.refusals[0]!;
    // 行が読めないときの現在値 0 は「出品を止めた状態」と区別できない。不明 (null) として返す。
    if (first.reason === 'total') {
      const refusals = row ? parsed.refusals : parsed.refusals.map((r) => ({ ...r, current: null }));
      return validationError(refusals, 'limit_range');
    }
    return {
      ok: false,
      code: 'limit_range',
      refusals: parsed.refusals,
      error: m.limitRange(
        typeof first.refused === 'number' ? first.refused : null,
        row ? Number(first.current) : null,
        TDP_MONTHLY_LIMIT_HARD_MAX,
      ),
    };
  }
  // 現在値が読めないと合計を判定できない。判定できないまま保存しない。
  if (!row) return { ok: false, code: 'save_failed', error: m.saveFailed };

  const data: { tdp_monthly_publish_limit?: number; tdp_jinxxy_monthly_limit?: number } = {};
  if (input.booth !== undefined) data.tdp_monthly_publish_limit = parsed.booth;
  if (input.jinxxy !== undefined) data.tdp_jinxxy_monthly_limit = parsed.jinxxy;

  try {
    await prisma.appSettings.update({ where: SINGLETON, data });
    revalidatePath('/settings');
    revalidatePath('/');
    return pairMode
      ? { ok: true, data: { booth: parsed.booth, jinxxy: parsed.jinxxy } }
      : { ok: true, data: parsed.booth };
  } catch (err) {
    return { ok: false, code: 'save_failed', error: err instanceof Error ? err.message : m.saveFailed };
  }
}

const UpdateSettingsInput = z.object({
  group: SettingsGroupSchema,
  patch: z.record(z.unknown()),
});

/**
 * グループ別に設定を更新する (docs/12 §17.4)。範囲外・未知キー・合計 ≠ 100 は**丸めず拒否**し、
 * 拒否した値と現在値を返す。1 件でも拒否があれば何も保存しない。
 * 確認後に値が変わった項目は `tdp_settings_confirmed_json` との差で自動的に「変更済 (未確認)」になる。
 */
export async function updateTdpSettings(
  raw: unknown,
): Promise<ActionResult<{ group: string; keys: string[] }>> {
  const session = await auth();
  if (!session?.user) return authError;

  const input = UpdateSettingsInput.safeParse(raw);
  if (!input.success) return { ok: false, code: 'validation', error: m.invalidInput };

  try {
    const row = await prisma.appSettings.findUnique({ where: SINGLETON });
    if (!row) return { ok: false, code: 'save_failed', error: m.saveFailed };
    const settings = settingsFromRow(row as unknown as Record<string, unknown>);

    const v = validateGroupPatch(input.data.group, input.data.patch, settings);
    if (!v.ok) return validationError(v.refusals);

    const data: Record<string, unknown> = { ...v.columns };
    if (v.tuning) data.tdp_tuning_json = v.tuning;
    await prisma.appSettings.update({ where: SINGLETON, data });
    revalidatePath('/settings');
    revalidatePath('/');
    return { ok: true, data: { group: input.data.group, keys: Object.keys(input.data.patch) } };
  } catch (err) {
    return { ok: false, code: 'save_failed', error: err instanceof Error ? err.message : m.saveFailed };
  }
}

/** その時点の値を `values` に写して確認済みにする。他グループの確認は保持する。 */
export async function confirmSettingsGroup(raw: unknown): Promise<ActionResult<{ group: string }>> {
  const session = await auth();
  if (!session?.user) return authError;

  const input = z.object({ group: SettingsGroupSchema }).safeParse(raw);
  if (!input.success) return { ok: false, code: 'validation', error: m.invalidInput };

  try {
    const row = await prisma.appSettings.findUnique({ where: SINGLETON });
    if (!row) return { ok: false, code: 'save_failed', error: m.saveFailed };
    const settings = settingsFromRow(row as unknown as Record<string, unknown>);
    const confirmed = buildConfirmed(input.data.group, settings, new Date());
    await prisma.appSettings.update({
      where: SINGLETON,
      data: { tdp_settings_confirmed_json: confirmed as never },
    });
    revalidatePath('/settings');
    return { ok: true, data: { group: input.data.group } };
  } catch (err) {
    return { ok: false, code: 'save_failed', error: err instanceof Error ? err.message : m.saveFailed };
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
  if (!session?.user) return authError;

  if (typeof raw !== 'string') return { ok: false, error: m.saveFailed };

  const terms = parseDenylist(raw);
  if (terms.length > DENYLIST_MAX_TERMS) {
    return { ok: false, error: m.denylistTooMany };
  }

  try {
    await prisma.appSettings.update({
      where: SINGLETON,
      data: { tdp_derivative_denylist: terms },
    });
    revalidatePath('/settings');
    return { ok: true, data: terms };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.saveFailed };
  }
}
