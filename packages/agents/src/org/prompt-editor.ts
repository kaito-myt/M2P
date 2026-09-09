/**
 * F-089 — プロンプト改訂エージェント (prompt_editor)。
 *
 * CEO(ceo_chat)が起票した「対象 role のプロンプトをこう変えたい」という指示を受け、
 * 対象エージェントの現行システムプロンプト本文を **プレースホルダを厳守したまま最小改訂** し、
 * 新しい本文を返す。worker 側でこの結果を新バージョンとして安全に有効化する。
 *
 * content-creator.ts と同じく generateText + extractLlmJson で受ける（本文が長く
 * generateObject が不安定になりやすいため）。
 */
import type { LLMClient, AgentRole } from '@a2p/contracts/agents';
import {
  PromptEditorOutputSchema,
  type PromptEditorInput,
  type PromptEditorOutput,
} from '@a2p/contracts/org';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import {
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';

// プロンプト本文まるごとを返すため、途中切れしないよう大きめに確保する。
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const PROMPT_EDITOR_ROLE = 'prompt_editor' as AgentRole;

export interface PromptEditorDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  orgTaskId?: string;
}

export async function rewriteAgentPrompt(
  input: PromptEditorInput,
  deps: PromptEditorDeps = {},
): Promise<PromptEditorOutput> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(PROMPT_EDITOR_ROLE, null, deps.promptLoaderDeps);
  const systemPrompt = prompt.template;

  const ctx: LoggingContext = { role: PROMPT_EDITOR_ROLE };
  if (deps.orgTaskId !== undefined) ctx.orgTaskId = deps.orgTaskId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(PROMPT_EDITOR_ROLE, null, ctx, factoryDeps);

  const completion = await client.complete<string>({
    role: PROMPT_EDITOR_ROLE,
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildPromptEditorUserMessage(input) },
    ],
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const parsed = extractLlmJson<unknown>(completion.text);
  if (parsed === undefined) {
    throw new Error('prompt_editor: 応答から JSON を抽出できませんでした');
  }
  return PromptEditorOutputSchema.parse(parsed);
}

export function buildPromptEditorUserMessage(input: PromptEditorInput): string {
  const ph = input.placeholders.length
    ? input.placeholders.map((p) => `- ${p}`).join('\n')
    : '(なし)';
  return [
    `対象エージェント role: ${input.target_role}`,
    '',
    '【改訂指示（運営者→CEO 由来）】',
    input.instruction,
    '',
    '【この本文に必ず保持すべきプレースホルダ（1文字も変えない・削除しない）】',
    ph,
    '',
    '【対象エージェントの現行システムプロンプト（全文）】',
    '"""',
    input.current_body,
    '"""',
    '',
    '出力要件:',
    '- new_body: 改訂後のシステムプロンプト全文。改訂指示を満たす最小限の変更に留め、',
    '  元の役割・出力フォーマット契約・構造は保持する。上記プレースホルダは必ず全て残す。',
    '- rationale: 何をなぜ変えたかの簡潔な説明。',
    '- summary: 運営者向けの一言要約（例「実在の名作を必ず1冊挙げる方針を追記」）。',
    '- JSON のみを出力（マークダウンのコードフェンスや前置きは付けない）。',
  ].join('\n');
}
