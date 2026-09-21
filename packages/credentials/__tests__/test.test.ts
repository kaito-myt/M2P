import { describe, expect, it, vi } from 'vitest';

import { testServiceCredentials } from '../src/test.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('testServiceCredentials', () => {
  it('r2 delegates to HeadBucket tester', async () => {
    const testR2 = vi.fn(async () => ({ ok: true, message: '疎通 OK (bucket=b)', latency_ms: 12 }));
    const r = await testServiceCredentials('r2', { account_id: 'a', access_key_id: 'k', secret_access_key: 's', bucket: 'b' }, { testR2 });
    expect(r.ok).toBe(true);
    expect(testR2).toHaveBeenCalledWith({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' });
  });

  it('reports missing fields without calling the network', async () => {
    const fetchFn = vi.fn();
    const r = await testServiceCredentials('line', { channel_access_token: 't' }, { fetch: fetchFn as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('line calls bot/info and surfaces the bot name', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.line.me/v2/bot/info');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
      return jsonResponse(200, { displayName: 'A2P Bot', basicId: '@abc' });
    });
    const r = await testServiceCredentials('line', { channel_access_token: 'tok', allowed_user_id: 'U1' }, { fetch: fetchFn as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('A2P Bot');
  });

  it('amazon_ads refreshes the token then checks the profile list', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/auth/o2/token')) return jsonResponse(200, { access_token: 'AT' });
      if (u.endsWith('/v2/profiles')) return jsonResponse(200, [{ profileId: 123, countryCode: 'JP', accountInfo: { name: 'KDP Author' } }]);
      return jsonResponse(404, {});
    });
    const fields = { client_id: 'c', client_secret: 's', refresh_token: 'r', profile_id: '123', region: 'fe' };
    const r = await testServiceCredentials('amazon_ads', fields, { fetch: fetchFn as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('JP');
    expect(calls[0]).toBe('https://api.amazon.co.jp/auth/o2/token');
    expect(calls[1]).toBe('https://advertising-api-fe.amazon.com/v2/profiles');

    const wrongProfile = await testServiceCredentials('amazon_ads', { ...fields, profile_id: '999' }, { fetch: fetchFn as unknown as typeof fetch });
    expect(wrongProfile.ok).toBe(false);
    expect(wrongProfile.message).toContain('999');
  });

  it('amazon_ads falls back to api.amazon.com when the regional token URL fails', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u === 'https://api.amazon.co.jp/auth/o2/token') return jsonResponse(400, { error: 'invalid_grant' });
      if (u === 'https://api.amazon.com/auth/o2/token') return jsonResponse(200, { access_token: 'AT' });
      if (u.endsWith('/v2/profiles')) return jsonResponse(200, [{ profileId: '1' }]);
      return jsonResponse(404, {});
    });
    const r = await testServiceCredentials('amazon_ads', { client_id: 'c', client_secret: 's', refresh_token: 'r', profile_id: '1', region: 'fe' }, { fetch: fetchFn as unknown as typeof fetch });
    expect(r.ok).toBe(true);
  });
});
