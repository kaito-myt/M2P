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
  NoteAccountProfileInputSchema,
  NoteAccountProfileOutputSchema,
  type NoteAccountDesign,
  type NoteAccountDesignBrief,
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
    const completion = await client.complete<string>({
      role: 'anp.strategist',
      genre: null,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      maxOutputTokens: 4096,
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
