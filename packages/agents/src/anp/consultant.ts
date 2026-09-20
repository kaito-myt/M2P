/**
 * docs/11-anp-design.md §3.1/§7 F-ANP-04 — note アカウント戦略の AI 相談担当 (anp.consultant)。
 *
 * 運営者要望 (2026-09-21)「ANP で最初アカウント戦略策定する時に、AI に相談しながらリサーチや
 * 戦略策定を行えるようにして」への対応。ブリーフ一発入力 (F-ANP-01, `strategist.ts`) の前段として、
 * 運営者 ⇔ AI アドバイザーがチャットで壁打ちし、AI が毎ターン「ブリーフ草案」を更新する。
 *
 * 1 ターンの処理は 2 段階:
 *   1. リサーチ計画 — 会話と新しいメッセージから「Web 検索が必要か / どんなクエリか」を小さな
 *      JSON で決める (0〜3 クエリ)。Tavily キーが無いときはこの段階を丸ごと飛ばす。
 *   2. 返答 — Tavily の検索結果 (あれば) を根拠ブロックとして注入し、`reply` + `brief_draft` +
 *      `ready_to_design` + `suggested_questions` の JSON を返す。
 *
 * Web 検索は Marketer と同じく Tavily の単発 HTTP 検索 (`tavily-research.ts` の方針)。
 * 純正 web_search のエージェント的ループは使わない (チャットの応答時間を数十秒に抑えるため)。
 * 判定/テーマと同じく出力パースは最大 2 回まで再試行する。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NoteAccountConsultBriefDraftSchema,
  NoteAccountConsultOutputSchema,
  NoteAccountConsultResearchPlanSchema,
  type NoteAccountConsultBriefDraft,
  type NoteAccountConsultOutput,
  type NoteAccountConsultResearchItem,
  type NoteAccountConsultTurn,
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

const log = createLogger('agents.anp.consultant');

const ROLE = 'anp.consultant' as const;
const PLAN_MAX_OUTPUT_TOKENS = 1024;
const REPLY_MAX_OUTPUT_TOKENS = 8192;
const MAX_PARSE_RETRIES = 2;
/** プロンプトに載せる会話履歴の最大ターン数 (古いものから切り捨て)。 */
const MAX_HISTORY_TURNS = 30;
/** 1 クエリあたりの Tavily 取得件数 / 根拠ブロックの最大件数。 */
const PER_QUERY_RESULTS = 5;
const MAX_RESEARCH_ITEMS = 12;

export interface ConsultNoteAccountInput {
  /** これまでの会話 (古い順)。今回のメッセージは含めない。 */
  history: NoteAccountConsultTurn[];
  /** 今回の運営者メッセージ。 */
  message: string;
  /** 前回までの草案 (無ければ空)。 */
  briefDraft: NoteAccountConsultBriefDraft;
}

export interface ConsultNoteAccountResult {
  output: NoteAccountConsultOutput;
  /** 今回参照した Web リサーチ結果 (無ければ空配列)。 */
  research: NoteAccountConsultResearchItem[];
}

export interface ConsultNoteAccountDeps {
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
  jobId?: string;
}

function hasReply(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).reply === 'string';
}

function hasQueries(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).queries);
}

/**
 * F-ANP-04 受入基準: 会話 + 新メッセージから、アドバイザーの返答と最新のブリーフ草案を返す。
 */
export async function consultNoteAccount(
  input: ConsultNoteAccountInput,
  deps: ConsultNoteAccountDeps = {},
): Promise<ConsultNoteAccountResult> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(ROLE, null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});

  const ctx: LoggingContext = { role: ROLE };
  if (deps.jobId !== undefined) ctx.jobId = deps.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(ROLE, null, ctx, factoryDeps);

  const draft = NoteAccountConsultBriefDraftSchema.safeParse(input.briefDraft);
  const briefDraft: NoteAccountConsultBriefDraft = draft.success ? draft.data : {};
  const history = input.history.slice(-MAX_HISTORY_TURNS);

  // --- 段階 1: リサーチ計画 (Tavily キーがあるときだけ) ---
  const research = await runResearch({ client, systemPrompt, history, message: input.message, briefDraft }, deps);

  // --- 段階 2: 返答 ---
  const userMessage = buildReplyUserMessage({ history, message: input.message, briefDraft, research });

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete<string>({
      role: ROLE,
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.consultant.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractLlmJson<unknown>(rawText, hasReply);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.consultant.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteAccountConsultOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.consultant.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    return { output: validated.data, research };
  }

  throw lastError ?? new AgentError('anp.consultant.invalid_output: unknown failure');
}

// ---------------------------------------------------------------------------
// 段階 1: リサーチ計画 + Tavily 検索
// ---------------------------------------------------------------------------

interface ResearchArgs {
  client: LLMClient;
  systemPrompt: string;
  history: NoteAccountConsultTurn[];
  message: string;
  briefDraft: NoteAccountConsultBriefDraft;
}

async function runResearch(
  args: ResearchArgs,
  deps: ConsultNoteAccountDeps,
): Promise<NoteAccountConsultResearchItem[]> {
  const search = await resolveSearchFn(deps);
  if (!search) return [];

  let queries: string[] = [];
  try {
    const completion = await args.client.complete<string>({
      role: ROLE,
      genre: null,
      messages: [
        { role: 'system', content: args.systemPrompt },
        { role: 'user', content: buildResearchPlanUserMessage(args) },
      ],
      maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
    });
    const raw = typeof completion.text === 'string' ? completion.text : '';
    const parsed = extractLlmJson<unknown>(raw, hasQueries);
    const plan = NoteAccountConsultResearchPlanSchema.safeParse(parsed ?? {});
    queries = plan.success ? plan.data.queries : [];
  } catch (err) {
    // リサーチ計画の失敗は返答を止めない (会話のみで続行)。
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'research plan failed — continuing without research');
    return [];
  }
  if (queries.length === 0) return [];

  const results = await Promise.all(
    queries.map((q) =>
      search(q).catch((err: unknown) => {
        log.warn({ q, err: err instanceof Error ? err.message : String(err) }, 'tavily query failed');
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
  deps: ConsultNoteAccountDeps,
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

function formatHistory(history: NoteAccountConsultTurn[]): string {
  if (history.length === 0) return '(履歴なし — これが最初のメッセージ)';
  return history
    .map((t) => `${t.role === 'operator' ? '運営者' : 'アドバイザー'}: ${t.content}`)
    .join('\n');
}

function formatDraft(draft: NoteAccountConsultBriefDraft): string {
  const keys = Object.keys(draft) as Array<keyof NoteAccountConsultBriefDraft>;
  if (keys.length === 0) return '(まだ何も決まっていない)';
  return JSON.stringify(draft, null, 2);
}

export function buildResearchPlanUserMessage(args: {
  history: NoteAccountConsultTurn[];
  message: string;
  briefDraft: NoteAccountConsultBriefDraft;
}): string {
  return [
    '次の運営者メッセージに返答する前に、Web リサーチ (検索) が必要か判断してください。',
    '検索が有効なのは: 競合 note アカウント/記事の実在確認、ニッチの需要や話題性、有料記事の価格相場、',
    '読者層の悩みの言語化、参考アカウントの調査など「事実で裏付けると返答の質が上がる」ときです。',
    '雑談・確認・運営者の決定の受け取りなど、事実確認が不要なら検索しません。',
    '',
    '【これまでの会話】',
    formatHistory(args.history),
    '',
    '【現在のブリーフ草案】',
    formatDraft(args.briefDraft),
    '',
    '【運営者からの新しいメッセージ】',
    args.message,
    '',
    '出力形式: {"queries": ["検索クエリ1", ...], "reason": "判断理由 (1文)"} の JSON のみ。',
    'queries は 0〜3 件、日本語の具体的なクエリ (例: "note 家計簿 節約 有料記事 人気")。',
    '検索しないなら queries は空配列。JSON 以外は出力しない。',
  ].join('\n');
}

export function buildReplyUserMessage(args: {
  history: NoteAccountConsultTurn[];
  message: string;
  briefDraft: NoteAccountConsultBriefDraft;
  research: NoteAccountConsultResearchItem[];
}): string {
  const researchBlock =
    args.research.length > 0
      ? [
          '【Web リサーチ結果 (Tavily 検索・実データ)】',
          '以下は今回のメッセージに答えるために検索した実在のページです。根拠として返答に織り込み、',
          '事実 (ここにある) と推測 (ここに無い) を区別してください。',
          ...args.research.map(
            (r) => `- [${r.query}] ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}\n  (${r.url})`,
          ),
        ].join('\n')
      : '【Web リサーチ結果】(今回は検索していない)';

  return [
    'あなたは note アカウント戦略の壁打ち相手として、運営者と会話しています。',
    '会話の到達点は、そのまま設計生成 (anp.strategist) に渡せるブリーフ草案を固めることです。',
    '',
    '【これまでの会話】',
    formatHistory(args.history),
    '',
    '【現在のブリーフ草案 (前回まで)】',
    formatDraft(args.briefDraft),
    '',
    researchBlock,
    '',
    '【運営者からの新しいメッセージ】',
    args.message,
    '',
    '出力要件 (JSON のみ):',
    '- reply: 運営者への返答 (Markdown 可、見出しは使わず箇条書き中心、800 字以内目安)。',
    '  ①あなたの見解 (賛成/反対と根拠) ②具体案 (ニッチ候補・読者像・記事例・価格帯など判断材料)',
    '  ③次に決めるべきこと (質問は最大 2 つ、選択肢付き) を含める。リサーチ結果があれば根拠として引用する。',
    '- brief_draft: 会話全体を反映した最新の草案。キー: idea (やりたいこと・ニッチ, 2000字以内),',
    '  goal (収益目標・狙い), target_reader_hint (想定読者), monetization_hint (無料中心/有料重視/',
    '  メンバーシップ 等), constraints (NG・避けたいこと), persona_type ("person"|"brand"|"auto"),',
    '  reference_accounts (参考にしたい note/SNS アカウント名や URL の配列)。',
    '  決まっていないキーは省略する。前回までの内容は運営者が覆さない限り引き継ぐ。',
    '- ready_to_design: idea・想定読者・収益方針の 3 つが固まり、設計生成に渡せるなら true。',
    '- suggested_questions: 運営者がそのまま送れる次の一言 (0〜3 件、各 60 字以内。',
    '  例: "副業初心者向けで決めます" "競合をもう少し調べて")。',
    'JSON 以外の前置き・説明・コードフェンスは出力しない。日本語で出力する。',
  ].join('\n');
}
