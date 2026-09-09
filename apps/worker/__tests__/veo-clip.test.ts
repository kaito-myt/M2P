import { describe, expect, it, vi } from 'vitest';

import { generateVeoClip } from '../src/tasks/promotion-post/veo-clip.js';

function res(json: unknown, opts: { ok?: boolean; status?: number; bytes?: Buffer } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
    arrayBuffer: async () => (opts.bytes ?? Buffer.alloc(0)).buffer,
  };
}

describe('generateVeoClip', () => {
  const sleep = async () => {};

  it('開始→ポーリング(done)→DL の一連で mp4 Buffer を返す', async () => {
    const bytes = Buffer.alloc(5000, 1);
    const doFetch = vi
      .fn()
      // 1) start
      .mockResolvedValueOnce(res({ name: 'operations/abc' }))
      // 2) poll (not done)
      .mockResolvedValueOnce(res({ done: false }))
      // 3) poll (done)
      .mockResolvedValueOnce(
        res({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://dl/v.mp4' } }] } } }),
      )
      // 4) download
      .mockResolvedValueOnce(res({}, { bytes }));
    const logCost = vi.fn().mockResolvedValue(undefined);

    const buf = await generateVeoClip('a cinematic vertical clip', { tier: 'fast', seconds: 8 }, { apiKey: 'k', doFetch: doFetch as never, sleep, logCost });
    expect(buf.byteLength).toBe(5000);
    // fast モデルを叩いている
    expect(String(doFetch.mock.calls[0]![0])).toContain('veo-3.1-fast-generate-preview:predictLongRunning');
    // コスト記録（8秒 * 0.15 * 155 ≒ 186円）
    expect(logCost).toHaveBeenCalled();
    const costArg = logCost.mock.calls[0]![2];
    expect(costArg).toBeCloseTo(8 * 0.15 * 155, 0);
  });

  it('開始が 4xx なら throw', async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(res({ error: 'bad' }, { ok: false, status: 400 }));
    await expect(generateVeoClip('p', {}, { apiKey: 'k', doFetch: doFetch as never, sleep })).rejects.toThrow(/veo start 400/);
  });

  it('operation が error を返したら throw', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce(res({ name: 'operations/x' }))
      .mockResolvedValueOnce(res({ error: { message: 'quota' } }));
    await expect(generateVeoClip('p', {}, { apiKey: 'k', doFetch: doFetch as never, sleep })).rejects.toThrow(/op error/);
  });

  it('APIキー未設定なら throw', async () => {
    await expect(generateVeoClip('p', {}, { apiKey: undefined, doFetch: vi.fn() as never, sleep })).rejects.toThrow(/GOOGLE_GENERATIVE_AI_API_KEY/);
  });
});
