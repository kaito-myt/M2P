/**
 * docs/11-anp-design.md F-ANP-56 — note アカウント別 週次リサーチ (anp.research)。
 *
 * 運営者指示 (2026-10-14):
 *   「週次リサーチは ANP にも入れてね。アカウントごとにジャンルが違うから
 *     アカウントごとに観点を決めてリサーチすべきやね」
 *
 * A2P の `promotion.playbook.refresh` は「チャンネル × 固定の観点」でリサーチするが、
 * ANP はアカウントごとにニッチが違う (副業系 / 競馬系 / …)。共通の観点ではどちらにも
 * 効かないので、**観点そのものを毎回 AI に決めさせる** 2 段構成にした。
 *
 *   1. 観点決定 — アカウントのニッチ・読者・方針・直近記事の実績・前回のリサーチから
 *      「今週このアカウントで何を見るべきか」を 1〜4 観点 + 検索クエリの JSON で返させる。
 *      Tavily キーが無いときは検索を飛ばし、観点だけで知見をまとめる (質は落ちるが止めない)。
 *   2. まとめ — 検索結果を根拠ブロックとして注入し、`NoteAccountResearch` を返させる。
 *      画作り (art_direction) / コピーの作り方 (copy_rules) / 狙う・避ける題材 /
 *      editorial_policy の改訂提案 まで含める。
 *
 * 成果の使い道は「役割プロンプト本文の書き換え」ではなく **アカウント単位の実行時注入**。
 * 本文 (prompts テーブル) は全アカウント共有なので、アカウント固有の指示を焼き込むと
 * 他アカウントに漏れる。2026-10-14 の A2P 障害 (prompt_editor がジャンル固有の書式を
 * 本文へ書き戻し、小説 17 冊の本文に見出しが混入) と同じ失敗を避ける。
 *
 * Web 検索は Marketer / consultant と同じ Tavily の単発 HTTP 検索。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteAccountResearchSchema,
  type NoteAccountConsultResearchItem,
  type NoteAccountResearch,
  type NoteAccountResearchInput,
} from '@a2p/contracts/agents/anp';
import { createLogger } from '@a2p/contracts/logger';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import { getTavilyApiKey, type GetTavilyKeyDeps } from '../lib/get-tavily-key.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';
import { TavilyWebSearch } from '../tools/web-search.js';
import { editorialPolicyLines } from './account-context.js';

const log = createLogger('agents.anp.research');

const ROLE = 'anp.research' as const;
// 2026-10-14 本番実測: 1536 では観点が 1 件も返らず (angles=0)、検索クエリが出ないため
// 外部情報ゼロのリサーチになっていた。観点は「名前 + なぜ + クエリ 1〜3」× 最大 4 件で
// 日本語だと 1000 トークンを超えるので、途中で切れない余裕を持たせる。
const PLAN_MAX_OUTPUT_TOKENS = 4096;
/** 観点決定は 0 件だとリサーチの価値が無いので、空振りしたら 1 回だけ作り直す。 */
const MAX_PLAN_RETRIES = 2;
const REPORT_MAX_OUTPUT_TOKENS = 8192;
const MAX_PARSE_RETRIES = 2;
/** 1 クエリあたりの Tavily 取得件数 / 根拠ブロックの最大件数。 */
const PER_QUERY_RESULTS = 5;
const MAX_RESEARCH_ITEMS = 16;
/** 観点とクエリの上限 (コストと所要時間の天井)。 */
const MAX_ANGLES = 4;
const MAX_QUERIES = 8;

export interface ResearchNoteAccountDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  getTavilyKeyDeps?: GetTavilyKeyDeps;
  /** DI: Tavily キー解決を丸ごと差し替える (テスト用)。 */
  resolveTavilyKey?: () => Promise<string | null>;
  /** DI: 検索実行を差し替える (テスト用)。既定は TavilyWebSearch。 */
  search?: (query: string) => Promise<NoteAccountConsultResearchItem[]>;
}

export interface ResearchNoteAccountResult {
  research: NoteAccountResearch;
  /** 参照した検索結果 (監査・UI 表示用)。Tavily キーが無ければ空。 */
  items: NoteAccountConsultResearchItem[];
}

/** 段階 1 の出力: 観点とクエリ。 */
interface ResearchPlan {
  angles: Array<{ angle: string; why?: string; queries: string[] }>;
}

function hasAngles(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>).angles)
  );
}

function hasFindings(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (Array.isArray((parsed as Record<string, unknown>).findings) ||
      typeof (parsed as Record<string, unknown>).art_direction === 'string')
  );
}

/**
 * F-ANP-56 受入基準: アカウントごとに観点を決めてリサーチし、
 * `NoteAccountResearch` (画作り・コピー規則・狙う/避ける題材・方針改訂案) を返す。
 *
 * @throws AgentError まとめ段の JSON 抽出 / schema 検証が規定回数失敗したとき
 */
export async function researchNoteAccount(
  input: NoteAccountResearchInput,
  deps: ResearchNoteAccountDeps = {},
): Promise<ResearchNoteAccountResult> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(ROLE, null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});

  const ctx: LoggingContext = { role: ROLE };
  if (input.jobId !== undefined) ctx.jobId = input.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(ROLE, null, ctx, factoryDeps);

  // --- 段階 1: 観点決定 ---
  const plan = await planAngles({ client, systemPrompt, input });

  // --- 検索 ---
  const items = await runSearch(plan, deps);

  // --- 段階 2: まとめ ---
  const userMessage = buildReportUserMessage(input, plan, items);
  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete<string>({
      role: ROLE,
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: REPORT_MAX_OUTPUT_TOKENS,
    });
    const raw = typeof completion.text === 'string' ? completion.text : '';
    const parsed = extractLlmJson<unknown>(raw, hasFindings);
    if (parsed === undefined) {
      lastError = new AgentError('anp.research.invalid_output: failed to parse JSON', {
        details: { attempt, rawTextLength: raw.length },
      });
      continue;
    }
    const validated = NoteAccountResearchSchema.safeParse(parsed);
    if (!validated.success) {
      lastError = new AgentError('anp.research.invalid_output: schema validation failed', {
        details: { attempt, issues: validated.error.issues },
        cause: validated.error,
      });
      continue;
    }
    // 観点は段階 1 の計画を正とする (まとめ段で言い換えられると何を見たか追えなくなる)。
    const research: NoteAccountResearch = {
      ...validated.data,
      angles: plan.angles.map((a) => ({
        angle: a.angle,
        ...(a.why ? { why: a.why } : {}),
        queries: a.queries,
      })),
    };
    return { research, items };
  }

  throw lastError ?? new AgentError('anp.research.invalid_output: unknown failure');
}

// ---------------------------------------------------------------------------
// 段階 1: 観点決定
// ---------------------------------------------------------------------------

async function planAngles(args: {
  client: LLMClient;
  systemPrompt: string;
  input: NoteAccountResearchInput;
}): Promise<ResearchPlan> {
  for (let attempt = 1; attempt <= MAX_PLAN_RETRIES; attempt++) {
    let raw = '';
    try {
      const completion = await args.client.complete<string>({
        role: ROLE,
        genre: null,
        messages: [
          { role: 'system', content: args.systemPrompt },
          { role: 'user', content: buildPlanUserMessage(args.input) },
        ],
        maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
      });
      raw = typeof completion.text === 'string' ? completion.text : '';
    } catch (err) {
      // 観点決定の失敗でリサーチ全体を落とさない。
      log.warn(
        { err: err instanceof Error ? err.message : String(err), attempt },
        'angle planning call failed',
      );
      continue;
    }

    const parsed = extractLlmJson<ResearchPlan>(raw, hasAngles);
    const angles = (parsed?.angles ?? [])
      .filter((a) => typeof a?.angle === 'string' && a.angle.trim().length > 0)
      .slice(0, MAX_ANGLES)
      .map((a) => ({
        angle: a.angle.trim().slice(0, 200),
        ...(typeof a.why === 'string' && a.why.trim() ? { why: a.why.trim().slice(0, 400) } : {}),
        queries: (Array.isArray(a.queries) ? a.queries : [])
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .slice(0, 5)
          .map((q) => q.trim().slice(0, 200)),
      }));
    if (angles.length > 0) return { angles };

    // 0 件は「静かに外部情報ゼロのリサーチ」になるので必ず記録する
    // (2026-10-14 本番の初回実行がこれで、ログからは原因が追えなかった)。
    log.warn(
      { attempt, rawLength: raw.length, rawHead: raw.slice(0, 200) },
      'angle planning returned no angles',
    );
  }
  return { angles: fallbackAngles(args.input) };
}

/**
 * 観点決定が空振りしたときの保険。ニッチから機械的にクエリを作る。
 *
 * LLM が観点を返さなくても**外部情報ゼロのリサーチにはしない**ことを優先する。
 * 観点名は「アカウントのニッチ」から派生するので、アカウントごとに違う点は保たれる。
 */
function fallbackAngles(input: NoteAccountResearchInput): ResearchPlan['angles'] {
  const niche = input.account.niche.trim();
  if (!niche) return [];
  return [
    {
      angle: `${niche} で今読まれている note 記事`,
      why: '観点の自動決定に失敗したため、ニッチの定番クエリで最低限の外部情報を取る',
      queries: [`${niche} note 人気記事`, `${niche} note 有料記事`, `${niche} 2026 トレンド`],
    },
  ];
}

async function runSearch(
  plan: ResearchPlan,
  deps: ResearchNoteAccountDeps,
): Promise<NoteAccountConsultResearchItem[]> {
  const search = await resolveSearchFn(deps);
  if (!search) return [];
  const queries = plan.angles.flatMap((a) => a.queries).slice(0, MAX_QUERIES);
  if (queries.length === 0) return [];

  const results = await Promise.all(
    queries.map((q) =>
      search(q).catch((err: unknown) => {
        log.warn(
          { q, err: err instanceof Error ? err.message : String(err) },
          'tavily query failed',
        );
        return [] as NoteAccountConsultResearchItem[];
      }),
    ),
  );

  const seen = new Set<string>();
  const items: NoteAccountConsultResearchItem[] = [];
  for (const list of results) {
    for (const item of list) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
      if (items.length >= MAX_RESEARCH_ITEMS) return items;
    }
  }
  return items;
}

async function resolveSearchFn(
  deps: ResearchNoteAccountDeps,
): Promise<((query: string) => Promise<NoteAccountConsultResearchItem[]>) | null> {
  if (deps.search) return deps.search;
  const resolveKey = deps.resolveTavilyKey ?? (() => getTavilyApiKey(deps.getTavilyKeyDeps));
  const apiKey = await resolveKey();
  if (!apiKey) return null;
  const tavily = new TavilyWebSearch({ apiKey });
  return async (query: string) => {
    const res = await tavily.search({ query, maxResults: PER_QUERY_RESULTS });
    return res.items.map((it) => ({
      query,
      title: it.title,
      url: it.url,
      ...(it.snippet ? { snippet: it.snippet.replace(/\s+/g, ' ').trim().slice(0, 240) } : {}),
    }));
  };
}

// ---------------------------------------------------------------------------
// プロンプト組み立て
// ---------------------------------------------------------------------------

function accountBlock(input: NoteAccountResearchInput): string[] {
  const a = input.account;
  return [
    '【アカウント】',
    `- ニッチ/テーマ: ${a.niche}`,
    `- 想定読者: ${a.target_reader ?? '(未設定)'}`,
    `- トーン: ${a.tone ?? '(未設定)'}`,
    ...editorialPolicyLines(a),
  ];
}

function performanceBlock(input: NoteAccountResearchInput): string[] {
  if (input.recentArticles.length === 0) {
    return ['', '【直近記事の実績】', '(まだ実績データが無い — 立ち上げ期として観点を決める)'];
  }
  const rows = input.recentArticles
    .slice(0, 20)
    .map((r) => {
      const parts = [
        r.views !== undefined ? `閲覧${r.views}` : null,
        r.likes !== undefined ? `スキ${r.likes}` : null,
        r.sales_jpy ? `売上¥${r.sales_jpy.toLocaleString('ja-JP')}` : null,
        r.is_paid ? '有料' : null,
      ].filter(Boolean);
      return `- ${r.title}${parts.length ? ` [${parts.join(' / ')}]` : ''}`;
    })
    .join('\n');
  return ['', '【直近記事の実績 (何が読まれたか)】', rows];
}

function previousBlock(input: NoteAccountResearchInput): string[] {
  const prev = input.previous;
  if (!prev) return [];
  const lines: string[] = ['', '【前回のリサーチ結果 (同じ知見を繰り返さない)】'];
  if (prev.summary) lines.push(`総括: ${prev.summary}`);
  if (prev.winning_patterns.length) lines.push(`勝ち型: ${prev.winning_patterns.join(' / ')}`);
  if (prev.art_direction) lines.push(`画作り: ${prev.art_direction.slice(0, 300)}`);
  if (prev.topics_to_pursue.length) lines.push(`狙う題材: ${prev.topics_to_pursue.join(' / ')}`);
  return lines;
}

function buildPlanUserMessage(input: NoteAccountResearchInput): string {
  return [
    '# タスク: 今週このアカウントで「何を見るべきか」を決める',
    '',
    ...accountBlock(input),
    ...performanceBlock(input),
    ...previousBlock(input),
    '',
    'このアカウントのニッチ・読者・実績を踏まえ、**このアカウントに固有の観点**を 1〜4 個決めてください。',
    '汎用的な観点 (「SNS で伸びる方法」等) ではなく、このニッチの読者が今何に反応しているかを',
    '具体的に突く観点にすること。各観点に日本語の検索クエリを 1〜3 個付けます。',
    '検索は note / X / ブログ等の実例が拾えるクエリにし、年号や季節性を含めてよい。',
    '',
    '出力は次の JSON のみ (前後に何も付けない):',
    '{',
    '  "angles": [',
    '    { "angle": "観点の名前", "why": "なぜこのアカウントでこれを見るのか", "queries": ["検索クエリ", ...] },',
    '    ...',
    '  ]',
    '}',
  ].join('\n');
}

function buildReportUserMessage(
  input: NoteAccountResearchInput,
  plan: ResearchPlan,
  items: NoteAccountConsultResearchItem[],
): string {
  const lines: string[] = [
    '# タスク: 週次リサーチのまとめと、来週の作り方への反映',
    '',
    ...accountBlock(input),
    ...performanceBlock(input),
    ...previousBlock(input),
    '',
    '【今回の観点】',
    ...(plan.angles.length
      ? plan.angles.map((a) => `- ${a.angle}${a.why ? ` — ${a.why}` : ''}`)
      : ['(観点決定に失敗したため、アカウント情報と実績のみで判断する)']),
  ];

  if (items.length > 0) {
    lines.push(
      '',
      '【検索で得られた一次情報 (これを根拠にする)】',
      ...items.map(
        (it, i) => `${i + 1}. ${it.title}\n   ${it.url}${it.snippet ? `\n   ${it.snippet}` : ''}`,
      ),
      '',
      '上の一次情報に書かれていないことを「調べた結果」として書かないこと。',
      '根拠が無い項目は空配列・空文字で返す。推測で埋めない。',
    );
  } else {
    lines.push(
      '',
      '【検索結果なし】',
      'Web 検索が使えなかった。アカウント情報と直近実績から読み取れることだけを書き、',
      '外部トレンドを装った記述はしない (findings は空配列でもよい)。',
    );
  }

  lines.push(
    '',
    '出力は次の JSON のみ (前後に何も付けない)。日本語で書く。',
    '{',
    '  "findings": [ { "angle": "観点名", "finding": "知見", "implication": "記事づくりへの示唆", "sources": ["URL", ...] }, ... ],',
    '  "winning_patterns": ["今このアカウントで効く記事の型 (タイトル/導入/構成)", ...],',
    '  "art_direction": "アイキャッチの画作り指示。被写体・構図・色・質感・避けるもの。',
    '                    このニッチの読者がタイムラインで反応する絵を、具体的に 200〜600 字で。',
    '                    汎用的な美辞麗句ではなく、画像モデルがそのまま使える指示にする。",',
    '  "copy_rules": ["アイキャッチのコピーの作り方 (字数・言い回し・数字の入れ方・NG 表現)", ...],',
    '  "topics_to_pursue": ["次に狙う題材", ...],',
    '  "topics_to_avoid": ["避ける題材 (飽和・規約リスク・読者が離れる)", ...],',
    '  "editorial_policy_suggestion": "記事の方針・トンマナに足す/変えるべき点だけを書く。',
    '                                   全文を書き直さない。変更不要なら空文字。",',
    '  "summary": "運営者向けの総括 1〜3 文"',
    '}',
  );
  return lines.join('\n');
}
