/**
 * [F-084] Veo 3.1 動画クリップ生成（TikTok/IGリールのフック実写級素材）。
 *
 * Gemini API の Veo 3.1 (predictLongRunning) で 9:16 の短尺クリップを生成する。
 * ハイブリッド構成のため既定は fast ティア・冒頭フックのみ（1本あたりのコストを抑える）。
 * 非同期ジョブ: 生成開始 → operation を10秒間隔でポーリング → 完了後に video.uri をDL。
 *
 * コストは token_usage(provider='google', role='veo_video') に概算で記録する。
 */
import { createLogger, type Logger } from '@a2p/contracts/logger';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type VeoTier = 'fast' | 'lite' | 'standard';

const MODEL_BY_TIER: Record<VeoTier, string> = {
  fast: 'veo-3.1-fast-generate-preview',
  lite: 'veo-3.1-lite-generate-preview',
  standard: 'veo-3.1-generate-preview',
};

/** 概算 USD/秒（ティア別）。厳密な課金は Google 側。コスト可観測性のための目安。 */
const USD_PER_SEC: Record<VeoTier, number> = { fast: 0.15, lite: 0.1, standard: 0.4 };
const FX_JPY = 155;

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface VeoClipDeps {
  apiKey?: string;
  logger?: Logger;
  doFetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  logCost?: (seconds: number, model: string, costJpy: number) => Promise<void>;
  /** ポーリング最大回数（既定 60 = 約10分）。 */
  maxPolls?: number;
}

export interface VeoClipOptions {
  tier?: VeoTier;
  seconds?: number;
}

async function defaultLogCost(seconds: number, model: string, costJpy: number): Promise<void> {
  try {
    const { prisma } = await import('@a2p/db');
    await prisma.tokenUsage.create({
      data: {
        book_id: null,
        theme_session_id: null,
        job_id: null,
        provider: 'google',
        model,
        role: 'veo_video',
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        image_count: 0,
        unit_price_snapshot: { veo_seconds: seconds, fx_rate_usd_jpy: FX_JPY },
        cost_jpy: costJpy,
      },
    });
  } catch {
    /* コスト記録失敗は生成を止めない */
  }
}

/**
 * Veo 3.1 で 9:16 クリップを生成し mp4 Buffer を返す。失敗時は throw（呼び出し側で
 * 画像スライドへフォールバックする想定）。
 */
export async function generateVeoClip(
  prompt: string,
  opts: VeoClipOptions = {},
  deps: VeoClipDeps = {},
): Promise<Buffer> {
  const log = deps.logger ?? createLogger('worker.promotion.veo-clip');
  const apiKey = deps.apiKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY 未設定 — Veo 生成不可');
  const doFetch = (deps.doFetch ?? (globalThis.fetch as unknown)) as FetchLike;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const logCost = deps.logCost ?? defaultLogCost;
  const maxPolls = deps.maxPolls ?? 60;
  const tier: VeoTier = opts.tier ?? 'fast';
  const model = MODEL_BY_TIER[tier];
  const seconds = opts.seconds ?? 8;

  // 1. 生成開始（long-running）。
  const startRes = await doFetch(`${BASE}/models/${model}:predictLongRunning`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: '9:16', resolution: '720p', personGeneration: 'allow_all', durationSeconds: seconds },
    }),
  });
  if (!startRes.ok) {
    throw new Error(`veo start ${startRes.status}: ${(await startRes.text().catch(() => '')).slice(0, 300)}`);
  }
  const startJson = (await startRes.json()) as { name?: string };
  const opName = startJson.name;
  if (!opName) throw new Error('veo: operation name が返らなかった');

  // 2. ポーリング（10秒間隔）。
  let uri: string | undefined;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(10_000);
    const pr = await doFetch(`${BASE}/${opName}`, { headers: { 'x-goog-api-key': apiKey } });
    const pj = (await pr.json()) as {
      done?: boolean;
      error?: unknown;
      response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } };
    };
    if (pj.error) throw new Error(`veo op error: ${JSON.stringify(pj.error).slice(0, 300)}`);
    if (pj.done) {
      uri = pj.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      break;
    }
  }
  if (!uri) throw new Error('veo: タイムアウト or video.uri 取得失敗');

  // 3. mp4 をDL。
  const dl = await doFetch(uri, { headers: { 'x-goog-api-key': apiKey } });
  if (!dl.ok) throw new Error(`veo download ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.byteLength < 1000) throw new Error(`veo download too small (${buf.byteLength} bytes)`);

  const costJpy = Math.round(seconds * USD_PER_SEC[tier] * FX_JPY * 100) / 100;
  await logCost(seconds, model, costJpy).catch(() => {});
  log.info({ model, seconds, bytes: buf.byteLength, costJpy }, 'veo clip generated');
  return buf;
}
