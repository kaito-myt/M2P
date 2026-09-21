import { describe, expect, it } from 'vitest';

import {
  isServiceComplete,
  maskSecret,
  maskServiceFields,
  mergeServiceFields,
  serviceFieldsFromEnv,
  serviceFieldsSchema,
  summarizeServiceFields,
  toAmazonAdsCredentials,
  toLineCredentials,
  toR2Credentials,
} from '../src/spec.js';

const r2 = { account_id: 'acc0123456789abcdef', access_key_id: 'AKIA1234567890', secret_access_key: 'supersecretvalue1234', bucket: 'a2p-artifacts' };

describe('serviceFieldsSchema', () => {
  it('accepts a complete r2 payload and drops empty optional fields', () => {
    const parsed = serviceFieldsSchema('r2').parse({ ...r2, extra: undefined });
    expect(parsed).toEqual(r2);
  });

  it('rejects missing required fields', () => {
    expect(serviceFieldsSchema('r2').safeParse({ ...r2, bucket: '' }).success).toBe(false);
  });

  it('validates amazon_ads region enum and allows optional line channel_secret to be blank', () => {
    expect(serviceFieldsSchema('amazon_ads').safeParse({ client_id: 'a', client_secret: 'b', refresh_token: 'c', profile_id: '1', region: 'xx' }).success).toBe(false);
    const line = serviceFieldsSchema('line').parse({ channel_access_token: 'tok', channel_secret: '', allowed_user_id: 'U1' });
    expect(line).toEqual({ channel_access_token: 'tok', allowed_user_id: 'U1' });
  });
});

describe('env / completeness', () => {
  it('builds fields from env and reports null when incomplete', () => {
    expect(serviceFieldsFromEnv('r2', { R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET_NAME: 'b' })).toEqual({
      account_id: 'a',
      access_key_id: 'k',
      secret_access_key: 's',
      bucket: 'b',
    });
    expect(serviceFieldsFromEnv('r2', { R2_ACCOUNT_ID: 'a' })).toBeNull();
    expect(serviceFieldsFromEnv('amazon_ads', { AMAZON_ADS_CLIENT_ID: 'c', AMAZON_ADS_CLIENT_SECRET: 's', AMAZON_ADS_REFRESH_TOKEN: 'r', AMAZON_ADS_PROFILE_ID: 'p' })).toBeNull();
  });

  it('isServiceComplete ignores optional fields', () => {
    expect(isServiceComplete('line', { channel_access_token: 't', allowed_user_id: 'U' })).toBe(true);
    expect(isServiceComplete('line', { channel_access_token: 't' })).toBe(false);
  });
});

describe('masking', () => {
  it('masks secrets only', () => {
    expect(maskSecret('short')).toBe('*****');
    expect(maskSecret('supersecretvalue1234')).toBe('sup…1234');
    const masked = maskServiceFields('r2', r2);
    expect(masked.secret_access_key).toBe('sup…1234');
    expect(masked.bucket).toBe('a2p-artifacts');
    expect(masked.account_id).toBe(r2.account_id);
  });

  it('summarizes for key_mask without leaking secrets', () => {
    const s = summarizeServiceFields('r2', r2);
    expect(s).toContain('bucket=a2p-artifacts');
    expect(s).not.toContain('supersecretvalue1234');
    const ads = summarizeServiceFields('amazon_ads', { client_id: 'amzn1.application-oa2-client.abc', client_secret: 'sec', refresh_token: 'ref', profile_id: '42', region: 'fe' });
    expect(ads).toContain('profile=42');
    expect(ads).toContain('region=fe');
  });
});

describe('mergeServiceFields', () => {
  it('keeps existing secrets when incoming is blank and replaces non-secrets', () => {
    const merged = mergeServiceFields('r2', r2, { account_id: 'new-acc', access_key_id: 'AKIA-new', secret_access_key: '', bucket: 'b2' });
    expect(merged).toEqual({ account_id: 'new-acc', access_key_id: 'AKIA-new', secret_access_key: r2.secret_access_key, bucket: 'b2' });
  });

  it('drops a cleared optional non-secret and keeps untouched ones', () => {
    const merged = mergeServiceFields('line', { channel_access_token: 't', channel_secret: 'cs', allowed_user_id: 'U1' }, { channel_access_token: '', allowed_user_id: '' });
    // allowed_user_id は非秘密で空文字 (= クリア) → 落ちる。channel_secret は送られていない秘密 → 保持。
    expect(merged).toEqual({ channel_access_token: 't', channel_secret: 'cs' });
  });
});

describe('typed converters', () => {
  it('converts to typed credentials or null', () => {
    expect(toR2Credentials(r2)).toEqual({ accountId: r2.account_id, accessKeyId: r2.access_key_id, secretAccessKey: r2.secret_access_key, bucket: r2.bucket });
    expect(toR2Credentials({ account_id: 'a' })).toBeNull();
    expect(toLineCredentials({ channel_access_token: 't', allowed_user_id: 'U' })).toEqual({ channelAccessToken: 't', channelSecret: null, allowedUserId: 'U' });
    expect(toAmazonAdsCredentials({ client_id: 'c', client_secret: 's', refresh_token: 'r', profile_id: 'p', region: 'eu' })?.region).toBe('eu');
  });
});
