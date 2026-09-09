/**
 * T-03-03 — Web Search アダプタ I/F (docs/03 §A-03, §R-04 / docs/05 §6.3.1).
 *
 * 設計:
 *  - Marketer は通常 `AgentSdkClient.complete()` の中で Anthropic の server tool
 *    `web_search_20250305` を直接呼ぶ (= 本ファイルの AnthropicNativeWebSearch は no-op)。
 *  - 本ファイルは「Anthropic が不調な場合や、Marketer モデルが Anthropic 以外に
 *    切り替わった場合のフォールバック」を将来 Tavily 等で行う際の共通 I/F を確定する。
 *  - 本タスクのスコープは I/F + 環境変数チェックのみ。Tavily 本実装は Phase 2 (R-04)。
 */

import { z } from 'zod';

import { ConfigError } from '@a2p/contracts/errors';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const WebSearchQuerySchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(20).default(5),
  topic: z.enum(['general', 'news']).default('general').optional(),
});
export type WebSearchQuery = z.infer<typeof WebSearchQuerySchema>;

export const WebSearchResultItemSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  /** ISO date string (RFC 3339) */
  published_at: z.string().optional(),
});
export type WebSearchResultItem = z.infer<typeof WebSearchResultItemSchema>;

export const WebSearchResultSchema = z.object({
  items: z.array(WebSearchResultItemSchema),
  provider: z.enum(['anthropic_native', 'tavily']),
  query: z.string(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export type WebSearchProvider = 'anthropic_native' | 'tavily';

export interface WebSearchAdapter {
  readonly provider: WebSearchProvider;
  search(query: WebSearchQuery): Promise<WebSearchResult>;
}

// ---------------------------------------------------------------------------
// Anthropic Native (no-op)
// ---------------------------------------------------------------------------

/**
 * Anthropic 内蔵 `web_search_20250305` 用のプレースホルダ。
 *
 * 実 web_search は `AgentSdkClient.complete()` 内で Messages API の server tool
 * として呼ばれるため、このアダプタの `search()` は常にエラーを返す。
 * Marketer 等の呼び出し側は `AgentSdkClient` を直接利用すること。
 */
export class AnthropicNativeWebSearch implements WebSearchAdapter {
  readonly provider: WebSearchProvider = 'anthropic_native';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: WebSearchQuery): Promise<WebSearchResult> {
    throw new ConfigError('web_search.anthropic_native_not_callable', {
      details: {
        reason:
          'Anthropic native web_search runs inside AgentSdkClient.complete(); use client.complete() instead.',
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Tavily (Phase 2)
// ---------------------------------------------------------------------------

export interface TavilyWebSearchOptions {
  apiKey: string;
  /** タイムアウト (ms)。既定 15s。Anthropic 純正のエージェント的ループより遥かに速い。 */
  timeoutMs?: number;
  /** 検索深度。'advanced' はより丁寧に探すが遅く高価。既定 'basic'。 */
  searchDepth?: 'basic' | 'advanced';
  /** DI: テスト用に fetch を差し替える。 */
  fetchImpl?: typeof fetch;
}

/** Tavily `/search` レスポンス (必要な部分のみ)。 */
interface TavilyApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string | null;
  }>;
  answer?: string | null;
}

/**
 * Tavily フォールバック/主検索アダプタ (docs/03 §R-04 / R-04 本実装)。
 *
 * Anthropic 純正 `web_search_20250305` は「モデルが tool_use を何度も回すエージェント的
 * ループ」で、テーマ生成 1 回に 3〜7 分かかり時々タイムアウトする。Tavily は専用検索 API
 * を **1 回の HTTP リクエスト**で叩くため数秒で返る。Marketer はこの結果を根拠として
 * 通常の LLM 補完 (server tool 無し) に注入する → 高速・安価・プロバイダ非依存。
 */
export class TavilyWebSearch implements WebSearchAdapter {
  readonly provider: WebSearchProvider = 'tavily';
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly searchDepth: 'basic' | 'advanced';
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TavilyWebSearchOptions) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.searchDepth = opts.searchDepth ?? 'basic';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(query: WebSearchQuery): Promise<WebSearchResult> {
    const parsed = WebSearchQuerySchema.parse(query);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query: parsed.query,
          max_results: parsed.maxResults,
          search_depth: this.searchDepth,
          topic: parsed.topic ?? 'general',
          include_answer: false,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ConfigError('web_search.tavily_request_failed', {
        details: {
          reason: err instanceof Error ? err.message : String(err),
          aborted: controller.signal.aborted,
        },
        cause: err,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new ConfigError('web_search.tavily_http_error', {
        details: { status: res.status, body: bodyText.slice(0, 500) },
      });
    }

    const json = (await res.json()) as TavilyApiResponse;
    const items: WebSearchResultItem[] = (json.results ?? [])
      .filter((r): r is { title: string; url: string; content?: string; published_date?: string | null } =>
        typeof r?.title === 'string' && typeof r?.url === 'string',
      )
      .map((r) => {
        const item: WebSearchResultItem = { title: r.title, url: r.url };
        if (typeof r.content === 'string' && r.content.length > 0) item.snippet = r.content;
        if (typeof r.published_date === 'string' && r.published_date.length > 0) {
          item.published_at = r.published_date;
        }
        return item;
      });

    return { items, provider: 'tavily', query: parsed.query };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateWebSearchAdapterOptions {
  provider: WebSearchProvider;
  /** Tavily を選択した場合に必須。 */
  tavilyApiKey?: string;
}

export function createWebSearchAdapter(
  opts: CreateWebSearchAdapterOptions,
): WebSearchAdapter {
  if (opts.provider === 'tavily') {
    if (!opts.tavilyApiKey || opts.tavilyApiKey.length === 0) {
      throw new ConfigError('web_search.tavily_api_key_missing', {
        details: {
          reason: 'TAVILY_API_KEY is required for tavily adapter.',
        },
      });
    }
    return new TavilyWebSearch({ apiKey: opts.tavilyApiKey });
  }
  return new AnthropicNativeWebSearch();
}
