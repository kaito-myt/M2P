/**
 * docs/11-anp-design.md §3.1/§7 F-ANP-01/03 — note アカウント設計担当 (anp.strategist)。
 *
 * 運営者要望「note は別アカウントを作ります。どのようなアカウントにするかの設計もツール上で
 * 行えるようにしといてくださいね」への対応。運営者は brief (idea 等) だけを渡し、AI が
 * 表示名/handle 候補・bio・発信の柱・収益方針・投稿頻度・初回テーマ・アイコン/ヘッダー画像
 * プロンプトまで一括設計する。`sns_strategist` (`packages/agents/src/sns-strategist/index.ts`)
 * の note 版だが、note は「別アカウントを新規作成する」ワークフロー (§7) のため、既存チャンネル
 * ではなく `NoteAccountDesign` (提案) → 採用時に `note_accounts` を新規作成する形を取る。
 *
 * web 検索は使わず LLM のみ (`extractLlmJson` + zod)。judge/theme と同じ最大 2 回までの
 * 出力パース再試行を行う。
 */
import { AgentError } from '@a2p/contracts/errors';
import type { LLMClient } from '@a2p/contracts/agents';
import {
  NOTE_BIO_MAX_CHARS,
  NoteAccountDesignBriefSchema,
  NoteAccountDesignSchema,
  NoteAccountEditorialOutputSchema,
  parseEditorialPolicy,
  NotePromotionPolicyInputSchema,
  NotePromotionPolicyOutputSchema,
  type NotePromotionPolicyInput,
  type NotePromotionPolicyOutput,
  NoteAccountProfileInputSchema,
  NoteAccountProfileOutputSchema,
  type NoteAccountDesign,
  type NoteAccountDesignBrief,
  type NoteAccountEditorialOutput,
  type NoteAccountProfileInput,
  type NoteAccountProfileOutput,
} from '@a2p/contracts/agents/anp';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';
import { withPersonaVisualRules } from '../lib/persona-visual.js';
import {
  generateImage as defaultGenerateImage,
  type GenerateImageFn,
} from '../tools/image-gen.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/**
 * 方針/施策/プロフィールの JSON は日本語で数千字になるため 4096 では途中で切れて
 * `failed to parse JSON` になる (2026-09-21 実障害)。16384 は Anthropic の非ストリーミング上限内。
 */
const LONG_JSON_MAX_OUTPUT_TOKENS = 16384;
const MAX_PARSE_RETRIES = 2;

export interface PlanNoteAccountDesignDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  jobId?: string;
}

function hasDisplayNameCandidates(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return Array.isArray((parsed as Record<string, unknown>).display_name_candidates);
}

/**
 * F-ANP-01/03 受入基準: ブリーフから `NoteAccountDesign` を生成する。
 */
export async function planNoteAccountDesign(
  brief: NoteAccountDesignBrief,
  deps: PlanNoteAccountDesignDeps = {},
): Promise<NoteAccountDesign> {
  const parsedBrief = NoteAccountDesignBriefSchema.parse(brief);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.strategist', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});

  const ctx: LoggingContext = { role: 'anp.strategist' };
  if (deps.jobId !== undefined) ctx.jobId = deps.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.strategist', null, ctx, factoryDeps);

  const userMessage = buildUserMessage(parsedBrief);

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete<string>({
      role: 'anp.strategist',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });

    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.strategist.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }

    const parsedJson = extractLlmJson<unknown>(rawText, hasDisplayNameCandidates);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.strategist.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }

    const validated = NoteAccountDesignSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.strategist.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }

    return validated.data;
  }

  throw lastError ?? new AgentError('anp.strategist.invalid_output: unknown failure');
}

export function buildUserMessage(brief: NoteAccountDesignBrief): string {
  const personaHint =
    brief.persona_type === 'auto'
      ? '(未指定。内容から人物型/ブランド型どちらが適するか判断してよい)'
      : brief.persona_type === 'person'
        ? '人物型 (顔の見える「個人」として運用する) を希望'
        : 'ブランド型 (顔を出さないロゴ/世界観ベース) を希望';

  const lines = [
    'あなたはこれから新規に開設する note アカウントの設計を任されました。',
    '運営者は note で「テーマ別マルチアカウント」運用をしており、今回は新しいニッチ専用の',
    'アカウントを1つ立ち上げます。以下のブリーフから、そのまま実運用できる具体度の',
    '設計案を1つ作ってください。',
    '',
    `【やりたいこと・ニッチ】${brief.idea}`,
    brief.goal ? `【収益目標・狙い】${brief.goal}` : '',
    brief.target_reader_hint ? `【想定読者のヒント】${brief.target_reader_hint}` : '',
    brief.monetization_hint ? `【収益方針のヒント】${brief.monetization_hint}` : '',
    brief.constraints ? `【NG・避けたいこと】${brief.constraints}` : '',
    `【人物設定の希望】${personaHint}`,
    brief.reference_accounts && brief.reference_accounts.length > 0
      ? `【参考にしたいアカウント】\n${brief.reference_accounts.map((r) => ` - ${r}`).join('\n')}`
      : '',
    brief.feedback ? `【前回案への追加指示 (必ず反映すること)】\n${brief.feedback}` : '',
    '',
    '設計要件:',
    '- display_name_candidates: 覚えやすく検索されやすい表示名を3件。',
    '- handle_candidates: note の urlname 制約 (半角英数字とアンダースコアのみ、1〜32字) を',
    '  満たす候補を3件。表示名から連想できるものにする。',
    '- bio: note プロフィール欄にそのまま貼れる文 (140字以内)。価値提案＋人物像＋読む理由を含める。',
    '- concept: このアカウントのポジショニング宣言 (1〜2文)。「本を売る宣伝垢」ではなく、',
    '  読者に毎回価値を配る存在として位置づける。',
    '- persona_type: "person" (実在の人物が書いている体) か "brand" (ロゴ/世界観ベース) の',
    '  どちらかを断定する。',
    '- character_sheet: persona_type="person" の場合のみ、名前・年齢・生活・口癖など',
    '  400〜800字で作る。persona_type="brand" の場合は null にする。',
    '- content_pillars: 発信の柱を3〜6本。各柱に name / description / example_titles (3件)。',
    '- genre_policy: 想定に近い書籍ジャンルの slug を1〜3個 (practical, business, self_help,',
    '  money, side_business, career, mental, hobby 等の英語小文字 slug。厳密でなくてよい)。',
    '- monetization_policy: note で伸びる/売れるアカウントの原則',
    '  (ニッチ特化・読者の悩み起点・無料7割で信頼を作ってから有料は完全版を売る・',
    '  有料は300〜1,000円帯から始める・マガジン/メンバーシップは記事20本以降が目安) に',
    '  従って free_ratio(0〜1)/price_band([下限,上限])/membership(bool)/',
    '  paid_line_strategy(どこから有料にするか1文) を決める。',
    '- posting_cadence: 週あたりの投稿本数 (times_per_week) と、狙う曜日・時間帯 (time_of_day)。',
    '- first_themes: 初回に書くべき記事テーマを5件 (title / hook)。',
    '- kpi_targets: followers_30d / articles_30d / revenue_90d_jpy の現実的な数値目標。',
    '- avatar_prompt: アイコン(正方形)用の画像生成プロンプト。文字・ロゴ・数字は一切描かせない。',
    '- header_prompt: ヘッダー(note推奨 1280x670 目安・横長)用の画像生成プロンプト。',
    '  文字は一切描かせない。',
    '- rationale: なぜこの設計にしたのか3〜5行で。',
    '- 誇張せず、ブリーフの内容に接地した現実的な設計にする。',
    '',
    '出力形式: 上記フィールドを持つ JSON のみを返してください。JSON 以外の前置き・説明・',
    'コードフェンスは出力しないこと。日本語で出力する。',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

// ---------------------------------------------------------------------------
// F-ANP-05 — プロフィール素材 (bio + アイコン/ヘッダー画像プロンプト) の生成
//
// アカウント詳細ページの「自己紹介文を生成」「アイコン/カバーを生成」から (worker
// `note.account.profile` 経由で) 呼ばれる。設計案を経ていないアカウントでも台帳情報だけで
// 作れるよう、入力は `NoteAccountProfileInput` (表示名/ニッチ/想定読者/トーン + 任意の設計情報)。
// role は anp.strategist を流用 (システムプロンプト/モデル割当は同じ、ユーザーメッセージだけ別)。
// ---------------------------------------------------------------------------

function hasBio(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  return typeof (parsed as Record<string, unknown>).bio === 'string';
}

export async function generateNoteAccountProfile(
  input: NoteAccountProfileInput,
  deps: PlanNoteAccountDesignDeps = {},
): Promise<NoteAccountProfileOutput> {
  const parsedInput = NoteAccountProfileInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt('anp.strategist', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});

  const ctx: LoggingContext = { role: 'anp.strategist' };
  if (deps.jobId !== undefined) ctx.jobId = deps.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.strategist', null, ctx, factoryDeps);
  const userMessage = buildProfileUserMessage(parsedInput);

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const images = parsedInput.reference_images ?? [];
    const completion = await client.complete<string>({
      role: 'anp.strategist',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage, ...(images.length > 0 ? { images } : {}) },
      ],
      maxOutputTokens: LONG_JSON_MAX_OUTPUT_TOKENS,
    });
    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.strategist.profile.invalid_output: empty response', {
        details: { rawText: String(rawText), attempt },
      });
      continue;
    }
    const parsedJson = extractLlmJson<unknown>(rawText, hasBio);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.strategist.profile.invalid_output: failed to parse JSON', {
        details: { rawText, attempt },
      });
      continue;
    }
    const validated = NoteAccountProfileOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.strategist.profile.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }
    return validated.data;
  }
  throw lastError ?? new AgentError('anp.strategist.profile.invalid_output: unknown failure');
}

export function buildProfileUserMessage(input: NoteAccountProfileInput): string {
  const personaHint =
    input.persona_type === 'person'
      ? '人物型 (実在の個人が書いている体)'
      : input.persona_type === 'brand'
        ? 'ブランド型 (ロゴ/世界観ベース、顔を出さない)'
        : '(未指定。内容から人物型/ブランド型を判断してよい)';
  const lines = [
    'note アカウントのプロフィール素材 (自己紹介文・アイコン画像プロンプト・ヘッダー画像プロンプト) を作ってください。',
    '',
    `【表示名】${input.display_name}`,
    input.handle ? `【note ハンドル】${input.handle}` : '',
    `【ニッチ・発信テーマ】${input.niche}`,
    input.target_reader ? `【想定読者】${input.target_reader}` : '',
    input.tone ? `【トーン】${input.tone}` : '',
    input.concept ? `【コンセプト】${input.concept}` : '',
    input.content_pillars && input.content_pillars.length > 0
      ? `【発信の柱】${input.content_pillars.join(' / ')}`
      : '',
    input.character_sheet ? `【キャラクター設定】\n${input.character_sheet}` : '',
    `【人物設定】${personaHint}`,
    input.existing_bio ? `【現在の自己紹介文 (これを改善する)】\n${input.existing_bio}` : '',
    input.instruction ? `【運営者からの追加指示 (必ず反映)】\n${input.instruction}` : '',
    input.reference_images && input.reference_images.length > 0
      ? `【添付された参考画像 ${input.reference_images.length} 枚】この画像の雰囲気・配色・構図・世界観を読み取り、avatar_prompt / header_prompt に具体的な言葉で反映してください (人物の顔は使わない)。bio の生成でも参考にしてよい。`
      : '',
    '',
    '要件:',
    `- bio: note のプロフィール欄にそのまま貼れる自己紹介文。**${NOTE_BIO_MAX_CHARS} 字以内 (厳守)**。`,
    '  「誰に・何を・なぜ読む価値があるか」を含め、宣伝臭を避けて人柄/世界観が伝わる文にする。改行は最大 2 回まで。',
    `- bio_alternatives: トーン違いの代替案を 2 件 (各 ${NOTE_BIO_MAX_CHARS} 字以内)。`,
    '- avatar_prompt: アイコン (正方形) 用の画像生成プロンプト。文字・ロゴ・数字は一切描かせない。',
    '  人物型なら「実写・顔は映さない・首から下」の制約は呼出側で付与するので、服装/小物/雰囲気/色調を具体的に書く。',
    '  ブランド型なら世界観を象徴するモチーフ/質感/配色を具体的に書く。',
    '- header_prompt: ヘッダー (横長 1280x670 目安) 用の画像生成プロンプト。文字は一切描かせない。アイコンと世界観を揃える。',
    '- persona_type: "person" か "brand" のどちらかを断定する。',
    '',
    '出力形式: {"bio": "...", "bio_alternatives": ["...", "..."], "avatar_prompt": "...", "header_prompt": "...", "persona_type": "person"|"brand"}',
    'の JSON のみを返してください。JSON 以外の前置き・説明・コードフェンスは出力しないこと。日本語で出力する。',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

// ---------------------------------------------------------------------------
// F-ANP-07 — 記事の方針・トンマナ (editorial_policy / tone / target_reader) の生成
//
// アカウント詳細の「記事の方針・トンマナ」→「AI で生成」から (worker `note.account.profile`
// targets=['editorial'] 経由で) 呼ばれる。入力は `NoteAccountProfileInput` と同じ (現在の方針は
// `existing_policy` として渡し「改善」させる)。role は anp.strategist を流用。
// ---------------------------------------------------------------------------

export interface NoteAccountEditorialInput extends NoteAccountProfileInput {
  /** 現在の方針 (あれば改善対象として渡す)。 */
  existing_policy?: string;
}

function hasEditorialPolicy(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const o = parsed as Record<string, unknown>;
  return (typeof o.sections === 'object' && o.sections !== null) || typeof o.editorial_policy === 'string';
}

/** 旧形式 (editorial_policy 文字列のみ) の応答を 5 区分へ正規化する。 */
function normalizeEditorialOutput(parsed: unknown): unknown {
  if (typeof parsed !== 'object' || parsed === null) return parsed;
  const o = parsed as Record<string, unknown>;
  if ((typeof o.sections !== 'object' || o.sections === null) && typeof o.editorial_policy === 'string') {
    return { ...o, sections: parseEditorialPolicy(o.editorial_policy) };
  }
  return parsed;
}

export async function generateNoteAccountEditorial(
  input: NoteAccountEditorialInput,
  deps: PlanNoteAccountDesignDeps = {},
): Promise<NoteAccountEditorialOutput> {
  const { existing_policy: existingPolicy, ...rest } = input;
  const parsedInput = NoteAccountProfileInputSchema.parse(rest);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;
  const prompt = await loadPrompt('anp.strategist', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});
  const ctx: LoggingContext = { role: 'anp.strategist' };
  if (deps.jobId !== undefined) ctx.jobId = deps.jobId;
  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;
  const client: LLMClient = await makeClient('anp.strategist', null, ctx, factoryDeps);

  const userMessage = buildEditorialUserMessage(parsedInput, existingPolicy);
  const images = parsedInput.reference_images ?? [];

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete<string>({
      role: 'anp.strategist',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage, ...(images.length > 0 ? { images } : {}) },
      ],
      maxOutputTokens: LONG_JSON_MAX_OUTPUT_TOKENS,
    });
    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.strategist.editorial.invalid_output: empty response', { details: { attempt } });
      continue;
    }
    const parsedJson = extractLlmJson<unknown>(rawText, hasEditorialPolicy);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.strategist.editorial.invalid_output: failed to parse JSON', { details: { rawText, attempt } });
      continue;
    }
    const validated = NoteAccountEditorialOutputSchema.safeParse(normalizeEditorialOutput(parsedJson));
    if (!validated.success) {
      lastError = new AgentError('anp.strategist.editorial.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }
    return validated.data;
  }
  throw lastError ?? new AgentError('anp.strategist.editorial.invalid_output: unknown failure');
}

export function buildEditorialUserMessage(input: NoteAccountProfileInput, existingPolicy?: string): string {
  const lines = [
    'note アカウントの「記事の方針・トンマナ」を設計してください。これは以後の全記事 (テーマ企画・構成・執筆・校閲・',
    '品質判定) のプロンプトに毎回注入される運営者設定です。誰が読んでも同じ文体・同じ判断ができる具体度で書いてください。',
    '',
    `【表示名】${input.display_name}`,
    `【ニッチ・発信テーマ】${input.niche}`,
    input.target_reader ? `【現在の想定読者】${input.target_reader}` : '',
    input.tone ? `【現在のトーン】${input.tone}` : '',
    input.concept ? `【コンセプト】${input.concept}` : '',
    input.content_pillars && input.content_pillars.length > 0 ? `【発信の柱】${input.content_pillars.join(' / ')}` : '',
    input.character_sheet ? `【キャラクター設定】` + String.fromCharCode(10) + input.character_sheet : '',
    input.existing_bio ? `【自己紹介文】${input.existing_bio}` : '',
    existingPolicy ? `【現在の方針 (これを改善する。見出し【主なテーマ】等の区分はそのまま使う)】` + String.fromCharCode(10) + existingPolicy : '',
    input.instruction ? `【運営者からの追加指示 (必ず反映)】` + String.fromCharCode(10) + input.instruction : '',
    input.reference_images && input.reference_images.length > 0
      ? `【添付された参考画像 ${input.reference_images.length} 枚】参考にしたい記事/アカウントのスクリーンショット等。文体・構成・見せ方の特徴を読み取って方針に反映すること。`
      : '',
    '',
    '要件:',
    '- target_reader: 想定読者を 1 文で具体的に (年代・状況・悩み)。300 字以内。',
    '- tone: 文体・語り口を短く (例: 「です・ます調、親しみやすく断定的。絵文字なし」)。200 字以内。',
    '- sections: 記事の方針・トンマナを 5 区分に分けたオブジェクト。各区分はプレーンテキストの箇条書き (「・」始まり) で、',
    '  themes (主なテーマ: 書くこと/書かないこと・扱う範囲・NG テーマ、1500 字以内)、',
    '  format (記事のフォーマット: 冒頭の入り方・見出しの付け方・1 記事の長さ・段落の長さ・具体例/数字/体験談の入れ方・',
    '  有料記事の切り方、1500 字以内)、style_rules (文末表現・禁止事項: 語尾・人称・呼びかけ・禁止表現 (煽り・断定しすぎ 等)、',
    '  1500 字以内)、cta (CTA: フォロー/スキ/次記事への導線の入れ方と決まり文句、800 字以内)、',
    '  quality (品質判定項目: 公開前チェックで減点/差し戻しにする具体条件を番号付きで、1500 字以内)、',
    '  other (その他: 引用/出典の扱い・画像・免責など上記に入らないもの、2000 字以内)。',
    '- rationale: なぜこの方針か 2〜3 行 (任意)。',
    '',
    '出力形式: {"target_reader": "...", "tone": "...", "sections": {"themes": "...", "format": "...", "style_rules": "...", "cta": "...", "quality": "...", "other": "..."}, "rationale": "..."} の JSON のみ。',
    'JSON 以外の前置き・説明・コードフェンスは出力しないこと。日本語で出力する。',
  ];
  return lines.filter((l) => l !== '').join(String.fromCharCode(10));
}

// ---------------------------------------------------------------------------
// F-ANP-32 — アカウント別・媒体別の販促施策 (role='anp.strategist')
// ---------------------------------------------------------------------------

const CHANNEL_LABEL_FOR_POLICY: Record<NotePromotionPolicyInput['channel'], string> = {
  x: 'X (旧 Twitter)',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  blog: 'ブログ',
};

const CHANNEL_GUIDE_FOR_POLICY: Record<NotePromotionPolicyInput['channel'], string> = {
  x: '140〜280 字のテキスト投稿。冒頭 1 行で止める / 数字と具体 / 記事 URL を末尾に。リプ・引用での会話も施策に含めてよい。',
  instagram: 'フィード (画像 or カルーセル) + キャプション。保存されるノウハウ型・カルーセルの構成案・プロフィール導線を含める。',
  tiktok: '15〜40 秒の縦動画 (スライド動画)。冒頭 1 秒のフック、テロップの型、コメント誘導、プロフィールから note への導線。',
  blog: '検索流入向けの長文記事 (1,500〜3,000 字)。狙う検索意図・見出し構成の型・内部リンクと note への導線・更新頻度。',
};

function hasPromotionPolicy(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null && typeof (parsed as Record<string, unknown>).policy === 'string';
}

/**
 * アカウント × 媒体の販促施策 (方針・ハッシュタグ・投稿頻度・CTA) を設計する。
 * 出力は `NotePromotionPolicyOutputSchema` の JSON。画像 (参考スクショ) は vision 入力として渡す。
 */
export async function generateNoteAccountPromotionPolicy(
  input: NotePromotionPolicyInput,
  deps: PlanNoteAccountDesignDeps = {},
): Promise<NotePromotionPolicyOutput> {
  const parsedInput = NotePromotionPolicyInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;
  const prompt = await loadPrompt('anp.strategist', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {});
  const ctx: LoggingContext = { role: 'anp.strategist' };
  const jobId = deps.jobId ?? parsedInput.job_id;
  if (jobId !== undefined) ctx.jobId = jobId;
  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;
  const client: LLMClient = await makeClient('anp.strategist', null, ctx, factoryDeps);

  const userMessage = buildPromotionPolicyUserMessage(parsedInput);
  const images = parsedInput.reference_images ?? [];

  let lastError: AgentError | undefined;
  for (let attempt = 1; attempt <= MAX_PARSE_RETRIES; attempt++) {
    const completion = await client.complete<string>({
      role: 'anp.strategist',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage, ...(images.length > 0 ? { images } : {}) },
      ],
      maxOutputTokens: LONG_JSON_MAX_OUTPUT_TOKENS,
    });
    const rawText = completion.text;
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      lastError = new AgentError('anp.strategist.promotion.invalid_output: empty response', { details: { attempt } });
      continue;
    }
    const parsedJson = extractLlmJson<unknown>(rawText, hasPromotionPolicy);
    if (parsedJson === undefined) {
      lastError = new AgentError('anp.strategist.promotion.invalid_output: failed to parse JSON', { details: { rawText, attempt } });
      continue;
    }
    const validated = NotePromotionPolicyOutputSchema.safeParse(parsedJson);
    if (!validated.success) {
      lastError = new AgentError('anp.strategist.promotion.invalid_output: schema validation failed', {
        details: { rawText, issues: validated.error.issues, attempt },
        cause: validated.error,
      });
      continue;
    }
    return validated.data;
  }
  throw lastError ?? new AgentError('anp.strategist.promotion.invalid_output: unknown failure');
}

export function buildPromotionPolicyUserMessage(input: NotePromotionPolicyInput): string {
  const a = input.account;
  const label = CHANNEL_LABEL_FOR_POLICY[input.channel];
  const ex = input.existing_policy;
  const lines = [
    `note アカウントの「${label} での販促施策」を設計してください。公開した note 記事をこの媒体でどう告知・拡散し、`,
    'note のフォロワー・記事の閲覧・有料記事の購入につなげるかの運営方針です。この方針は告知文の生成プロンプトに毎回注入されます。',
    '',
    `【媒体】${label} — ${CHANNEL_GUIDE_FOR_POLICY[input.channel]}`,
    `【表示名】${a.display_name}${a.handle ? ` (@${a.handle})` : ''}`,
    `【ニッチ・発信テーマ】${a.niche}`,
    a.target_reader ? `【想定読者】${a.target_reader}` : '',
    a.tone ? `【トーン】${a.tone}` : '',
    a.concept ? `【コンセプト】${a.concept}` : '',
    a.bio ? `【自己紹介文】${a.bio}` : '',
    a.editorial_policy ? `【記事の方針・トンマナ】` + String.fromCharCode(10) + a.editorial_policy : '',
    ex?.policy ? `【現在の施策 (これを改善する)】` + String.fromCharCode(10) + ex.policy : '',
    ex && ex.hashtags.length > 0 ? `【現在のハッシュタグ】${ex.hashtags.join(' ')}` : '',
    input.instruction ? `【運営者からの追加指示 (必ず反映)】` + String.fromCharCode(10) + input.instruction : '',
    input.reference_images && input.reference_images.length > 0
      ? `【添付された参考画像 ${input.reference_images.length} 枚】参考にしたい投稿/アカウントのスクリーンショット等。見せ方・構成・トーンの特徴を読み取って施策に反映すること。`
      : '',
    '',
    '要件:',
    '- policy: 販促施策。プレーンテキストの箇条書き (「・」始まり)、3000 字以内。次を含める:',
    '  1) この媒体での役割と狙う読者、2) 投稿の型 (冒頭フック・構成・長さ・絵文字/改行の作法)、3) 記事告知の頻度と時間帯、',
    '  4) 記事告知以外の日常投稿の比率と内容、5) 書き手のキャラの出し方と NG (煽り・自演・過度な宣伝 等)、',
    '  6) note への導線 (プロフィール/固定投稿/リプでの誘導)、7) 効果の見方 (何を KPI にするか)。',
    '- hashtags: 常に付けるハッシュタグ 3〜8 個 (# なし、日本語可、媒体の慣習に合わせる)。',
    '- posts_per_week: 週あたりの投稿目安 (整数)。',
    '- cta: 記事への誘導の決まり文句 (1 文、60 字以内)。',
    '- rationale: なぜこの施策か 2〜3 行 (任意)。',
    '',
    '出力形式: {"policy": "...", "hashtags": ["..."], "posts_per_week": 5, "cta": "...", "rationale": "..."} の JSON のみ。',
    'JSON 以外の前置き・説明・コードフェンスは出力しないこと。日本語で出力する。',
  ];
  return lines.filter((l) => l !== '').join(String.fromCharCode(10));
}

// ---------------------------------------------------------------------------
// アイコン / ヘッダー画像生成 (gpt-image-1)
// ---------------------------------------------------------------------------

/** 文字を描かせないためのガード文を画像プロンプトに付す。 */
const NO_TEXT_GUARD =
  ' 重要: 画像内に文字・ロゴ・数字・記号を一切描かないこと。テキストなしの純粋なビジュアルのみ。';

/** note のヘッダー推奨比率 (1280x670 目安) に近い gpt-image サポートサイズ。 */
const HEADER_WIDTH = 1536;
const HEADER_HEIGHT = 1024;

export interface NoteAccountDesignImages {
  /** 正方形アイコン (1024x1024, PNG)。 */
  avatar: Buffer;
  /** 横長ヘッダー (1536x1024 相当, JPEG)。 */
  header: Buffer;
}

export interface GenerateNoteAccountDesignImagesDeps {
  /** テスト差し替え / withImageLogging 済み関数の注入口。既定は素の generateImage。 */
  generateImage?: GenerateImageFn;
}

/**
 * 設計案の avatar_prompt / header_prompt からアイコン・ヘッダー画像を生成する。
 * `persona_type==='person'` のときのみ `withPersonaVisualRules` (実写・顔なし・首から下) を適用する
 * (ブランド型はロゴ/世界観のため人物描写ルールを付けない)。
 */
export async function generateNoteAccountDesignImages(
  design: Pick<NoteAccountDesign, 'avatar_prompt' | 'header_prompt' | 'persona_type'>,
  deps: GenerateNoteAccountDesignImagesDeps = {},
): Promise<NoteAccountDesignImages> {
  const gen = deps.generateImage ?? defaultGenerateImage;
  const applyPersonaRules = design.persona_type === 'person';

  const avatarPrompt = `${design.avatar_prompt}${NO_TEXT_GUARD}`;
  const headerPrompt = `${design.header_prompt}${NO_TEXT_GUARD}`;

  const avatarRes = await gen({
    prompt: applyPersonaRules ? withPersonaVisualRules(avatarPrompt) : avatarPrompt,
    width: 1024,
    height: 1024,
    quality: 'medium',
    outputFormat: 'png',
  });
  const headerRes = await gen({
    prompt: applyPersonaRules ? withPersonaVisualRules(headerPrompt) : headerPrompt,
    width: HEADER_WIDTH,
    height: HEADER_HEIGHT,
    quality: 'medium',
    outputFormat: 'jpeg',
    outputCompression: 90,
  });

  const avatar = avatarRes.images[0];
  const header = headerRes.images[0];
  if (!avatar || !header) {
    throw new Error('generateNoteAccountDesignImages: 画像生成結果が空です');
  }
  return { avatar, header };
}
