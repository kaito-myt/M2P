/**
 * @a2p/credentials — `api_credentials` への保存/読出とリゾルバ (DB 優先 → env フォールバック)。
 *
 * 解決順序は `@a2p/agents/lib/get-api-key` と同じ思想:
 *   1. DB (`api_credentials.provider = <service>`) を復号 → 必須項目が揃っていれば採用
 *   2. なければ env (各項目の `env` 名) から組み立て
 *   3. どちらも無ければ null (呼出側が「未接続」として扱う)
 * DB の復号失敗 (API_CRED_KEY ローテ漏れ) は改ざん検知のため env にフォールバックせず throw する。
 * DB 接続失敗は env にフォールバックする (起動直後や DB 障害時にストレージが完全に止まらないように)。
 *
 * 60 秒 TTL のプロセス内キャッシュで DB 参照を provider あたり最大 1 回/分に抑える。
 * ポータルで保存したら最長 1 分で全プロセス (web / anp / worker) に反映される。
 */
import { ConfigError } from '@a2p/contracts/errors';
import { decryptApiKey, encryptApiKey } from '@a2p/crypto';
import { prisma } from '@a2p/db';

import {
  isServiceComplete,
  serviceFieldsFromEnv,
  summarizeServiceFields,
  toAmazonAdsCredentials,
  toLineCredentials,
  toR2Credentials,
  type AmazonAdsCredentials,
  type LineCredentials,
  type R2Credentials,
  type ServiceFields,
  type ServiceProvider,
} from './spec.js';

export interface ServiceCredentialRepo {
  findUnique(args: { where: { provider: string } }): Promise<{ key_enc: string } | null>;
}

export interface ResolveDeps {
  repo?: ServiceCredentialRepo;
  env?: Record<string, string | undefined>;
  decrypt?: (enc: string) => string;
  now?: () => number;
}

/** DB 行の `key_enc` / `key_mask` を組み立てる (項目 JSON を暗号化、要約はマスク済)。 */
export function encodeServiceCredentials(provider: ServiceProvider, fields: ServiceFields): { key_enc: string; key_mask: string } {
  return { key_enc: encryptApiKey(JSON.stringify(fields)), key_mask: summarizeServiceFields(provider, fields) };
}

/** `key_enc` を復号して項目 JSON に戻す。JSON でなければ ConfigError。 */
export function decodeServiceCredentials(key_enc: string, decrypt: (enc: string) => string = decryptApiKey): ServiceFields {
  const plain = decrypt(key_enc);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch (err) {
    throw new ConfigError('service credentials payload is not JSON', { cause: err });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError('service credentials payload must be an object');
  }
  const out: ServiceFields = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string' && v.length > 0) out[k] = v;
  return out;
}

function isTransientDbError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  return (
    name === 'PrismaClientKnownRequestError' ||
    name === 'PrismaClientUnknownRequestError' ||
    name === 'PrismaClientRustPanicError' ||
    name === 'PrismaClientInitializationError'
  );
}

const CACHE_TTL_MS = 60_000;
interface CacheEntry {
  fields: ServiceFields | null;
  source: 'db' | 'env' | 'none';
  expiresAt: number;
}
const cache = new Map<ServiceProvider, CacheEntry>();

export type ResolvedService = { fields: ServiceFields; source: 'db' | 'env' } | { fields: null; source: 'none' };

/**
 * provider の項目 JSON を DB → env の順で解決する。未設定なら `{ fields: null, source: 'none' }`。
 * @throws ConfigError DB 行の復号/JSON 解釈に失敗 (改ざん・鍵ローテ漏れ)。
 */
export async function resolveServiceCredentials(provider: ServiceProvider, deps: ResolveDeps = {}): Promise<ResolvedService> {
  const now = deps.now ? deps.now() : Date.now();
  const hit = cache.get(provider);
  if (hit && now < hit.expiresAt) return hit.fields ? { fields: hit.fields, source: hit.source as 'db' | 'env' } : { fields: null, source: 'none' };

  const repo = deps.repo ?? (prisma.apiCredential as unknown as ServiceCredentialRepo);
  const env = deps.env ?? process.env;
  let row: { key_enc: string } | null = null;
  try {
    row = await repo.findUnique({ where: { provider } });
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    row = null;
  }
  let result: ResolvedService = { fields: null, source: 'none' };
  if (row) {
    let fields: ServiceFields;
    try {
      fields = decodeServiceCredentials(row.key_enc, deps.decrypt);
    } catch (err) {
      throw new ConfigError(`Failed to decrypt service credentials for provider=${provider} (check API_CRED_KEY rotation)`, {
        userMessage: `${provider} の接続情報の復号に失敗しました。API_CRED_KEY を確認してください`,
        cause: err,
      });
    }
    if (isServiceComplete(provider, fields)) result = { fields, source: 'db' };
  }
  if (!result.fields) {
    const fromEnv = serviceFieldsFromEnv(provider, env);
    if (fromEnv) result = { fields: fromEnv, source: 'env' };
  }
  cache.set(provider, { fields: result.fields, source: result.source, expiresAt: now + CACHE_TTL_MS });
  return result;
}

/**
 * 同期参照 (DB を引かない)。直近に解決済みの値を返す (期限切れでも返す)。未解決なら null。
 * worker の `isLineRelayConfigured()` のように同期で「設定済みか」を判定したい箇所向け。
 * 起動時に `primeServiceCredentials()` で温めておくこと。
 */
export function peekServiceCredentials(provider: ServiceProvider): ServiceFields | null {
  return cache.get(provider)?.fields ?? null;
}

export function peekLineCredentials(): LineCredentials | null {
  return toLineCredentials(peekServiceCredentials('line'));
}

/** ポータルで保存/削除したら呼ぶ (同一プロセス内のキャッシュ破棄。他プロセスは TTL で追従)。 */
export function invalidateServiceCredentialCache(provider?: ServiceProvider): void {
  if (provider === undefined) cache.clear();
  else cache.delete(provider);
}

// ---------------------------------------------------------------------------
// 型付きリゾルバ
// ---------------------------------------------------------------------------

export async function resolveR2Credentials(deps?: ResolveDeps): Promise<R2Credentials | null> {
  return toR2Credentials((await resolveServiceCredentials('r2', deps)).fields);
}

export async function resolveLineCredentials(deps?: ResolveDeps): Promise<LineCredentials | null> {
  return toLineCredentials((await resolveServiceCredentials('line', deps)).fields);
}

export async function resolveAmazonAdsCredentials(deps?: ResolveDeps): Promise<AmazonAdsCredentials | null> {
  return toAmazonAdsCredentials((await resolveServiceCredentials('amazon_ads', deps)).fields);
}

/** テスト用: キャッシュ件数。 */
export function _serviceCredentialCacheSize(): number {
  return cache.size;
}
