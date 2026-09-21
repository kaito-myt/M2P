/**
 * M2P ポータル「設定」(docs/10-platform-portal.md §10.4b) — 各サービサー API キーの一元管理。
 * DB 非依存の純関数/定数をここに置き、Server Action (`app/actions/settings.ts`) と RSC/テストから共用する。
 *
 * 背景 (運営者要望 2026-09-21): 「各サービサーの API キー情報を管理できるようにして」「API 管理は全部 M2P 側に
 * 集約しよう」。A2P / ANP / worker は同じ DB (`api_credentials`) を共有し、各プロセスは
 * `@a2p/agents/lib/get-api-key` (DB 優先 → env フォールバック、60 秒 LRU) で読むため、ポータルで保存すれば
 * 1 分以内に全ツールへ反映される。AI モデル割当は役割がツールごとに異なるため各ツール側に置く
 * (運営者判断 2026-09-21)。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// API キー (サービサー)
// ---------------------------------------------------------------------------

export const API_PROVIDERS = ['anthropic', 'openai', 'google', 'tavily'] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const apiProviderSchema = z.enum(API_PROVIDERS);

export interface ApiProviderMeta {
  id: ApiProvider;
  label: string;
  description: string;
  /** キー発行ページ。 */
  consoleUrl: string;
  /** どのツール/用途で使われるか (表示用)。 */
  usedFor: string;
  /** 入力例 (先頭の形式)。 */
  keyHint: string;
}

export const API_PROVIDER_META: Record<ApiProvider, ApiProviderMeta> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: '企画・執筆・校閲・判定など主要な LLM 呼出。',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    usedFor: 'A2P 書籍パイプライン / ANP 記事パイプライン / 組織エージェント / SNS 生成',
    keyHint: 'sk-ant-…',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: '画像生成 (gpt-image) と一部の LLM 呼出 (SEO 最適化等)。',
    consoleUrl: 'https://platform.openai.com/api-keys',
    usedFor: '表紙・アイコン・カバー・IG カルーセル画像 / seo_optimizer',
    keyHint: 'sk-…',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini / Veo)',
    description: 'Gemini モデルと Veo 動画生成。',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    usedFor: 'モデル割当で google を選んだ役割 / TikTok・IG リール動画のフック生成',
    keyHint: 'AIza…',
  },
  tavily: {
    id: 'tavily',
    label: 'Tavily (Web 検索)',
    description: 'テーマ生成・AI 相談の事前リサーチ用 Web 検索。未設定なら検索無しで動く。',
    consoleUrl: 'https://app.tavily.com/home',
    usedFor: 'A2P テーマ生成の市場リサーチ / ANP アカウント戦略の AI 相談',
    keyHint: 'tvly-…',
  },
};

export const setApiKeyInput = z.object({
  provider: apiProviderSchema,
  key: z.string().trim().min(8).max(2048),
});
export const providerOnlyInput = z.object({ provider: apiProviderSchema });

/** 疎通テスト用エンドポイント (apps/web `api-credentials.ts` と同じ。公式 SDK を持ち込まない)。 */
export function providerTestRequest(provider: Exclude<ApiProvider, 'tavily'>, key: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${key}` } };
    case 'google':
      return { url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, headers: {} };
  }
}

export interface ApiKeyTestResult {
  ok: boolean;
  message: string;
  http_status?: number;
  latency_ms?: number;
}


/**
 * 各サービサーのキーを env から読むときの変数名 (`@a2p/agents/lib/get-api-key` の ENV_NAMES と
 * `get-tavily-key` に一致させる)。ポータルにも同じ env を置けば「環境変数にて設定済み」を表示でき、
 * 「DB に取り込む」で一元管理へ移行できる。
 */
export const API_PROVIDER_ENV: Record<ApiProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  tavily: 'TAVILY_API_KEY',
};

export function envKeyFor(provider: ApiProvider, env: Record<string, string | undefined> = process.env): string | null {
  const v = env[API_PROVIDER_ENV[provider]];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}
