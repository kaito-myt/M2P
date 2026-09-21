'use server';

/**
 * M2P ポータル「設定」Server Actions (docs/10-platform-portal.md §設定)。
 *
 * - API キー: `api_credentials` に AES-256-GCM (API_CRED_KEY) で暗号化保存 / 疎通テスト / 失効。
 *   A2P `apps/web/app/actions/api-credentials.ts` と同じ保存形式・同じテーブルなので、ポータルで
 *   設定したキーは A2P / ANP / worker がそのまま使う (各プロセスの 60 秒キャッシュ経由)。
 * - モデル割当: `model_assignments` の genre=null (全ジャンル既定) の active 行を差し替える
 *   (旧 active は archived、`model_catalog` に存在する現行モデルのみ許可、audit_log に記録)。
 *   ジャンル別の上書きは A2P 側の設定画面で扱う。
 */
import { revalidatePath } from 'next/cache';

import { Prisma, prisma } from '@a2p/db';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@a2p/crypto';

import { auth } from '@/auth';
import {
  providerOnlyInput,
  providerTestRequest,
  setApiKeyInput,
  setModelAssignmentInput,
  type ApiKeyTestResult,
  type ApiProvider,
} from '@/lib/settings-core';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireUserId(): Promise<string | null> {
  const session = await auth();
  const id = session?.user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// API キー
// ---------------------------------------------------------------------------

export async function setApiKey(input: unknown): Promise<ActionResult<{ provider: ApiProvider; key_mask: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: 'ログインが必要です' };
  const parsed = setApiKeyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'API キーの形式が不正です (8 文字以上)' };
  const { provider, key } = parsed.data;

  try {
    const before = await prisma.apiCredential.findUnique({ where: { provider }, select: { key_mask: true } });
    const key_enc = encryptApiKey(key);
    const key_mask = maskApiKey(key);
    await prisma.$transaction([
      prisma.apiCredential.upsert({
        where: { provider },
        create: { provider, key_enc, key_mask, set_by: userId, set_at: new Date(), last_tested_at: null, last_test_result_json: Prisma.JsonNull },
        update: { key_enc, key_mask, set_by: userId, set_at: new Date(), last_tested_at: null, last_test_result_json: Prisma.JsonNull },
      }),
      prisma.auditLog.create({
        data: {
          actor_id: userId,
          action: 'api_credential.set',
          target_kind: 'api_credential',
          target_id: provider,
          before_json: before ? { key_mask: before.key_mask } : Prisma.JsonNull,
          after_json: { key_mask, source: 'portal' },
        },
      }),
    ]);
    revalidatePath('/settings/api-keys');
    return { ok: true, data: { provider, key_mask } };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'API キーの保存に失敗しました') };
  }
}

export async function revokeApiKey(input: unknown): Promise<ActionResult<void>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: 'ログインが必要です' };
  const parsed = providerOnlyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'provider が不正です' };
  const { provider } = parsed.data;
  try {
    const before = await prisma.apiCredential.findUnique({ where: { provider }, select: { key_mask: true } });
    if (!before) return { ok: false, error: 'このサービサーのキーは登録されていません' };
    await prisma.$transaction([
      prisma.apiCredential.delete({ where: { provider } }),
      prisma.auditLog.create({
        data: {
          actor_id: userId,
          action: 'api_credential.revoke',
          target_kind: 'api_credential',
          target_id: provider,
          before_json: { key_mask: before.key_mask },
          after_json: Prisma.JsonNull,
        },
      }),
    ]);
    revalidatePath('/settings/api-keys');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'API キーの削除に失敗しました') };
  }
}

async function runProviderTest(provider: ApiProvider, key: string): Promise<ApiKeyTestResult> {
  const started = Date.now();
  try {
    if (provider === 'tavily') {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: 'ping', max_results: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      const latency_ms = Date.now() - started;
      return res.ok
        ? { ok: true, message: `疎通 OK (${latency_ms}ms)`, http_status: res.status, latency_ms }
        : { ok: false, message: `HTTP ${res.status}`, http_status: res.status, latency_ms };
    }
    const req = providerTestRequest(provider, key);
    const res = await fetch(req.url, { headers: req.headers, signal: AbortSignal.timeout(15_000) });
    const latency_ms = Date.now() - started;
    return res.ok
      ? { ok: true, message: `疎通 OK (${latency_ms}ms)`, http_status: res.status, latency_ms }
      : { ok: false, message: `HTTP ${res.status}`, http_status: res.status, latency_ms };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'network error'), latency_ms: Date.now() - started };
  }
}

export async function testApiKey(input: unknown): Promise<ActionResult<ApiKeyTestResult>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: 'ログインが必要です' };
  const parsed = providerOnlyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'provider が不正です' };
  const { provider } = parsed.data;
  try {
    const row = await prisma.apiCredential.findUnique({ where: { provider }, select: { key_enc: true } });
    if (!row) return { ok: false, error: 'このサービサーのキーは登録されていません' };
    const key = decryptApiKey(row.key_enc);
    const result = await runProviderTest(provider, key);
    await prisma.apiCredential.update({
      where: { provider },
      data: { last_tested_at: new Date(), last_test_result_json: result as unknown as Prisma.InputJsonValue },
    });
    revalidatePath('/settings/api-keys');
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: errorMessage(err, '疎通テストに失敗しました') };
  }
}

// ---------------------------------------------------------------------------
// モデル割当 (genre=null の既定)
// ---------------------------------------------------------------------------

export async function setModelAssignment(input: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: 'ログインが必要です' };
  const parsed = setModelAssignmentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: '入力が不正です' };
  const { role, provider, model } = parsed.data;

  try {
    const catalogRow = await prisma.modelCatalog.findFirst({
      where: { provider, model, is_current: true },
      select: { id: true, available: true },
    });
    if (!catalogRow) return { ok: false, error: 'そのモデルは現行カタログにありません' };
    if (catalogRow.available === false) return { ok: false, error: 'そのモデルは呼び出せない (廃止/権限なし) と判定されています' };

    const created = await prisma.$transaction(async (tx) => {
      const before = await tx.modelAssignment.findFirst({ where: { role, genre: null, status: 'active' } });
      if (before && before.provider === provider && before.model === model) {
        throw new Error('変更がありません (同じモデルが既に割り当てられています)');
      }
      const now = new Date();
      if (before) {
        await tx.modelAssignment.update({ where: { id: before.id }, data: { status: 'archived', archived_at: now } });
      }
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
          after_json: { provider, model, source: 'portal' },
        },
      });
      return row;
    });
    revalidatePath('/settings/models');
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return { ok: false, error: errorMessage(err, 'モデル割当の保存に失敗しました') };
  }
}
