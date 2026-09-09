/**
 * SEO Optimizer エージェント — judge PASS 後・export 直前に KDP メタデータ
 * (description/keywords/categories) を完成原稿ベースで Amazon SEO (A9/A10) 観点から再最適化する。
 *
 * フロー (judge / cost_optimizer と同パターン):
 *  1. 入力 zod 検証
 *  2. `loadActivePrompt('seo_optimizer', genre)` で active プロンプトを取得
 *  3. プレースホルダ ({genre}/{title}/{subtitle}/{target_reader}/{hook}/
 *     {current_keywords}/{current_categories}/{current_description}/{chapter_digest}) を差込
 *  4. `createAgentClient('seo_optimizer', genre, ctx)` で LLMClient (withTokenLogging ラップ済) 取得
 *  5. `client.complete({ messages, maxOutputTokens: 4096 })` を 1 回呼ぶ
 *  6. JSON 抽出 (`extractLlmJson`) → zod parse (`SeoOptimizerOutputSchema`)
 *
 * エラー方針:
 *  - JSON 抽出/parse 失敗・zod 検証失敗 → `AgentError('seo_optimizer.invalid_output', { rawText, cause })`
 *  - LLM 呼出失敗 (ProviderError 等) はそのまま透過
 *  - active プロンプト不在 / API キー不在 → ConfigError (loadActivePrompt / createAgentClient が throw)
 *  - **本エージェントの呼出元 (pipeline.book.seo タスク) は NON-FATAL 運用**: 失敗しても
 *    export へは必ず進む (書籍が SEO 失敗で滞留しないため)。fatal/non-fatal の判断は
 *    worker タスク側の責務であり、本関数自体は throw する (呼出側 try/catch)。
 *
 * DI: `deps?.createAgentClient` / `deps?.loadActivePrompt` でテスト差し替え可能。
 */
import { genreLabel } from '@a2p/contracts/agents';
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  SeoOptimizerInputSchema,
  SeoOptimizerOutputSchema,
  type SeoOptimizerInput,
  type SeoOptimizerOutput,
} from '@a2p/contracts/agents/seo-optimizer';

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

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface SeoOptimizerDeps {
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
 * 完成原稿を踏まえ KDP メタデータ (description/keywords/categories) を SEO 観点で再最適化する。
 *
 * @throws AgentError JSON 抽出/parse 失敗 / zod 検証失敗
 * @throws ProviderError LLM API 失敗 (透過、上位 worker でリトライ/non-fatal 処理)
 * @throws ConfigError   active プロンプト不在 / API キー不在
 */
export async function optimizeSeo(
  input: SeoOptimizerInput,
  deps: SeoOptimizerDeps = {},
): Promise<SeoOptimizerOutput> {
  const parsedInput = SeoOptimizerInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(
    'seo_optimizer',
    parsedInput.genre,
    deps.promptLoaderDeps,
  );

  const systemPrompt = fillPlaceholders(prompt.template, {
    genre: genreLabel(parsedInput.genre) ?? 'general',
    title: parsedInput.title,
    subtitle: parsedInput.subtitle ?? '',
    target_reader: parsedInput.target_reader,
    hook: parsedInput.hook ?? '',
    current_keywords: parsedInput.current_metadata.keywords.join(', '),
    current_categories: parsedInput.current_metadata.categories.join(', '),
    current_description: parsedInput.current_metadata.description,
    chapter_digest: parsedInput.chapter_digest,
  });

  const ctx: LoggingContext = {
    role: 'seo_optimizer',
    bookId: parsedInput.book_id,
  };
  if (parsedInput.job_id) {
    ctx.jobId = parsedInput.job_id;
  }

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(
    'seo_optimizer',
    parsedInput.genre,
    ctx,
    factoryDeps,
  );

  const completion = await client.complete({
    role: 'seo_optimizer',
    genre: parsedInput.genre,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserMessage(parsedInput) },
    ],
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const rawText = completion.text;
  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    throw new AgentError('seo_optimizer.invalid_output: empty response', {
      details: { rawText: String(rawText) },
    });
  }

  const parsedJson = extractLlmJson(rawText, hasSeoOptimizerShape);
  if (parsedJson === undefined) {
    throw new AgentError('seo_optimizer.invalid_output: failed to parse JSON', {
      details: { rawText },
    });
  }

  const validated = SeoOptimizerOutputSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new AgentError('seo_optimizer.invalid_output: schema validation failed', {
      details: { rawText, issues: validated.error.issues },
      cause: validated.error,
    });
  }

  return validated.data;
}

/**
 * description/keywords/categories を持つ object か (schema-aware extractor 用 predicate)。
 */
function hasSeoOptimizerShape(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    typeof obj.description === 'string' &&
    Array.isArray(obj.keywords) &&
    Array.isArray(obj.categories)
  );
}

export function buildUserMessage(input: SeoOptimizerInput): string {
  const lines = [`書籍タイトル: ${input.title}`];
  if (input.subtitle) {
    lines.push(`副題: ${input.subtitle}`);
  }
  lines.push(
    `想定読者: ${input.target_reader}`,
    `ジャンル: ${genreLabel(input.genre) ?? 'general'}`,
  );
  if (input.hook) {
    lines.push(`差別化フック: ${input.hook}`);
  }
  lines.push(
    '',
    '【現行の KDP メタデータ】',
    `description: ${input.current_metadata.description}`,
    `keywords: ${input.current_metadata.keywords.join(', ') || '(なし)'}`,
    `categories: ${input.current_metadata.categories.join(', ') || '(なし)'}`,
    '',
    '【完成原稿ダイジェスト (アウトライン/見出し要約)】',
    input.chapter_digest,
    '',
    '上記の完成原稿を踏まえ、KDP メタデータを Amazon SEO (A9/A10) 観点で再最適化してください。',
    '',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "description": string,           // 商品説明 (4000字以内)',
    '  "keywords": string[],            // バックエンド検索キーワード (最大7個、各1〜50字)',
    '  "categories": string[],          // KDP カテゴリ (ちょうど2個)',
    '  "title_suggestion"?: string,     // タイトル改善案 (任意、本体は変更しない)',
    '  "subtitle_suggestion"?: string,  // 副題改善案 (任意、本体は変更しない)',
    '  "rationale"?: string             // 何をなぜ変えたかの簡潔な説明 (任意)',
    '}',
    '',
    '**出力形式の厳格な制約**:',
    ' - 応答は **必ず単一の JSON オブジェクト** とし、description/keywords/categories を含めること',
    ' - JSON 以外のテキスト (前置きコメント、説明、```json``` フェンス等) は含めないこと',
    ' - **JSON 文字列値内では改行は必ず `\\n` でエスケープすること**',
  );
  return lines.join('\n');
}
