/**
 * Google Gemini 画像生成 (Nano Banana 2 = `gemini-3.1-flash-image`) のラッパ。
 *
 * docs/03 §C-07 / docs/11 §3.2 F-ANP-41。OpenAI 版 (`image-gen.ts`) と同じ
 * `GenerateImageFn` シグネチャを満たすので、`withImageLogging` でそのまま包める。
 *
 * 設計:
 *  - Gemini の画像生成は `generateContent` の responseModalities=['IMAGE'] で行い、
 *    アスペクト比は `generationConfig.imageConfig.aspectRatio` で指定する
 *    (px 指定ではないため、幅/高さは最も近い公式アスペクト比へ丸める)。
 *  - 返却は inlineData(base64)。mimeType は image/jpeg または image/png。
 *  - 課金はトークン制 (画像は出力トークンとして計上される) なので、usage に
 *    inputTokens/outputTokens も載せて `withImageLogging` がトークン単価で
 *    コストを算出できるようにする (OpenAI は 1 枚いくら、Google は 1 トークンいくら)。
 *  - リトライ方針は OpenAI 版と対称 (429×3 / 5xx×2 / 4xx 即時打切 / network×2)。
 */
import pRetry, { AbortError } from 'p-retry';

import { ConfigError, ProviderError } from '@a2p/contracts/errors';

import { classifyProviderError, isNonRetryable } from '../lib/errors.js';
import { getApiKey } from '../lib/get-api-key.js';
import type { GenerateImageArgs, GenerateImageResult } from './image-gen.js';

const PROVIDER = 'google';

/** 既定の画像モデル (Nano Banana 2)。env `GOOGLE_IMAGE_MODEL` で上書き可。 */
export const GOOGLE_IMAGE_MODEL =
  process.env.GOOGLE_IMAGE_MODEL?.trim() || 'gemini-3.1-flash-image';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Gemini がサポートするアスペクト比 (幅/高さ の比率で最も近いものを選ぶ)。 */
const ASPECT_RATIOS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: '1:1', ratio: 1 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '21:9', ratio: 21 / 9 },
];

/** 幅/高さ → 最も近い公式アスペクト比ラベル。 */
export function normalizeAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new ConfigError(
      `generateImageGoogle: invalid size ${String(width)}x${String(height)}`,
    );
  }
  const target = width / height;
  let best = ASPECT_RATIOS[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const cand of ASPECT_RATIOS) {
    const diff = Math.abs(cand.ratio - target);
    if (diff < bestDiff) {
      best = cand;
      bestDiff = diff;
    }
  }
  return best.label;
}

interface GeminiPart {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

export interface GoogleImageGenDeps {
  /** API キー解決 (既定: `getApiKey('google')`)。 */
  getApiKey?: () => Promise<string>;
  /** fetch 差し替え (テスト用)。 */
  fetchImpl?: typeof fetch;
  /** モデル上書き (既定: 割当 or GOOGLE_IMAGE_MODEL)。 */
  model?: string;
}

const RATE_LIMIT_ATTEMPTS = 3;
const SERVER_ERROR_ATTEMPTS = 2;
const NETWORK_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;

function attemptsFor(kind: ReturnType<typeof classifyProviderError>['kind']): number {
  switch (kind) {
    case 'rate_limit':
      return RATE_LIMIT_ATTEMPTS;
    case 'server_error':
      return SERVER_ERROR_ATTEMPTS;
    case 'network':
      return NETWORK_ATTEMPTS;
    case 'client_error':
      return 1;
    default:
      return NETWORK_ATTEMPTS;
  }
}

/**
 * Gemini (Nano Banana 2) で画像を生成する。
 *
 * @throws ConfigError  入力検証エラー
 * @throws ProviderError API エラー (リトライ後)
 */
export async function generateImageGoogle(
  args: GenerateImageArgs,
  deps: GoogleImageGenDeps = {},
): Promise<GenerateImageResult> {
  if (!args.prompt || args.prompt.trim().length === 0) {
    throw new ConfigError('generateImageGoogle: prompt is required');
  }
  const count = args.count ?? 1;
  if (!Number.isInteger(count) || count <= 0) {
    throw new ConfigError(
      `generateImageGoogle: count must be a positive integer (got ${String(count)})`,
    );
  }
  const aspectRatio = normalizeAspectRatio(args.width, args.height);
  const model = deps.model ?? GOOGLE_IMAGE_MODEL;
  const apiKey = await (deps.getApiKey ?? (() => getApiKey('google')))();
  const doFetch = deps.fetchImpl ?? fetch;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
      ...(count > 1 ? { candidateCount: count } : {}),
    },
  });

  let lastKind: ReturnType<typeof classifyProviderError>['kind'] = 'unknown';
  const run = async (): Promise<GeminiResponse> => {
    let res: Response;
    try {
      res = await doFetch(`${API_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (err) {
      const classified = classifyProviderError(err);
      lastKind = classified.kind;
      throw new ProviderError(`${PROVIDER} generateContent failed: ${classified.message}`, {
        retryable: true,
        cause: err,
        details: { kind: classified.kind },
      });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const classified = classifyProviderError({ status: res.status, message: text.slice(0, 300) });
      lastKind = classified.kind;
      const error = new ProviderError(
        `${PROVIDER} generateContent ${String(res.status)}: ${text.slice(0, 200)}`,
        { retryable: !isNonRetryable(classified.kind), details: { status: res.status, kind: classified.kind } },
      );
      if (isNonRetryable(classified.kind)) throw new AbortError(error);
      throw error;
    }
    return (await res.json()) as GeminiResponse;
  };

  const json = await pRetry(run, {
    retries: Math.max(RATE_LIMIT_ATTEMPTS, SERVER_ERROR_ATTEMPTS, NETWORK_ATTEMPTS) - 1,
    minTimeout: BACKOFF_BASE_MS,
    maxTimeout: BACKOFF_MAX_MS,
    factor: 2,
    shouldRetry: (err) => {
      void err;
      return attemptsFor(lastKind) > 1;
    },
  });

  if (json.error) {
    throw new ProviderError(`${PROVIDER} generateContent error: ${json.error.message ?? ''}`, {
      retryable: false,
      details: { status: json.error.code },
    });
  }

  const images: Buffer[] = [];
  for (const cand of json.candidates ?? []) {
    for (const part of cand.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (typeof data === 'string' && data.length > 0) images.push(Buffer.from(data, 'base64'));
    }
  }
  if (images.length === 0) {
    throw new ProviderError(`${PROVIDER} generateContent returned no image`, {
      retryable: false,
      details: { finishReason: json.candidates?.[0]?.finishReason ?? null },
    });
  }

  return {
    images,
    costJpy: 0,
    usage: {
      imageCount: images.length,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
