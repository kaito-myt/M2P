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
 * 【2026-10-13 F-ANP-53】タイトルの型を**記事ごとに 1 つだけ指定する**ようにした。
 * それまでは「読まれている型 7 つ」を列挙して「どれかに乗せろ」と指示していたが、生成された
 * 100 本中 96 本が同じ `X｜Y` 形に収束していた (詳細と原因は `title-style.ts` の冒頭)。
 * 選択肢を見せると最頻出の型に倒れるので、選ばせずに渡す。
 *
 * フロー: 校閲 (anp.editor) → **本エージェント** → アイキャッチ (anp.eyecatch) → 判定 (anp.judge)
 *  1. `loadActivePrompt('anp.seo', null)`
 *  2. プレースホルダ差込 ({niche}/{target_reader}/{tone}/{current_title}/{title_pattern})
 *  3. `createAgentClient('anp.seo', null, ctx)` → JSON 抽出 → zod 検証 (最大 2 回再試行)
 *
 * エラー方針: 他の ANP エージェントと同型 (AgentError / ProviderError 透過 / ConfigError)。
 */
import { AgentError } from '@a2p/contracts/errors';
import { accountResearchLines } from './account-context.js';
import { classifyNicheGenre } from '@a2p/contracts/note-genre';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteSeoInputSchema,
  NoteSeoOutputSchema,
  parseEditorialPolicy,
  type NoteSeoInput,
  type NoteSeoOutput,
} from '@a2p/contracts/agents/anp';

import {
  enforceTitlePattern,
  pickTitlePattern,
  recurringPhrases,
  type TitlePattern,
} from './title-style.js';

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

/**
 * 今回使う型をプロンプトに貼る形に整える。**候補を並べない** (並べると最頻出の型に倒れる)。
 */
export function buildPatternBlock(pattern: TitlePattern): string {
  return [
    `【今回のタイトルの型】${pattern.label}`,
    pattern.rule,
    pattern.usesBar
      ? '区切り記号 ｜ を 1 つ使って 2 段にする。'
      : '**区切り記号 ｜ は使わない**。1 文で書き切る。',
    '型の見本 (構造だけ真似る。文言はコピーしない):',
    ...pattern.examples.map((e) => ` - ${e}`),
  ].join('\n');
}

export async function generateNoteSeo(
  input: NoteSeoInput,
  deps: GenerateNoteSeoDeps = {},
): Promise<NoteSeoOutput> {
  const parsed = NoteSeoInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.seo', null, deps.promptLoaderDeps);
  // F-ANP-54: ジャンルで勝ち筋が違う (競馬系=断定/結論、副業系=等身大の金額と失敗)。
  const genre = classifyNicheGenre(parsed.account.niche);
  // F-ANP-53: この記事で使う型を 1 つだけ決める (記事 id で決定的)。
  const pattern = pickTitlePattern(parsed.note_article_id, parsed.recent_titles, parsed.account.niche);
  const systemPrompt = fillPlaceholders(prompt.template, {
    niche: parsed.account.niche,
    target_reader: parsed.account.target_reader ?? '(指定なし)',
    tone: parsed.account.tone ?? '(指定なし)',
    current_title: parsed.current_title,
    title_pattern: buildPatternBlock(pattern),
    genre_tone: genre.titleTone,
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
  // ニッチ名は検索キーワードなので繰り返して当然 — 指摘対象から外す。
  const repeated = recurringPhrases(parsed.recent_titles, {
    exclude: [parsed.account.niche, parsed.account.target_reader ?? ''],
  });

  const userMessage = [
    `ニッチ: ${parsed.account.niche}`,
    `想定読者: ${parsed.account.target_reader ?? '(指定なし)'}`,
    `トーン: ${parsed.account.tone ?? '(指定なし)'}`,
    // 運営者がアカウント詳細の「記事の方針 › SEO対策」に書いた制約は最優先で守らせる。
    seoPolicy ? `このアカウントの SEO 方針 (必ず従う):\n${seoPolicy.slice(0, 800)}` : '',
    otherPolicy ? `記事の方針(抜粋):\n${otherPolicy.slice(0, 800)}` : '',
    '',
    // 仮題をそのまま「現在のタイトル」として見せると推敲に倒れ、語順も記号も引き継がれる。
    // 作業用ラベルであることを明示して、構造を断ち切る。
    '作業用の仮題 (企画段階の機械生成ラベル。記事の中身を伝えるためだけのもの。',
    `  **語順・記号・言い回しを引き継がず、ゼロから付け直すこと**): ${parsed.current_title}`,
    parsed.hook ? `企画時のフック: ${parsed.hook}` : '',
    '',
    buildPatternBlock(pattern),
    '',
    `【${genre.label}のタイトルのトーン】`,
    genre.titleTone,
    '',
    `【${genre.label}のアイキャッチのコピー (eyecatch_copy) の作り方】`,
    genre.copy,
    // F-ANP-56: 週次リサーチで分かった、このアカウント固有のコピー規則と勝ち型。
    // ジャンル表 (genre.copy) は 2 分類しか持てないので、アカウント単位の知見で補強する。
    // 衝突したらリサーチ側 (後に書かれる方) を優先させる。
    // findings も渡す。2026-10-14: 「note の競馬面に乗るタイトルは開催日＋レース名始まり」
    // という決定的な知見が findings にしか無く、タイトルを決める側に届いていなかった。
    ...accountResearchLines(parsed.account, ['copy', 'patterns', 'findings']),
    '',
    headings.length > 0 ? `現在の見出し:\n${headings.map((h) => ` - ${h}`).join('\n')}` : '',
    '',
    `本文(先頭 ${String(BODY_EXCERPT_CHARS)} 字):`,
    body,
    '',
    parsed.recent_titles.length > 0
      ? [
          '直近のタイトル — これは**避けるべき見本**です。同じ型・同じ記号・同じ語順にしないこと:',
          ...parsed.recent_titles.map((t) => ` - ${t}`),
        ].join('\n')
      : '',
    repeated.length > 0
      ? `直近で繰り返されている言い回し (今回は使わないか、別の言い方にする): ${repeated.join(' / ')}`
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
    // 指示を無視して `｜` 形に戻った場合、代替案に型どおりのものがあれば入れ替える。
    return enforceTitlePattern({ ...validated.data, internal_links: links }, pattern);
  }

  throw lastError ?? new AgentError('anp.seo.invalid_output: unknown failure');
}
