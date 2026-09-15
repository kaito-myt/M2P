/**
 * docs/11-anp-design.md §3.2 F-ANP-10 — note Marketer (テーマ候補生成)。
 * A2P `marketer/theme.ts` を note 用に簡略化した写像 (Phase 1 では web_search は使わず、
 * アカウントのニッチ/トーン/直近タイトルのみを入力にする)。
 *
 * フロー:
 *  1. `loadActivePrompt('anp.theme', null)` で active プロンプト取得
 *  2. プレースホルダ ({niche}/{target_reader}/{tone}/{count}/{exclude_titles}) 差込
 *  3. `createAgentClient('anp.theme', null, ctx)` で LLMClient 取得
 *  4. `client.complete()` → JSON 抽出 → zod 検証 (invalid_output なら最大 2 回まで再試行)
 *
 * エラー方針: A2P marketer/theme.ts と同型 (AgentError / ProviderError 透過 / ConfigError)。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteThemeInputSchema,
  NoteThemeOutputSchema,
  type NoteThemeInput,
  type NoteThemeOutput,
} from '@a2p/contracts/agents/anp';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';
import { extractJson } from './lib/extract-json.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_PARSE_RETRIES = 2;

export interface GenerateNoteThemesDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasCandidates(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return Array.isArray((parsed as Record<string, unknown>).candidates);
}

export async function generateNoteThemes(
  input: NoteThemeInput,
  deps: GenerateNoteThemesDeps = {},
): Promise<NoteThemeOutput> {
  const parsedInput = NoteThemeInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.theme', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    target_reader: parsedInput.account.target_reader ?? '(指定なし)',
    tone: parsedInput.account.tone ?? '(指定なし)',
    count: parsedInput.count,
    exclude_titles:
      parsedInput.exclude_titles_recent.length > 0
        ? parsedInput.exclude_titles_recent.map((t) => ` - ${t}`).join('\n')
        : '(なし)',
  });

  const ctx: LoggingContext = { role: 'anp.theme' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.theme', null, ctx, factoryDeps);

  const userMessage = [
    `note アカウントのニッチ: ${parsedInput.account.niche}`,
    `想定読者: ${parsedInput.account.target_reader ?? '(指定なし)'}`,
    `トーン: ${parsedInput.account.tone ?? '(指定なし)'}`,
    `件数: ${parsedInput.count}`,
    parsedInput.exclude_titles_recent.length > 0
      ? `除外 (直近採用済タイトル):\n${parsedInput.exclude_titles_recent.map((t) => ` - ${t}`).join('\n')}`
      : '',
    '',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "candidates": [',
    '    {',
    '      "title": string,',
    '      "hook": string,',
    '      "target_reader": string,',
    '      "recommend_paid": boolean,',
    '      "suggested_price": integer,',
    '      "competitors": string[],',
    '      "genre": string',
    '    }',
    '  ]',
    '}',
    'JSON 以外のテキストは出力しないこと。',
  ]
    .filter((l) => l !== '')
    .join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.theme',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.theme.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasCandidates);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.theme.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteThemeOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.theme.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    return validated.data;
  }

  throw lastError ?? new AgentError('anp.theme.invalid_output: unknown failure');
}
