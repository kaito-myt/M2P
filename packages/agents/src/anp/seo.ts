/**
 * docs/11-anp-design.md §3.2 F-ANP-42 — note 内 SEO + クリックされるタイトル (role='anp.seo')。
 *
 * 運営者要望:
 *  - 「タイトルとアイキャッチが読者の目を引くようなものではないからもっと工夫して」
 *  - 「note内でのSEO対策も自動でやってくれるようにして」
 *
 * なぜ「執筆後」に走らせるか: テーマ段階のタイトルは記事の中身を知らないまま付けた仮題で、
 * 具体的な数字・固有名詞を入れられない。校閲後の完成原稿を読ませることで
 * 「4 年分集計した」「回収率が 12 ポイント」のような具体性のあるタイトルが作れる。
 *
 * フロー: 校閲 (anp.editor) → **本エージェント** → アイキャッチ (anp.eyecatch) → 判定 (anp.judge)
 *  1. `loadActivePrompt('anp.seo', null)`
 *  2. プレースホルダ差込 ({niche}/{target_reader}/{tone}/{current_title})
 *  3. `createAgentClient('anp.seo', null, ctx)` → JSON 抽出 → zod 検証 (最大 2 回再試行)
 *
 * エラー方針: 他の ANP エージェントと同型 (AgentError / ProviderError 透過 / ConfigError)。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteSeoInputSchema,
  NoteSeoOutputSchema,
  parseEditorialPolicy,
  type NoteSeoInput,
  type NoteSeoOutput,
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

/** 日本語 JSON は 4096 だと途中で切れるため長めに取る (F-ANP-32 と同じ理由)。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const MAX_PARSE_RETRIES = 2;
/** 本文はタイトル判断に十分な量だけ渡す (全文だと入力コストが跳ねる)。 */
const BODY_EXCERPT_CHARS = 6000;

export interface GenerateNoteSeoDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

function hasTitle(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return typeof (parsed as Record<string, unknown>).title === 'string';
}

/** 本文から `##`/`###` 見出しを抜き出す (改善対象の提示用)。 */
export function extractHeadings(bodyMd: string): string[] {
  const out: string[] = [];
  for (const line of bodyMd.split('\n')) {
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[2]!.trim());
  }
  return out.slice(0, 20);
}

export async function generateNoteSeo(
  input: NoteSeoInput,
  deps: GenerateNoteSeoDeps = {},
): Promise<NoteSeoOutput> {
  const parsed = NoteSeoInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.seo', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsed.account.niche,
    target_reader: parsed.account.target_reader ?? '(指定なし)',
    tone: parsed.account.tone ?? '(指定なし)',
    current_title: parsed.current_title,
  });

  const ctx: LoggingContext = { role: 'anp.seo' };
  if (parsed.job_id !== undefined) ctx.jobId = parsed.job_id;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.seo', null, ctx, factoryDeps);

  const sections = parseEditorialPolicy(parsed.account.editorial_policy ?? '');
  const seoPolicy = (sections.seo ?? '').trim();
  const otherPolicy = [sections.themes, sections.style_rules, sections.cta]
    .map((v) => (v ?? '').trim())
    .filter((v) => v.length > 0)
    .join('\n');

  const headings = extractHeadings(parsed.body_md);
  const body = parsed.body_md.slice(0, BODY_EXCERPT_CHARS);

  const userMessage = [
    `ニッチ: ${parsed.account.niche}`,
    `想定読者: ${parsed.account.target_reader ?? '(指定なし)'}`,
    `トーン: ${parsed.account.tone ?? '(指定なし)'}`,
    // 運営者がアカウント詳細の「記事の方針 › SEO対策」に書いた制約は最優先で守らせる。
    seoPolicy ? `このアカウントの SEO 方針 (必ず従う):\n${seoPolicy.slice(0, 800)}` : '',
    otherPolicy ? `記事の方針(抜粋):\n${otherPolicy.slice(0, 800)}` : '',
    '',
    `現在のタイトル(仮題): ${parsed.current_title}`,
    parsed.hook ? `企画時のフック: ${parsed.hook}` : '',
    '',
    headings.length > 0 ? `現在の見出し:\n${headings.map((h) => ` - ${h}`).join('\n')}` : '',
    '',
    `本文(先頭 ${String(BODY_EXCERPT_CHARS)} 字):`,
    body,
    '',
    parsed.recent_titles.length > 0
      ? `直近のタイトル(言い回しが被らないように):\n${parsed.recent_titles.map((t) => ` - ${t}`).join('\n')}`
      : '',
    parsed.published.length > 0
      ? `内部リンク候補(公開済み記事):\n${parsed.published.map((p) => ` - ${p.title} ${p.note_url}`).join('\n')}`
      : '',
    '',
    '出力形式: 次の JSON だけを返す。',
    '{',
    '  "title": string,',
    '  "title_alternatives": string[],',
    '  "lead": string,',
    '  "primary_keyword": string,',
    '  "keywords": string[],',
    '  "hashtags": string[],',
    '  "headings": [{ "original": string, "improved": string }],',
    '  "eyecatch_copy": string,',
    '  "eyecatch_sub": string,',
    '  "eyecatch_alt": string,',
    '  "internal_links": string[],',
    '  "rationale": string',
    '}',
    'JSON 以外のテキスト・コードフェンスは出力しないこと。',
  ]
    .filter((l) => l !== '')
    .join('\n');

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt += 1) {
    const completion = await client.complete({
      role: 'anp.seo',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.seo.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractJson(rawText, hasTitle);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.seo.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteSeoOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.seo.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    // 内部リンクは提示した候補 URL のみ許可する (LLM の URL 捏造を弾く)。
    const allowed = new Set(parsed.published.map((p) => p.note_url));
    const links = validated.data.internal_links.filter((u) => allowed.has(u));
    return { ...validated.data, internal_links: links };
  }

  throw lastError ?? new AgentError('anp.seo.invalid_output: unknown failure');
}
