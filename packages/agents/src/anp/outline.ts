/**
 * docs/11-anp-design.md §3.2 F-ANP-11 — note Writer (構成生成)。
 * A2P `writer/outline.ts` を note 用に短尺化した写像。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteOutlineInputSchema,
  NoteOutlineOutputSchema,
  type NoteOutlineInput,
  type NoteOutlineOutput,
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
import { dataSourceLines, editorialPolicyLines } from './account-context.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_PARSE_RETRIES = 2;

export interface GenerateNoteOutlineDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasHeadings(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return Array.isArray((parsed as Record<string, unknown>).headings);
}

export async function generateNoteOutline(
  input: NoteOutlineInput,
  deps: GenerateNoteOutlineDeps = {},
): Promise<NoteOutlineOutput> {
  const parsedInput = NoteOutlineInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.outline', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    target_reader: parsedInput.account.target_reader ?? '(指定なし)',
    tone: parsedInput.account.tone ?? '(指定なし)',
    theme_title: parsedInput.theme.title,
    theme_hook: parsedInput.theme.hook,
    paid: parsedInput.paid ? '有料記事 (無料パート+続きは有料)' : '無料記事',
    target_chars: parsedInput.target_chars,
    feedback: (parsedInput.feedback ?? []).map((f) => `- ${f}`).join('\n'),
  });

  const ctx: LoggingContext = { role: 'anp.outline' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.outline', null, ctx, factoryDeps);

  const lines = [
    `記事タイトル: ${parsedInput.theme.title}`,
    `差別化フック: ${parsedInput.theme.hook}`,
    `想定読者: ${parsedInput.theme.target_reader ?? parsedInput.account.target_reader ?? '(指定なし)'}`,
    `課金種別: ${parsedInput.paid ? '有料 (無料パートの後に続きは有料)' : '無料'}`,
    `目標文字数: ${parsedInput.target_chars} 字`,
    ...editorialPolicyLines(parsedInput.account),
    ...dataSourceLines(parsedInput.account),
    '',
    '上記の記事の「リード文」と「見出し構成」を設計してください。',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "lead": string,          // 冒頭リード文 (読者の悩みを言い当て続きを読みたくさせる)',
    '  "headings": string[]     // 見出し (2〜12 個、上から順)',
    '}',
  ];

  // 差し戻しで戻ってきた場合の指摘。**出力形式より後ろ**に置く — 前に置くと
  // 既定の設計指示に埋もれて効かない (theme/strategist で 4 度確認した位置の問題)。
  // JSON 以外を出力させない最後の一行だけは、パースを守るためこの後に残す。
  if (parsedInput.feedback && parsedInput.feedback.length > 0) {
    lines.push(
      '',
      '【この記事は品質判定で不合格になり、構成からやり直している — 指摘は必ず直す】',
      parsedInput.feedback.map((f) => `- ${f}`).join('\n'),
      '上の指摘は前回の「構成・切り口」に対するものである。見出しの言い換えで済ませず、' +
        '扱う論点・順序・具体性の持たせ方を変えること。',
    );
    if (parsedInput.previous_lead) {
      lines.push(
        `前回のリード文 (同じ入り方を繰り返さない): ${parsedInput.previous_lead}`,
      );
    }
  }

  lines.push('JSON 以外のテキストは出力しないこと。');
  const userMessage = lines.join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.outline',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.outline.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasHeadings);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.outline.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteOutlineOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.outline.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    return validated.data;
  }

  throw lastError ?? new AgentError('anp.outline.invalid_output: unknown failure');
}
