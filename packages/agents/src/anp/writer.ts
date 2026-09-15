/**
 * docs/11-anp-design.md §3.2 F-ANP-12 — note Writer (本文執筆)。
 * A2P `writer/chapter.ts` を note 用に写像。note 固有: 有料記事は無料パート＋続き有料の
 * 「ライン」構造を持つ。LLM には無料末尾に `<<<PAYWALL>>>` マーカー行を単独で挿入させ、
 * 呼出側でそのオフセット (codepoint index) を `paywall_line_pos` として抽出し、
 * マーカー自体は最終本文から除去する (LLM に整数オフセットを直接計算させない — 不正確になる)。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteWriterInputSchema,
  NoteWriterOutputSchema,
  type NoteWriterInput,
  type NoteWriterOutput,
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

/** 有料記事の無料/有料の区切りマーカー。本文中に単独行として出現する想定。 */
export const PAYWALL_MARKER = '<<<PAYWALL>>>';

/**
 * マーカー本体 + 前後の Markdown 太字記法 (`**`) までまとめて検出・除去するための正規表現。
 * LLM がユーザープロンプトの `**<<<PAYWALL>>>**` の表記をそのまま模倣し、太字記号ごと
 * 本文に出力してしまう事故を防ぐ (code-reviewer 指摘)。
 */
const MARKER_PATTERN = /\*{0,2}<<<PAYWALL>>>\*{0,2}/g;

export interface GenerateNoteBodyDeps {
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
 * `body_md` から `PAYWALL_MARKER` (前後の `**` 込み) を検出し、マーカーを除去した本文と
 * マーカー位置 (codepoint index) を返す。paid=false または未検出時は position=undefined
 * (呼出側は「paid なのに未検出」を invalid_output として扱い再試行する契約)。
 *
 * マーカーが 2 個以上出現した場合 (LLM の事故) は **先頭の出現位置を採用しつつ、
 * 全出現を本文から除去する**。2 個目以降の除去では前後の改行畳みは行わない
 * (先頭マーカー分割点の位置計算に影響を与えないため — code-reviewer 指摘)。
 */
export function splitPaywallMarker(
  bodyMd: string,
  paid: boolean,
): { body: string; paywallLinePos?: number } {
  if (!paid) return { body: bodyMd };

  const matches = [...bodyMd.matchAll(MARKER_PATTERN)];
  if (matches.length === 0) return { body: bodyMd };

  const first = matches[0]!;
  const firstIdx = first.index!;
  const before = bodyMd.slice(0, firstIdx);
  const afterRaw = bodyMd.slice(firstIdx + first[0].length);

  // マーカー前後の空行/改行を軽く畳んで自然な地の文につなげる (先頭出現のみ)。
  const trimmedBefore = before.replace(/\n{3,}$/, '\n\n');
  const trimmedAfter = afterRaw.replace(/^\n{3,}/, '\n\n');
  // 2 個目以降の重複マーカーが残っていれば単純に除去する (見た目の余分な空行は許容)。
  const cleanedAfter = trimmedAfter.replace(MARKER_PATTERN, '');

  const body = `${trimmedBefore}${cleanedAfter}`;
  const paywallLinePos = [...trimmedBefore].length;
  return { body, paywallLinePos };
}

export async function generateNoteBody(
  input: NoteWriterInput,
  deps: GenerateNoteBodyDeps = {},
): Promise<NoteWriterOutput> {
  const parsedInput = NoteWriterInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.writer', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsedInput.account.niche,
    target_reader: parsedInput.account.target_reader ?? '(指定なし)',
    tone: parsedInput.account.tone ?? '(指定なし)',
    theme_title: parsedInput.theme.title,
    theme_hook: parsedInput.theme.hook,
    lead: parsedInput.lead,
    headings: parsedInput.headings.map((h, i) => `${i + 1}. ${h}`).join('\n'),
    paid: parsedInput.paid ? 'yes' : 'no',
    free_ratio: parsedInput.free_ratio,
    target_chars: parsedInput.target_chars,
    feedback: (parsedInput.feedback ?? []).map((f) => `- ${f}`).join('\n'),
  });

  const ctx: LoggingContext = { role: 'anp.writer' };
  if (parsedInput.job_id !== undefined) ctx.jobId = parsedInput.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.writer', null, ctx, factoryDeps);

  const lines = [
    `記事タイトル: ${parsedInput.theme.title}`,
    `差別化フック: ${parsedInput.theme.hook}`,
    `想定読者: ${parsedInput.theme.target_reader ?? parsedInput.account.target_reader ?? '(指定なし)'}`,
    `リード文 (既に確定・本文冒頭にはそのまま使わず自然につなげる): ${parsedInput.lead}`,
    `見出し構成 (順守):\n${parsedInput.headings.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
    `目標文字数: ${parsedInput.target_chars} 字`,
  ];
  if (parsedInput.paid) {
    lines.push(
      `課金種別: 有料 (全体の約 ${Math.round(parsedInput.free_ratio * 100)}% を無料公開し、` +
        `その続きは有料)。無料部分の末尾で「続きが読みたくなる」ところに、` +
        `本文とは別の単独行として ${PAYWALL_MARKER} というマーカーを1回だけ挿入すること` +
        ' (太字記法 `**` などの装飾は付けず、マーカー文字列のみを単独行に書く)。' +
        'マーカーの前後は地の文として自然につながるように書く (マーカー自体は読者に見せる文章ではない)。',
    );
  } else {
    lines.push('課金種別: 無料 (全文無料公開)。');
  }
  if (parsedInput.feedback && parsedInput.feedback.length > 0) {
    lines.push('', '【修正コメント — 必ず反映】', parsedInput.feedback.map((f) => `- ${f}`).join('\n'));
  }
  if (parsedInput.related_books && parsedInput.related_books.length > 0) {
    lines.push(
      '',
      '【参考: 関連する自社刊行の書籍 (F-ANP-31 相互流入・任意)】',
      parsedInput.related_books.map((b) => `- ${b.title}`).join('\n'),
      '本文の趣旨に自然に合う場合に限り、上記のいずれかに文中や末尾でさりげなく触れてよい' +
        '(必須ではない。取ってつけた宣伝にならないよう、話の流れに合わないなら触れなくてよい)。',
    );
  }
  lines.push(
    '',
    '上記の見出し構成に沿って note 記事の本文 (Markdown) を執筆してください。',
    '- 1 段落は 2〜4 文程度で短く区切り、段落間は空行 (\\n\\n) を入れる (note・スマホでの読みやすさ最優先)',
    '- 見出しは `## ` で本文に含める',
    '- 文体はアカウントのトーンに従う',
    '出力形式: JSON で以下を返してください。',
    '{',
    '  "body_md": string,       // 本文 Markdown',
    '  "char_count": integer    // body_md の文字数 (codepoint 数)',
    '}',
    'JSON 以外のテキストは出力しないこと。JSON 文字列値内の改行は必ず \\n でエスケープすること。',
  );
  const userMessage = lines.join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete({
      role: 'anp.writer',
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
      lastError = new AgentError('anp.writer.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasBodyMd);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.writer.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const normalized = normalizePartialOutput(parsedJson);
    const validated = NoteWriterOutputSchema.safeParse(normalized);
    if (!validated.success) {
      lastError = new AgentError('anp.writer.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    const { body, paywallLinePos } = splitPaywallMarker(validated.data.body_md, parsedInput.paid);
    if (parsedInput.paid && paywallLinePos === undefined) {
      lastError = new AgentError('anp.writer.invalid_output: paywall marker missing', {
        details: { rawText, attempt },
      });
      continue;
    }
    const charCount = [...body].length;
    const output: NoteWriterOutput = { body_md: body, char_count: charCount };
    if (paywallLinePos !== undefined) output.paywall_line_pos = paywallLinePos;
    return output;
  }

  throw lastError ?? new AgentError('anp.writer.invalid_output: unknown failure');
}

function normalizePartialOutput(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };
  if (typeof out.char_count !== 'number' && typeof out.body_md === 'string') {
    out.char_count = [...(out.body_md as string)].length;
  }
  return out;
}
