/**
 * docs/11-anp-design.md §3.2 F-ANP-15 — note Quality Judge (品質判定)。
 * A2P `judge/index.ts` を note 用 4 軸 (フック強度/可読性/有料転換見込み/検索流入見込み) に写像。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteJudgeInputSchema,
  NoteJudgeOutputSchema,
  type NoteJudgeInput,
  type NoteJudgeOutput,
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

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_PARSE_RETRIES = 2;
const BODY_LIMIT = 12000;

export interface JudgeNoteArticleDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasScoreBreakdown(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return typeof (parsed as Record<string, unknown>).score_breakdown === 'object';
}

/**
 * F-ANP-15 受入基準: 4 軸採点を行い NoteJudgeOutput を返す。
 * score_total はサーバ側で 4 軸均等平均 (切り捨て) に再計算する (A2P judge と同契約)。
 */
export async function judgeNoteArticle(
  input: NoteJudgeInput,
  deps: JudgeNoteArticleDeps = {},
): Promise<NoteJudgeOutput> {
  const parsedInput = NoteJudgeInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.judge', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    target_reader: parsedInput.account.target_reader ?? '(指定なし)',
  });

  const ctx: LoggingContext = { role: 'anp.judge' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.judge', null, ctx, factoryDeps);

  const userMessage = [
    `記事タイトル: ${parsedInput.title}`,
    `リード文: ${parsedInput.lead}`,
    `課金種別: ${parsedInput.paid ? `有料 (¥${parsedInput.price_jpy ?? '未設定'})` : '無料'}`,
    `想定読者: ${parsedInput.account.target_reader ?? '(指定なし)'}`,
    `本文 (先頭 ${BODY_LIMIT} 字):\n${parsedInput.body_md.slice(0, BODY_LIMIT)}`,
    '',
    '上記の note 記事を、以下 4 軸で 0-100 点で採点してください。',
    '- hook_strength: 冒頭で読者を掴めているか',
    '- readability: 短段落・リード文・構成の分かりやすさ',
    '- paid_conversion: 続きが読みたくなるか・有料ラインの位置の妥当性 (無料記事は一般的な満足度で採点)',
    '- search_inflow: タイトル/見出しが検索されやすいか',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "score_total": integer (4軸の平均・0〜100。合計ではない),',
    '  "score_breakdown": {',
    '    "hook_strength": integer,',
    '    "readability": integer,',
    '    "paid_conversion": integer,',
    '    "search_inflow": integer',
    '  },',
    '  "judge_comments": { [axis: string]: string }',
    '}',
    'JSON 以外のテキストは出力しないこと。',
  ].join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.judge',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.judge.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasScoreBreakdown);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.judge.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteJudgeOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.judge.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    const bd = validated.data.score_breakdown;
    const scoreTotal = Math.floor(
      (bd.hook_strength + bd.readability + bd.paid_conversion + bd.search_inflow) / 4,
    );

    return { ...validated.data, score_total: scoreTotal };
  }

  throw lastError ?? new AgentError('anp.judge.invalid_output: unknown failure');
}
