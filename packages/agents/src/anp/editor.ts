/**
 * docs/11-anp-design.md §3.2 F-ANP-13 — note Editor (校閲)。
 * A2P `editor/index.ts` を note 用に写像。note の可読性 (短段落・リード文) に最適化する。
 *
 * 有料記事のペイウォール位置保持: 呼出側が `paywall_line_pos` を渡した場合、本文に
 * `PAYWALL_MARKER` を再挿入した上で LLM に渡し、「マーカー行はそのまま保持して」と
 * 指示する。LLM 出力からマーカー位置を再抽出し、校閲後の新しい `paywall_line_pos` を返す。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteEditorInputSchema,
  NoteEditorOutputSchema,
  type NoteEditorInput,
  type NoteEditorOutput,
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
import { PAYWALL_MARKER, splitPaywallMarker } from './writer.js';
import { editorialPolicyLines } from './account-context.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_PARSE_RETRIES = 2;

export interface EditNoteArticleResult extends NoteEditorOutput {
  /** 校閲後の新しいペイウォール位置 (paid かつマーカーを検出できた場合のみ)。 */
  paywall_line_pos?: number;
}

export interface EditNoteArticleDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasBodyMd(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return typeof (parsed as Record<string, unknown>).body_md === 'string';
}

/**
 * 校閲前の本文にマーカーを再挿入する (paid かつ位置指定がある場合のみ)。
 * `splitPaywallMarker` との往復整合性をテストできるよう export する。
 */
export function insertMarker(bodyMd: string, paid: boolean, pos: number | undefined): string {
  if (!paid || pos === undefined) return bodyMd;
  const chars = [...bodyMd];
  if (pos < 0 || pos > chars.length) return bodyMd;
  return `${chars.slice(0, pos).join('')}\n\n${PAYWALL_MARKER}\n\n${chars.slice(pos).join('')}`;
}

export async function editNoteArticle(
  input: NoteEditorInput,
  deps: EditNoteArticleDeps = {},
): Promise<EditNoteArticleResult> {
  const parsedInput = NoteEditorInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.editor', null, deps.promptLoaderDeps);
  const bodyWithMarker = insertMarker(
    parsedInput.body_md,
    parsedInput.paid,
    parsedInput.paywall_line_pos,
  );
  const hasMarker = bodyWithMarker.includes(PAYWALL_MARKER);

  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    tone: parsedInput.account.tone ?? '(指定なし)',
    title: parsedInput.title,
    paid: parsedInput.paid ? 'yes' : 'no',
    feedback: (parsedInput.feedback ?? []).map((f) => `- ${f}`).join('\n'),
  });

  const ctx: LoggingContext = { role: 'anp.editor' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.editor', null, ctx, factoryDeps);

  const lines = [
    `記事タイトル: ${parsedInput.title}`,
    `現在のリード文: ${parsedInput.lead}`,
    `現在の本文 (Markdown):\n${bodyWithMarker}`,
    ...editorialPolicyLines(parsedInput.account),
  ];
  if (hasMarker) {
    lines.push(
      `本文中の ${PAYWALL_MARKER} は有料ラインの区切りマーカーです。校閲後も単独行のまま必ず1回だけ残してください` +
        ' (前後の文脈は自然に整えて構いませんが、マーカー文字列自体に太字記法 `**` などの装飾を付けないこと)。',
    );
  }
  if (parsedInput.feedback && parsedInput.feedback.length > 0) {
    lines.push('', '【修正コメント — 必ず反映】', parsedInput.feedback.map((f) => `- ${f}`).join('\n'));
  }
  lines.push(
    '',
    '上記を note の読みやすさ (短段落・リード文の訴求力・誤字脱字・冗長表現の除去) の観点で校閲してください。',
    '見出し構成・段落の意味内容は保持し、文体・読みやすさのみ磨くこと。',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "lead": string,',
    '  "body_md": string',
    '}',
    'JSON 以外のテキストは出力しないこと。JSON 文字列値内の改行は必ず \\n でエスケープすること。',
  );
  const userMessage = lines.join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.editor',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      enablePromptCaching: true,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.editor.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasBodyMd);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.editor.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteEditorOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.editor.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    if (!hasMarker) {
      return { lead: validated.data.lead, body_md: validated.data.body_md };
    }

    const { body, paywallLinePos } = splitPaywallMarker(validated.data.body_md, true);
    if (paywallLinePos === undefined) {
      // マーカーを保持するよう指示したのに LLM が出力から落とした — invalid_output として再試行。
      lastError = new AgentError('anp.editor.invalid_output: paywall marker missing', {
        details: { rawText, attempt },
      });
      continue;
    }
    const result: EditNoteArticleResult = {
      lead: validated.data.lead,
      body_md: body,
      paywall_line_pos: paywallLinePos,
    };
    return result;
  }

  throw lastError ?? new AgentError('anp.editor.invalid_output: unknown failure');
}
