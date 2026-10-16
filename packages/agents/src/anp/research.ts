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
  type NoteRivalEyecatchObservation,
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
import {
  collectRivalEyecatches as defaultCollectRivalEyecatches,
  observeRivalEyecatches as defaultObserveRivalEyecatches,
  type RivalEyecatchShot,
} from './eyecatch-market.js';
import { styleKeysForNiche } from './eyecatch-style.js';

const log = createLogger('agents.anp.research');

const ROLE = 'anp.research' as const;
// 2026-10-14 本番実測: 1536 では観点が 1 件も返らず (angles=0)、検索クエリが出ないため
// 外部情報ゼロのリサーチになっていた。観点は「名前 + なぜ + クエリ 1〜3」× 最大 4 件で
// 日本語だと 1000 トークンを超えるので、途中で切れない余裕を持たせる。
const PLAN_MAX_OUTPUT_TOKENS = 4096;
/** 観点決定は 0 件だとリサーチの価値が無いので、空振りしたら 1 回だけ作り直す。 */
const MAX_PLAN_RETRIES = 2;
// 2026-10-14 本番実測: 観点 4 件・出典 16 件が入った回の まとめ が 8192 で切れ、
// JSON が途中で終わって 2 回とも parse に失敗した (競馬アカウントが invalid_output)。
// schema の上限 (findings 10 / copy_rules 8 / topics 各 10 / art_direction 1200字) を
// 全部埋めると日本語で 6,000〜9,000 トークンになるので 8192 では足りない。
// 32768 まで上げると Anthropic SDK が「非ストリーミングでは 10 分を超えうる」と判断して
// messages.create を即エラーにするため、その閾値未満の 16384 を上限とする
// (marketer/theme.ts と同じ判断)。
const REPORT_MAX_OUTPUT_TOKENS = 16384;
const MAX_PARSE_RETRIES = 2;
/**
 * 「出力が上限で切れた」と見なす残りトークン数。
 *
 * プロバイダの報告値が上限ぴったりにならないことがあるので少し余裕を持たせる。
 * この判定は **parse に失敗した後にしか使わない**ので、多少広く取っても
 * 成功した応答を誤って壊すことはない。
 */
const TRUNCATION_MARGIN_TOKENS = 64;
/**
 * 出力上限で切れた直後の再試行に足す指示。
 *
 * 2026-10-14 本番 (競馬アカウント): まとめ段が上限ちょうど 8192/8192 で切れ、
 * **同じ依頼をそのまま 2 回投げたので同じ所で切れて 2 回とも失敗**した
 * (¥42 × 2 を無駄に払い、運営者には「全 1 アカウントのリサーチが失敗しました」
 * としか出なかった)。上限を 16384 に上げたが、schema を全部埋めれば入らない回は
 * また出る (実測で 10,004 トークン使っている)。
 * 上限を上げ続けるのではなく、**切れたら次の試行で要求そのものを小さくする**。
 */
const TIGHTEN_OUTPUT_INSTRUCTION = [
  '【重要 — 前回の出力は長すぎて途中で切れた】',
  'JSON が完結しなかった。今回は量を削り、必ず閉じ括弧まで出し切ること。',
  '- findings は最も重要な 3 件まで',
  '- art_direction は 300 字以内',
  '- copy_rules / topics_to_pursue / topics_to_avoid / preferred_style_keys は各 3 件まで',
  '- editorial_policy_suggestion は 200 字以内 (不要なら空文字)',
  '- summary は 1 文',
].join('\n');

/** 出力が上限で切れたか。切れているなら同じ依頼を繰り返しても同じ所で切れる。 */
function isTruncated(outputTokens: number, cap: number): boolean {
  return outputTokens >= cap - TRUNCATION_MARGIN_TOKENS;
}
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
  /** F-ANP-57 DI: 競合サムネの収集 (既定は note の記事/一覧ページから og:image を取る)。 */
  collectRivalEyecatches?: typeof defaultCollectRivalEyecatches;
  /** F-ANP-57 DI: 競合サムネのビジョン観察。 */
  observeRivalEyecatches?: typeof defaultObserveRivalEyecatches;
  /** F-ANP-57: 競合サムネを見る工程を飛ばす (コストを抑えたいとき / テスト)。 */
  skipRivalEyecatches?: boolean;
}

export interface ResearchNoteAccountResult {
  research: NoteAccountResearch;
  /** 参照した検索結果 (監査・UI 表示用)。Tavily キーが無ければ空。 */
  items: NoteAccountConsultResearchItem[];
  /** F-ANP-57: 実際に画像を見た競合サムネの枚数。0 なら画作りはテキストからの推測。 */
  rivalShots: number;
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

  // --- F-ANP-57: 競合サムネを実物で見る ---
  // ここが無いと art_direction (被写体・構図・色) が**テキストからの創作**になる。
  // ベストエフォート: 1 枚も取れなくてもリサーチは続行し、evidence が空のままになる
  // (その空が `anp.eyecatch` 側で「ジャンル既定を上書きしない」判断に効く)。
  const rival = await observeRivals({ client, systemPrompt, input, items, deps });

  // --- 段階 2: まとめ ---
  const baseUserMessage = buildReportUserMessage(input, plan, items, rival.observation);
  let lastError: AgentError | undefined;
  /** 直前の試行が出力上限で切れたか。切れていたら次は要求を小さくして投げ直す。 */
  let truncatedBefore = false;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const userMessage = truncatedBefore
      ? `${baseUserMessage}\n\n${TIGHTEN_OUTPUT_INSTRUCTION}`
      : baseUserMessage;
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
    const outputTokens = completion.usage?.outputTokens ?? 0;
    const truncated = isTruncated(outputTokens, REPORT_MAX_OUTPUT_TOKENS);
    const parsed = extractLlmJson<unknown>(raw, hasFindings);
    if (parsed === undefined) {
      // 出力上限で切れたのか、形が違うのかを**エラー本文で**切り分けられるようにする。
      // 2026-10-14: 8192 で切れていたのに message が 'failed to parse JSON' だけで、
      // 運営者側 (ANP ホームの「直近の失敗」) からは原因に辿り着けなかった。
      truncatedBefore = truncated;
      log.warn(
        { attempt, truncated, outputTokens, rawLength: raw.length, rawTail: raw.slice(-200) },
        'report JSON parse failed',
      );
      lastError = new AgentError(
        truncated
          ? `anp.research.invalid_output: 出力が上限 (${REPORT_MAX_OUTPUT_TOKENS} トークン) で切れて JSON が完結しなかった`
          : 'anp.research.invalid_output: failed to parse JSON',
        { details: { attempt, truncated, outputTokens, rawTextLength: raw.length } },
      );
      continue;
    }
    truncatedBefore = false;
    const validated = NoteAccountResearchSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        { attempt, issues: validated.error.issues.slice(0, 5) },
        'report schema validation failed',
      );
      lastError = new AgentError('anp.research.invalid_output: schema validation failed', {
        details: { attempt, issues: validated.error.issues },
        cause: validated.error,
      });
      continue;
    }
    // 観点は段階 1 の計画を正とする (まとめ段で言い換えられると何を見たか追えなくなる)。
    // 同じ理由で **サムネの根拠は実際に取得できた画像の URL を正とする** — まとめ段の
    // LLM に「見た」と言わせてはいけない (見ていないのに evidence が埋まると、
    // `anp.eyecatch` が推測をジャンル既定より上に置いてしまう)。
    const research: NoteAccountResearch = {
      ...validated.data,
      angles: plan.angles.map((a) => ({
        angle: a.angle,
        ...(a.why ? { why: a.why } : {}),
        queries: a.queries,
      })),
      art_direction_evidence: rival.shots.map((sh) => sh.imageUrl),
      rival_eyecatches: rival.observation,
    };
    return { research, items, rivalShots: rival.shots.length };
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

/**
 * F-ANP-57 — 競合サムネを集めて実物を見る。
 *
 * **絶対に throw しない。** 画像が取れないこと・ビジョン呼び出しが失敗することを理由に
 * 週次リサーチ全体を落とすと、テキストのリサーチまで一緒に失われる。
 * 失敗時は shots=[] / observation=null で返り、`art_direction_evidence` が空になる。
 */
async function observeRivals(args: {
  client: LLMClient;
  systemPrompt: string;
  input: NoteAccountResearchInput;
  items: readonly NoteAccountConsultResearchItem[];
  deps: ResearchNoteAccountDeps;
}): Promise<{ shots: RivalEyecatchShot[]; observation: NoteRivalEyecatchObservation | null }> {
  const { deps } = args;
  if (deps.skipRivalEyecatches === true) return { shots: [], observation: null };
  if (args.items.length === 0) return { shots: [], observation: null };

  const collect = deps.collectRivalEyecatches ?? defaultCollectRivalEyecatches;
  let shots: RivalEyecatchShot[] = [];
  try {
    shots = await collect(args.items);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '競合サムネの収集に失敗 — 画像なしで続行する',
    );
    return { shots: [], observation: null };
  }
  if (shots.length === 0) {
    log.warn(
      { items: args.items.length },
      '競合サムネを 1 枚も取得できなかった — art_direction はテキストからの推測になる',
    );
    return { shots: [], observation: null };
  }

  const observe = deps.observeRivalEyecatches ?? defaultObserveRivalEyecatches;
  try {
    const observation = await observe({
      client: args.client,
      systemPrompt: args.systemPrompt,
      shots,
      niche: args.input.account.niche,
      ourStyleSummary: ourEyecatchSummary(args.input),
      ...(args.input.jobId !== undefined ? { jobId: args.input.jobId } : {}),
    });
    log.info(
      {
        shots: shots.length,
        patterns: observation.common_patterns.length,
        urls: shots.map((sh) => sh.articleUrl),
      },
      '競合サムネを実物で観察した',
    );
    return { shots, observation };
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), shots: shots.length },
      '競合サムネの観察に失敗 — 画像なしで続行する',
    );
    return { shots: [], observation: null };
  }
}

/**
 * F-ANP-57 — 自分たちのサムネの現状を 1 ブロックにまとめる。
 *
 * 画風キー (`jobs.result_json.style_key`) ごとに閲覧/スキを平均する。
 * これを渡していなかったので、リサーチは「どのサムネで数字が出たか」を一度も知らず、
 * 画風の選択は記事 id のハッシュ (= 実績と無関係なくじ引き) のままだった。
 */
export function ourEyecatchSummary(input: NoteAccountResearchInput): string {
  const byStyle = new Map<string, { n: number; views: number; likes: number }>();
  let withStyle = 0;
  for (const a of input.recentArticles) {
    const key = (a.eyecatch_style ?? '').trim();
    if (key.length === 0) continue;
    withStyle += 1;
    const cur = byStyle.get(key) ?? { n: 0, views: 0, likes: 0 };
    cur.n += 1;
    cur.views += a.views ?? 0;
    cur.likes += a.likes ?? 0;
    byStyle.set(key, cur);
  }
  if (withStyle === 0) return '';
  const rows = [...byStyle.entries()]
    .map(([key, v]) => ({ key, n: v.n, views: v.views / v.n, likes: v.likes / v.n }))
    .sort((x, y) => y.views - x.views)
    .map(
      (r) =>
        `- ${r.key}: ${r.n} 本 / 平均閲覧 ${r.views.toFixed(1)} / 平均スキ ${r.likes.toFixed(2)}`,
    );
  return [
    `直近 ${withStyle} 本のアイキャッチを画風別に集計した実績:`,
    ...rows,
    '(画風は記事 ID のハッシュで機械的に振っているので、公開時期の偏りが混ざる。',
    ' 1 本あたりの差を断定せず、傾向としてだけ扱うこと。)',
  ].join('\n');
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
    // F-ANP-57: 後段で**実物のサムネを見る**ため、note 自身がそのジャンルの記事を並べている面
    // (note.com/topic/*, note.com/hashtag/*) に当たるクエリが 1 つは必要。
    // ここに当たらないと og:image を掘る先が無く、画作りがテキストからの推測に戻る。
    '観点のうち**少なくとも 1 つ**は「このニッチの note 記事そのものが並んでいる一覧」に',
    '当たるクエリを含めてください (例: 「note 競馬 トピック 人気記事」「note ハッシュタグ AI副業 記事」)。',
    'その一覧から実際のアイキャッチ画像を取得して見るので、記事ページに辿り着けるクエリにすること。',
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

/**
 * F-ANP-57 — 実物のサムネを見た結果をまとめ段に渡すブロック。
 *
 * 画像が 1 枚も取れなかったときは**その事実を明記する**。黙って省くと、まとめ段の LLM が
 * 一般論で art_direction を埋めてしまう (それが元の不具合だった)。
 */
function rivalEyecatchBlock(observation: NoteRivalEyecatchObservation | null): string[] {
  if (observation === null || observation.shots.length === 0) {
    return [
      '',
      '【競合サムネの実物: 見られなかった】',
      '今回はこのニッチの note 記事のアイキャッチ画像を 1 枚も取得できなかった。',
      'したがって **art_direction は空文字で返すこと**。画像を見ていないのに被写体・構図・配色を',
      '指示すると、運営者が実物を見て決めたジャンル既定の画風を根拠なく上書きしてしまう。',
      '画作り以外 (findings / winning_patterns / copy_rules / topics) はテキストの一次情報から書いてよい。',
    ];
  }
  const lines = ['', `【競合サムネの実物 ${observation.shots.length} 枚を見た結果 (ここが画作りの唯一の根拠)】`];
  for (const [i, sh] of observation.shots.entries()) {
    lines.push(
      `${i + 1}. ${sh.article_url || sh.image_url}`,
      `   被写体: ${sh.subject}`,
      `   構図: ${sh.composition}`,
      `   配色: ${sh.colors}`,
      `   文字: ${sh.text}`,
    );
  }
  if (observation.common_patterns.length > 0) {
    lines.push('共通して現れた作法:', ...observation.common_patterns.map((pt) => `- ${pt}`));
  }
  if (observation.our_gap.trim().length > 0) {
    lines.push(`自分たちのサムネに足りていない点: ${observation.our_gap.trim()}`);
  }
  lines.push(
    '',
    'art_direction は **上の観察に書かれている要素だけ**で組み立てること。',
    '観察に出てこない被写体・配色・質感を足さない。観察と自分の好みが食い違ったら観察に従う。',
  );
  return lines;
}

function buildReportUserMessage(
  input: NoteAccountResearchInput,
  plan: ResearchPlan,
  items: NoteAccountConsultResearchItem[],
  rivalObservation: NoteRivalEyecatchObservation | null = null,
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

  // F-ANP-57: 画作りの根拠は**実物のサムネを見た結果だけ**。テキストの一次情報の後、
  // 出力指定の直前に置く (画像モデルと同じく LLM も後ろの指示を強く守るため)。
  lines.push(...rivalEyecatchBlock(rivalObservation));

  // F-ANP-57: 自分たちのサムネの実績 (画風別の閲覧/スキ)。これを渡していなかったので
  // 「どの画風で数字が出たか」が一度もリサーチに届いていなかった。
  const ourStyles = ourEyecatchSummary(input);
  if (ourStyles.length > 0) {
    lines.push('', '【自分たちのサムネの実績 (画風別)】', ourStyles);
  }

  // F-ANP-57b: 「選べる札」を見せて preferred_style_keys で絞らせる。
  // 文章で「paper_collage を軸に」と書いても、画風の選択はハッシュのくじ引きなので効かない。
  lines.push(
    '',
    '【このアカウントで選べる画風キー】',
    styleKeysForNiche(input.account.niche).join(' / '),
    '上の実物の観察と画風別の実績から、**使ってよい画風だけ**を 2 つ以上選んで',
    'preferred_style_keys に入れてください (記事ごとのローテーションは残すので 1 つに絞らない)。',
    '根拠が無ければ空配列にする (全候補から選ばれます)。一覧に無いキーは無視されます。',
  );

  lines.push(
    '',
    '出力は次の JSON のみ (前後に何も付けない)。日本語で書く。',
    '{',
    '  "findings": [ { "angle": "観点名", "finding": "知見", "implication": "記事づくりへの示唆", "sources": ["URL", ...] }, ... ],',
    '  "winning_patterns": ["今このアカウントで効く記事の型 (タイトル/導入/構成)", ...],',
    '  "art_direction": "アイキャッチの画作り指示。被写体・構図・色・質感・避けるもの。',
    '                    **上の「競合サムネの実物」に書かれている要素だけ**で 200〜600 字。',
    '                    画像モデルがそのまま使える指示にする (汎用的な美辞麗句は書かない)。',
    '                    実物を見られなかった回は必ず空文字にする。",',
    '  "preferred_style_keys": ["使ってよい画風キー (上の一覧から 2 つ以上。根拠が無ければ空配列)", ...],',
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
