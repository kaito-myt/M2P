import { randomBytes } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptApiKey, encryptApiKey } from '@a2p/crypto';

import {
  _serviceCredentialCacheSize,
  decodeServiceCredentials,
  encodeServiceCredentials,
  invalidateServiceCredentialCache,
  resolveAmazonAdsCredentials,
  resolveLineCredentials,
  resolveR2Credentials,
  resolveServiceCredentials,
} from '../src/store.js';

const KEY = randomBytes(32);
const encrypt = (plain: string) => encryptApiKey(plain, KEY);
const decrypt = (enc: string) => decryptApiKey(enc, KEY);

const r2Fields = { account_id: 'acc', access_key_id: 'ak', secret_access_key: 'sk', bucket: 'bucket-db' };
const r2Env = { R2_ACCOUNT_ID: 'env-acc', R2_ACCESS_KEY_ID: 'env-ak', R2_SECRET_ACCESS_KEY: 'env-sk', R2_BUCKET_NAME: 'bucket-env' };

function repoWith(rows: Record<string, string | null>) {
  return {
    findUnique: vi.fn(async ({ where }: { where: { provider: string } }) => {
      const enc = rows[where.provider];
      return enc ? { key_enc: enc } : null;
    }),
  };
}

beforeEach(() => {
  invalidateServiceCredentialCache();
  process.env.API_CRED_KEY = KEY.toString('hex');
});

describe('encode/decode', () => {
  it('round-trips fields and masks the summary', () => {
    const { key_enc, key_mask } = encodeServiceCredentials('r2', r2Fields);
    expect(key_mask).toContain('bucket=bucket-db');
    expect(key_mask).not.toContain('sk');
    expect(decodeServiceCredentials(key_enc)).toEqual(r2Fields);
  });

  it('rejects non-JSON payloads', () => {
    expect(() => decodeServiceCredentials(encrypt('not json'), decrypt)).toThrow(/not JSON/);
    expect(() => decodeServiceCredentials(encrypt('[1]'), decrypt)).toThrow(/object/);
  });
});

describe('resolveServiceCredentials', () => {
  it('prefers DB over env', async () => {
    const repo = repoWith({ r2: encrypt(JSON.stringify(r2Fields)) });
    const res = await resolveServiceCredentials('r2', { repo, env: r2Env, decrypt });
    expect(res.source).toBe('db');
    expect(res.fields?.bucket).toBe('bucket-db');
  });

  it('falls back to env when DB has no row or an incomplete row', async () => {
    const res = await resolveServiceCredentials('r2', { repo: repoWith({}), env: r2Env, decrypt });
    expect(res).toEqual({ source: 'env', fields: { account_id: 'env-acc', access_key_id: 'env-ak', secret_access_key: 'env-sk', bucket: 'bucket-env' } });
    invalidateServiceCredentialCache();
    const partial = repoWith({ r2: encrypt(JSON.stringify({ account_id: 'only' })) });
    const res2 = await resolveServiceCredentials('r2', { repo: partial, env: r2Env, decrypt });
    expect(res2.source).toBe('env');
  });

  it('returns none when neither is configured', async () => {
    const res = await resolveServiceCredentials('line', { repo: repoWith({}), env: {}, decrypt });
    expect(res).toEqual({ fields: null, source: 'none' });
  });

  it('throws ConfigError on decrypt failure instead of falling back', async () => {
    const repo = repoWith({ r2: encryptApiKey(JSON.stringify(r2Fields), randomBytes(32)) });
    await expect(resolveServiceCredentials('r2', { repo, env: r2Env, decrypt })).rejects.toThrow(/decrypt/);
  });

  it('falls back to env on transient DB errors', async () => {
    const err = Object.assign(new Error('db down'), { name: 'PrismaClientInitializationError' });
    const repo = { findUnique: vi.fn(async () => Promise.reject(err)) };
    const res = await resolveServiceCredentials('r2', { repo, env: r2Env, decrypt });
    expect(res.source).toBe('env');
  });

  it('caches for 60s and invalidates on demand', async () => {
    const repo = repoWith({ r2: encrypt(JSON.stringify(r2Fields)) });
    let t = 1_000_000;
    const now = () => t;
    await resolveServiceCredentials('r2', { repo, env: {}, decrypt, now });
    await resolveServiceCredentials('r2', { repo, env: {}, decrypt, now });
    expect(repo.findUnique).toHaveBeenCalledTimes(1);
    expect(_serviceCredentialCacheSize()).toBe(1);
    t += 61_000;
    await resolveServiceCredentials('r2', { repo, env: {}, decrypt, now });
    expect(repo.findUnique).toHaveBeenCalledTimes(2);
    invalidateServiceCredentialCache('r2');
    await resolveServiceCredentials('r2', { repo, env: {}, decrypt, now });
    expect(repo.findUnique).toHaveBeenCalledTimes(3);
  });
});

describe('typed resolvers', () => {
  it('maps to typed shapes', async () => {
    const repo = repoWith({
      r2: encrypt(JSON.stringify(r2Fields)),
      line: encrypt(JSON.stringify({ channel_access_token: 'tok', allowed_user_id: 'U1' })),
      amazon_ads: encrypt(JSON.stringify({ client_id: 'c', client_secret: 's', refresh_token: 'r', profile_id: '9', region: 'fe' })),
    });
    expect(await resolveR2Credentials({ repo, env: {}, decrypt })).toEqual({ accountId: 'acc', accessKeyId: 'ak', secretAccessKey: 'sk', bucket: 'bucket-db' });
    expect(await resolveLineCredentials({ repo, env: {}, decrypt })).toEqual({ channelAccessToken: 'tok', channelSecret: null, allowedUserId: 'U1' });
    expect(await resolveAmazonAdsCredentials({ repo, env: {}, decrypt })).toEqual({ clientId: 'c', clientSecret: 's', refreshToken: 'r', profileId: '9', region: 'fe' });
  });
});
