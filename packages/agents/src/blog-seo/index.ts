/**
 * Blog SEO エージェント — 所有ブログ記事 (blog_posts / promotion_posts channel='blog') を
 * 公開前に検索エンジン (Google 等) 向けに SEO 再最適化する。seo-optimizer と同一パターン。
 *
 * フロー (seo_optimizer と同 6 ステップ):
 *  1. 入力 zod 検証
 *  2. `loadActivePrompt('blog_seo', null)` で active プロンプトを取得 (genre は常に null)
 *  3. プレースホルダ ({title}/{body_md}/{target_keyword}/{theme}/{book}/
 *     {current_slug}/{genre}/{category}) を差込
 *  4. `createAgentClient('blog_seo', null, ctx)` で LLMClient (withTokenLogging ラップ済) 取得
 *  5. `client.complete({ messages, maxOutputTokens })` を 1 回呼ぶ
 *  6. JSON 抽出 (`extractLlmJson`) → zod parse (`BlogSeoOutputSchema`)
 *
 * エラー方針:
 *  - JSON 抽出/parse 失敗・zod 検証失敗 → `AgentError('blog_seo.invalid_output', ...)`
 *  - LLM 呼出失敗 (ProviderError 等) はそのまま透過
 *  - active プロンプト不在 / API キー不在 → ConfigError (loadActivePrompt / createAgentClient が throw)
 *  - **本エージェントの呼出元 (blog publisher) は NON-FATAL 運用**: 失敗しても記事公開は
 *    止めない。fatal/non-fatal の判断は呼出側の責務であり、本関数自体は throw する (呼出側 try/catch)。
 *
 * DI: `deps?.createAgentClient` / `deps?.loadActivePrompt` でテスト差し替え可能。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  BlogSeoInputSchema,
  BlogSeoOutputSchema,
  type BlogSeoInput,
  type BlogSeoOutput,
} from '@a2p/contracts/agents/blog-seo';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type {
  LoggingContext,
  WithTokenLoggingDeps,
} from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

export interface BlogSeoDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  /** prompt-loader 内 Prisma 差し替え用 deps。 */
  promptLoaderDeps?: PromptLoaderDeps;
  /** factory 内 ModelAssignment / withTokenLogging 差し替え用 deps。 */
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  /** factory 内 getApiKey 差し替え (テストで env / DB を引かない)。 */
  getApiKey?: (provider: string) => Promise<string>;
}

/**
 * ブログ記事を検索エンジン向けに SEO 再最適化する (seo_title/slug/meta_description/keywords ほか)。
 *
 * @throws AgentError JSON 抽出/parse 失敗 / zod 検証失敗
 * @throws ProviderError LLM API 失敗 (透過、上位 worker でリトライ/non-fatal 処理)
 * @throws ConfigError   active プロンプト不在 / API キー不在
 */
export async function optimizeBlogSeo(
  input: BlogSeoInput,
  deps: BlogSeoDeps = {},
): Promise<BlogSeoOutput> {
  const parsedInput = BlogSeoInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  // genre は常に null (ブログ SEO は書籍ジャンルに依存しない role 既定プロンプト)。
  const prompt = await loadPrompt('blog_seo', null, deps.promptLoaderDeps);

  const systemPrompt = fillPlaceholders(prompt.template, {
    title: parsedInput.title,
    body_md: parsedInput.body_md,
    target_keyword: parsedInput.target_keyword ?? '',
    theme: parsedInput.theme ?? '',
    book: formatBook(parsedInput),
    current_slug: parsedInput.current_slug ?? '',
    genre: parsedInput.genre ?? '',
    category: parsedInput.category ?? '',
  });

  const ctx: LoggingContext = {
    role: 'blog_seo',
  };
  if (parsedInput.book_id) {
    ctx.bookId = parsedInput.book_id;
  }
  if (parsedInput.job_id) {
    ctx.jobId = parsedInput.job_id;
  }

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('blog_seo', null, ctx, factoryDeps);

  const completion = await client.complete({
    role: 'blog_seo',
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserMessage(parsedInput) },
    ],
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const rawText = completion.text;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new AgentError('blog_seo.invalid_output: empty response', {
      details: { rawText: String(rawText) },
    });
  }

  const parsedJson = extractLlmJson(rawText, hasBlogSeoShape);
  if (parsedJson === undefined) {
    throw new AgentError('blog_seo.invalid_output: failed to parse JSON', {
      details: { rawText },
    });
  }

  const validated = BlogSeoOutputSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AgentError('blog_seo.invalid_output: schema validation failed', {
      details: { rawText, issues: validated.error.issues },
      cause: validated.error,
    });
  }

  return validated.data;
}

/**
 * seo_title/slug/meta_description/keywords を持つ object か (schema-aware extractor 用 predicate)。
 */
function hasBlogSeoShape(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    typeof obj.seo_title === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.meta_description === 'string' &&
    Array.isArray(obj.keywords)
  );
}

function formatBook(input: BlogSeoInput): string {
  if (!input.book) return '(なし)';
  const parts = [input.book.title];
  if (input.book.subtitle) parts.push(input.book.subtitle);
  return parts.join(' — ');
}

export function buildUserMessage(input: BlogSeoInput): string {
  const lines = [`記事タイトル: ${input.title}`];
  if (input.target_keyword) {
    lines.push(`狙う主要キーワード: ${input.target_keyword}`);
  }
  if (input.theme) {
    lines.push(`テーマ/切り口: ${input.theme}`);
  }
  if (input.genre) {
    lines.push(`ジャンル: ${input.genre}`);
  }
  if (input.category) {
    lines.push(`カテゴリ: ${input.category}`);
  }
  if (input.book) {
    lines.push(`紹介する自社本: ${formatBook(input)}`);
  }
  if (input.current_slug) {
    lines.push(`既存 slug (尊重する): ${input.current_slug}`);
  }
  lines.push(
    '',
    '【記事本文 (Markdown)】',
    input.body_md,
    '',
    '上記のブログ記事を、検索意図の網羅・E-E-A-T・自然な見出し構成の観点で SEO 再最適化してください。',
    '本文の事実を大きく改変しないこと。',
    '',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "seo_title": string,            // 検索意図を汲んだタイトル (32全角目安)',
    '  "slug": string,                 // URL スラッグ (英小文字・数字・ハイフンのみ。既存があれば尊重)',
    '  "meta_description": string,     // メタディスクリプション (120字以内、読みたくなる)',
    '  "keywords": string[],           // 記事本文と乖離しない検索キーワード (3〜8個)',
    '  "headings_suggestion"?: string, // H2/H3 構成の改善案 (任意)',
    '  "body_md"?: string,             // 見出し最適化・内部キーワード自然配置を反映した改善版本文 (任意)',
    '  "rationale"?: string            // 何をなぜ変えたかの簡潔な説明 (任意)',
    '}',
    '',
    '**出力形式の厳格な制約**:',
    ' - 応答は **必ず単一の JSON オブジェクト** とし、seo_title/slug/meta_description/keywords を含めること',
    ' - JSON 以外のテキスト (前置きコメント、説明、```json``` フェンス等) は含めないこと',
    ' - **JSON 文字列値内では改行は必ず `\\n` でエスケープすること**',
  );
  return lines.join('\n');
}
