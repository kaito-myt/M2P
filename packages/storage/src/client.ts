import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

import { ConfigError } from '@a2p/contracts/errors';

/**
 * Cloudflare R2 用 S3 互換クライアント (docs/03 §C-10, docs/05 §8)
 *
 * R2 endpoint は `https://<account_id>.r2.cloudflarestorage.com`、region は `auto` を使う。
 * 認証は `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`。
 *
 * `getR2Client()` はプロセス内シングルトン。`packages/contracts/env.ts` の parseEnv が
 * 起動時に必須項目を検証する前提で、ここでは「未設定なら ConfigError」のみガード。
 * 後続で `parseEnv` 経由の DI に切り替えやすいよう、`resolveR2Config()` を export する。
 */

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** docs/05 §8 規約: 単一バケット。`R2_BUCKET_NAME` から取得。 */
}

/** `process.env` から R2 設定を組み立てる。env 不足は ConfigError。 */
export function resolveR2Config(source: NodeJS.ProcessEnv = process.env): R2Config {
  const accountId = source.R2_ACCOUNT_ID;
  const accessKeyId = source.R2_ACCESS_KEY_ID;
  const secretAccessKey = source.R2_SECRET_ACCESS_KEY;
  const bucket = source.R2_BUCKET_NAME;
  const missing: string[] = [];
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET_NAME');
  if (missing.length > 0) {
    throw new ConfigError(`R2 環境変数が未設定です: ${missing.join(', ')}`, {
      details: { missing },
    });
  }
  return {
    accountId: accountId as string,
    accessKeyId: accessKeyId as string,
    secretAccessKey: secretAccessKey as string,
    bucket: bucket as string,
  };
}

export function buildR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function createR2Client(config: R2Config, overrides: Partial<S3ClientConfig> = {}): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: buildR2Endpoint(config.accountId),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
    ...overrides,
  });
}

interface SingletonState {
  client: S3Client;
  bucket: string;
}

let cached: SingletonState | null = null;

// ---------------------------------------------------------------------------
// DB 由来の設定プロバイダ (M2P ポータルの API 管理, docs/10 §10.4b)
//
// `@a2p/credentials` が `setR2ConfigProvider()` で「api_credentials(provider='r2') を復号して返す」
// 関数を登録する。operations.ts は `getR2Runtime()` (async) を使い、DB 設定 → env の順で解決する。
// storage パッケージ自体は DB に依存しない (プロバイダは各アプリの起動時に登録する)。
// ---------------------------------------------------------------------------

export type R2ConfigProvider = () => Promise<R2Config | null>;

let configProvider: R2ConfigProvider | null = null;

interface RuntimeState extends SingletonState {
  key: string;
  expiresAt: number;
}

let runtime: RuntimeState | null = null;
/** DB 設定の再確認間隔。M2P で差し替えても最長この時間で全プロセスに反映される。 */
const RUNTIME_TTL_MS = 60_000;

export function setR2ConfigProvider(provider: R2ConfigProvider | null): void {
  configProvider = provider;
  runtime = null;
}

function configKey(c: R2Config): string {
  return `${c.accountId}|${c.accessKeyId}|${c.secretAccessKey.slice(-6)}|${c.bucket}`;
}

/**
 * DB 設定 (登録済みプロバイダ) → env の順で R2 設定を解決し、S3Client と bucket を返す。
 * 設定が変わらなければ S3Client を使い回す。プロバイダの失敗は env にフォールバックする。
 */
export async function getR2Runtime(): Promise<SingletonState> {
  const now = Date.now();
  if (runtime && now < runtime.expiresAt) return runtime;
  let config: R2Config | null = null;
  if (configProvider) {
    try {
      config = await configProvider();
    } catch {
      config = null;
    }
  }
  if (!config) config = resolveR2Config();
  const key = configKey(config);
  if (runtime && runtime.key === key) {
    runtime.expiresAt = now + RUNTIME_TTL_MS;
    return runtime;
  }
  runtime = { client: createR2Client(config), bucket: config.bucket, key, expiresAt: now + RUNTIME_TTL_MS };
  return runtime;
}

/** 接続テスト: HeadBucket が通れば ok。ポータルの「疎通テスト」から使う。 */
export async function testR2Connection(config: R2Config): Promise<{ ok: boolean; message: string; latency_ms: number }> {
  const started = Date.now();
  const client = createR2Client(config);
  try {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { ok: true, message: `疎通 OK (bucket=${config.bucket})`, latency_ms: Date.now() - started };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), latency_ms: Date.now() - started };
  } finally {
    client.destroy();
  }
}

/** プロセス内シングルトン S3Client を返す。テスト時は `_resetR2ClientForTests()` で破棄。 */
export function getR2Client(): S3Client {
  if (!cached) {
    const config = resolveR2Config();
    cached = { client: createR2Client(config), bucket: config.bucket };
  }
  return cached.client;
}

/** バケット名を返す。`getR2Client()` と同じ env を参照する。 */
export function getR2Bucket(): string {
  if (!cached) {
    const config = resolveR2Config();
    cached = { client: createR2Client(config), bucket: config.bucket };
  }
  return cached.bucket;
}

/** テスト用途: 注入したクライアント/バケットでシングルトンを差し替える。 */
export function _setR2ClientForTests(client: S3Client, bucket: string): void {
  cached = { client, bucket };
  // operations.ts は getR2Runtime() を使うので、テスト差し替えはこちらにも効かせる (TTL 無期限)。
  runtime = { client, bucket, key: '__test__', expiresAt: Number.POSITIVE_INFINITY };
}

/** テスト用途: シングルトンを破棄する。 */
export function _resetR2ClientForTests(): void {
  cached = null;
  runtime = null;
}
