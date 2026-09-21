'use server';

/**
 * M2P ポータル「設定」Server Actions (docs/10-platform-portal.md §設定)。
 *
 * - API キー: `api_credentials` に AES-256-GCM (API_CRED_KEY) で暗号化保存 / 疎通テスト / 失効。
 *   A2P `apps/web/app/actions/api-credentials.ts` と同じ保存形式・同じテーブルなので、ポータルで
 *   設定したキーは A2P / ANP / worker がそのまま使う (各プロセスの 60 秒キャッシュ経由)。
 * - 環境変数で設定済みのキーは「DB に取り込む」で `api_credentials` へ移し、M2P で一元管理する
 *   (取り込み後は DB が優先されるので env は削除してよい)。
 * AI モデル割当は役割がツールごとに異なるため各ツール側 (A2P `/settings/models`, ANP `/settings`) で扱う。
 */
import { revalidatePath } from 'next/cache';

import { Prisma, prisma } from '@a2p/db';
import { decryptApiKey, encryptApiKey, maskApiKey } from '@a2p/crypto';

import { auth } from '@/auth';
import {
  envKeyFor,
  providerOnlyInput,
  providerTestRequest,
  setApiKeyInput,
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


/** 環境変数に設定されているキーを DB に取り込む (M2P への一元化)。 */
export async function importApiKeyFromEnv(input: unknown): Promise<ActionResult<{ provider: ApiProvider; key_mask: string }>> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: 'ログインが必要です' };
  const parsed = providerOnlyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'provider が不正です' };
  const { provider } = parsed.data;
  const fromEnv = envKeyFor(provider);
  if (!fromEnv) return { ok: false, error: 'このサービサーのキーは環境変数に設定されていません' };
  return setApiKey({ provider, key: fromEnv });
}
