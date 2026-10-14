/**
 * Meshy クライアントのテスト (docs/12 §4.1)。
 *
 * API キーを持たずに **失敗系まで**検証できるよう fetch を注入する。
 * 特に押さえたいのは「credit を無駄に払わない」こと:
 *  - ポーリング上限で諦めるときに**投げ直させない** (同じ task id で再開させる)
 *  - refine (テクスチャ) を preview の id 無しで投げさせない
 *  - credit 切れ (402) をリトライ可能として扱わない
 */
import { describe, expect, it, vi } from 'vitest';

import {
  MeshyClient,
  MeshyError,
  PROP_NEGATIVE_PROMPT,
  buildPropPromptSuffix,
  type MeshyTask,
} from '../src/meshy.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new MeshyClient({
    apiKey: 'test-key',
    fetchImpl,
    pollIntervalMs: 0,
    sleep: async () => {},
    ...over,
  });
}

describe('MeshyClient — タスク作成', () => {
  it('preview はプロンプトとポリゴン上限を送り、task id を返す', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ result: 'task-123' });
    }) as unknown as typeof fetch;

    const id = await client(f).createTextTo3d({
      prompt: 'wooden dining chair',
      mode: 'preview',
      targetPolycount: 8000,
      negativePrompt: PROP_NEGATIVE_PROMPT,
    });

    expect(id).toBe('task-123');
    expect(calls[0]!.url).toContain('/openapi/v2/text-to-3d');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body).toMatchObject({
      mode: 'preview',
      prompt: 'wooden dining chair',
      target_polycount: 8000,
    });
    expect(body.negative_prompt).toContain('pedestal');
    // 認証ヘッダ
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('refine は preview タスク id が無いと投げない (credit の無駄を防ぐ)', async () => {
    const f = vi.fn(async () => jsonResponse({ result: 'x' })) as unknown as typeof fetch;
    await expect(
      client(f).createTextTo3d({ prompt: 'x', mode: 'refine' }),
    ).rejects.toBeInstanceOf(MeshyError);
    expect(f).not.toHaveBeenCalled();
  });

  it('refine は preview_task_id だけを送る (プロンプトは送らない)', async () => {
    const calls: RequestInit[] = [];
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      calls.push(init!);
      return jsonResponse({ result: 'task-refine' });
    }) as unknown as typeof fetch;

    await client(f).createTextTo3d({ prompt: 'ignored', mode: 'refine', previewTaskId: 'task-123' });
    const body = JSON.parse(String(calls[0]!.body));
    expect(body).toEqual({ mode: 'refine', preview_task_id: 'task-123' });
  });

  it('task id が返らなければエラー', async () => {
    const f = vi.fn(async () => jsonResponse({ nope: true })) as unknown as typeof fetch;
    await expect(
      client(f).createTextTo3d({ prompt: 'x', mode: 'preview' }),
    ).rejects.toThrow(/タスク id/);
  });

  it('API キーが空ならコンストラクタで弾く', () => {
    expect(() => new MeshyClient({ apiKey: '' })).toThrow(MeshyError);
  });
});

describe('MeshyClient — ポーリング', () => {
  it('SUCCEEDED になるまで待って結果を返す', async () => {
    const states: MeshyTask[] = [
      { id: 't', status: 'PENDING', progress: 0 },
      { id: 't', status: 'IN_PROGRESS', progress: 40 },
      { id: 't', status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'https://cdn/x.glb' } },
    ];
    let i = 0;
    const f = vi.fn(async () => jsonResponse(states[Math.min(i++, states.length - 1)])) as unknown as typeof fetch;

    const seen: number[] = [];
    const task = await client(f).waitForTask('t', (x) => seen.push(x.progress));
    expect(task.status).toBe('SUCCEEDED');
    expect(task.model_urls?.glb).toBe('https://cdn/x.glb');
    expect(seen).toEqual([0, 40, 100]);
  });

  it('FAILED は理由を添えて即エラー (待ち続けない)', async () => {
    const f = vi.fn(async () =>
      jsonResponse({ id: 't', status: 'FAILED', progress: 0, task_error: { message: 'bad prompt' } }),
    ) as unknown as typeof fetch;
    await expect(client(f).waitForTask('t')).rejects.toThrow(/FAILED.*bad prompt/);
  });

  it('CANCELED も即エラー', async () => {
    const f = vi.fn(async () => jsonResponse({ id: 't', status: 'CANCELED', progress: 0 })) as unknown as typeof fetch;
    await expect(client(f).waitForTask('t')).rejects.toThrow(/CANCELED/);
  });

  it('上限で諦めるとき retryable=true にし、投げ直させない旨をメッセージに残す', async () => {
    // ここが credit 保護の要: 上位が「新しいタスクを投げ直す」実装にならないよう、
    // 同じ task_id で再開することをエラー文に明記する。
    const f = vi.fn(async () => jsonResponse({ id: 't', status: 'IN_PROGRESS', progress: 10 })) as unknown as typeof fetch;
    const c = client(f, { maxPolls: 3 });
    const err = await c.waitForTask('t').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeshyError);
    expect((err as MeshyError).retryable).toBe(true);
    expect((err as MeshyError).message).toContain('同じ task_id で再開');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('status の無い応答はエラーにする (黙って成功扱いしない)', async () => {
    const f = vi.fn(async () => jsonResponse({ id: 't' })) as unknown as typeof fetch;
    await expect(client(f).getTask('t')).rejects.toThrow(/不正/);
  });
});

describe('MeshyClient — エラーの扱い', () => {
  it('5xx と 429 は retryable', async () => {
    for (const status of [500, 502, 503, 429]) {
      const f = vi.fn(async () => new Response('oops', { status })) as unknown as typeof fetch;
      const err = await client(f)
        .createTextTo3d({ prompt: 'x', mode: 'preview' })
        .catch((e: unknown) => e);
      expect((err as MeshyError).retryable, `status=${status}`).toBe(true);
    }
  });

  it('402 (credit 切れ) と 4xx は retryable にしない (リトライしても無駄)', async () => {
    for (const status of [400, 401, 402, 403, 404]) {
      const f = vi.fn(async () => new Response('nope', { status })) as unknown as typeof fetch;
      const err = await client(f)
        .createTextTo3d({ prompt: 'x', mode: 'preview' })
        .catch((e: unknown) => e);
      expect((err as MeshyError).retryable, `status=${status}`).toBe(false);
      expect((err as MeshyError).status).toBe(status);
    }
  });

  it('JSON でない応答はエラー', async () => {
    const f = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(client(f).createTextTo3d({ prompt: 'x', mode: 'preview' })).rejects.toThrow(/JSON/);
  });
});

describe('MeshyClient — GLB のダウンロード', () => {
  it('GLB を取得する', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const f = vi.fn(async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch;
    const out = await client(f).downloadGlb({
      id: 't',
      status: 'SUCCEEDED',
      progress: 100,
      model_urls: { glb: 'https://cdn/x.glb' },
    });
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });

  it('GLB の URL が無ければエラー (fbx だけ返ってくることがある)', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    await expect(
      client(f).downloadGlb({ id: 't', status: 'SUCCEEDED', progress: 100, model_urls: { fbx: 'u' } }),
    ).rejects.toThrow(/GLB の URL/);
  });

  it('空の GLB はエラー (0 バイトを商品にしない)', async () => {
    const f = vi.fn(async () => new Response(new Uint8Array(), { status: 200 })) as unknown as typeof fetch;
    await expect(
      client(f).downloadGlb({ id: 't', status: 'SUCCEEDED', progress: 100, model_urls: { glb: 'u' } }),
    ).rejects.toThrow(/空/);
  });
});

describe('プロンプトの定型制約', () => {
  it('台座・地面・文字・複数オブジェクトを出さないよう指定している', () => {
    // AI 3D は指示しないと台座や地面を勝手に付ける。小物商材では致命的。
    for (const w of ['pedestal', 'ground plane', 'text', 'watermark', 'multiple objects']) {
      expect(PROP_NEGATIVE_PROMPT).toContain(w);
    }
  });

  it('裏側と底面まで作らせる / 向きとスケールの前提を揃える', () => {
    const s = buildPropPromptSuffix({ approxSizeMeters: 0.9 });
    expect(s).toContain('no pedestal');
    expect(s).toContain('including the back and bottom');
    expect(s).toContain('Y axis up');
    expect(s).toContain('0.9 meters');
  });

  it('寸法未指定なら寸法の行を出さない', () => {
    expect(buildPropPromptSuffix({})).not.toContain('meters');
  });
});
