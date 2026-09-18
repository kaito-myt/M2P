/**
 * F-059 — 育成投稿担当 (content_creator)。
 *
 * アカウント戦略の「発信の柱」から、宣伝ではない価値提供型の投稿を生成する。
 * フォロワー獲得(=アカウントを育てる)ための投稿。sns_strategist と同パターン。
 */
import type { LLMClient } from '@a2p/contracts/agents';
import {
  AccountContentOutputSchema,
  type AccountContentOutput,
  type ContentCreatorInput,
} from '@a2p/contracts/agents/content-creator';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';

// 複数の育成投稿(日本語)を JSON で返すため、途中切れしないよう十分に確保する。
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/**
 * blog は 1 本 1,500〜2,500 字の長文記事を count 本まとめて返すため 8k では必ず途中切れし、
 * JSON が壊れて `posts` 欠落 (ZodError) になっていた (2026-09-02〜16 本番で blog の育成投稿生成が
 * 25 回リトライ×9 ジョブ全滅)。長文チャンネルは上限を大きく取る。
 */
const LONGFORM_MAX_OUTPUT_TOKENS = 32768;
const LONGFORM_CHANNELS = new Set<string>(['blog', 'note']);

const CHANNEL_LABEL: Record<string, string> = {
  x: 'X (旧 Twitter)',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  note: 'note',
  blog: 'ブログ (自社所有)',
};

/** チャンネル別の1投稿の長さ目安 (プロンプトに埋め込む)。 */
const LEN_GUIDE: Record<string, string> = {
  x: '日本語で110〜130字程度(140字以内。ハッシュタグ・URLは含めない)',
  instagram: 'キャプション2〜4文＋自然な余白',
  tiktok: '短いフック1文＋補足1〜2文(写真モードのキャプション)',
  note: '見出し＋2〜4段落のミニ記事',
  blog:
    '検索流入も意識した本格的な良書紹介記事(1,500〜2,500字程度)。' +
    '## 見出しで3〜5セクションに区切り、(1)導入で「誰のどんな悩み・興味に効くか」、' +
    '(2)本の要点・学べること3〜5個、(3)心に残る一節や具体的な読みどころ、(4)どんな人に薦めたいか、' +
    '(5)そっと背中を押す締め、の流れで構成する。書影の代わりに書名・著者は本文で明記。誇大表現はしない。',
};

/**
 * 媒体別の「止める・最後まで見せる」フック原則 (アルゴリズム特性に合わせる)。
 * ユーザー指針: バズを再現条件に分解し、媒体ごとにネイティブ化する。
 */
const PLATFORM_HOOK: Record<string, string> = {
  x: '1行目で「発見・違和感・思わず人に教えたくなる」余白を作る。結論や刺さる一節を先頭に置き、リポストされる"教えたくなる情報"を優先する。',
  instagram: '冒頭(1枚目相当)の一文だけで中身を読みたくなるタイトルにする。保存価値・シェア価値を最優先。',
  tiktok: '最初の一文で結論・違和感・変化を提示し、3秒以内に「続きを見る理由」を作る。テロップは短く、絵文字や ① ★ 〜 → 等の記号は使わない(文字化けの原因)。',
  note: '冒頭で「最後まで読む理由」を提示。一次情報・体験・独自の見立てを入れて読み応えを出す。',
  blog: '検索流入を意識し、冒頭で結論と読む価値を提示する。',
};

export interface ContentCreatorDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  orgTaskId?: string;
}

export async function createAccountContent(
  input: ContentCreatorInput,
  deps: ContentCreatorDeps = {},
): Promise<AccountContentOutput> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const channelLabel = CHANNEL_LABEL[input.channel] ?? input.channel;
  const lenGuide = LEN_GUIDE[input.channel] ?? '簡潔に';

  const prompt = await loadPrompt('content_creator', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    channel_label: channelLabel,
    length_guide: lenGuide,
  });

  const ctx: LoggingContext = { role: 'content_creator' };
  if (deps.orgTaskId !== undefined) ctx.orgTaskId = deps.orgTaskId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('content_creator', null, ctx, factoryDeps);

  // generateObject は不安定なため generateText + extractLlmJson で受ける(sns_strategist と同様)。
  const completion = await client.complete<string>({
    role: 'content_creator',
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildContentCreatorUserMessage(input, channelLabel, lenGuide) },
    ],
    maxOutputTokens: LONGFORM_CHANNELS.has(input.channel) ? LONGFORM_MAX_OUTPUT_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const parsed = extractLlmJson<unknown>(completion.text);
  if (parsed === undefined) {
    throw new Error('content_creator: 応答から JSON を抽出できませんでした');
  }
  return AccountContentOutputSchema.parse(parsed);
}

export function buildContentCreatorUserMessage(
  input: ContentCreatorInput,
  channelLabel: string,
  lenGuide: string,
): string {
  const pillars = input.pillars
    .map((p, i) => `${i + 1}. ${p.name}${p.description ? ` — ${p.description}` : ''}${p.example_post ? `\n   例: ${p.example_post}` : ''}`)
    .join('\n');
  const readers = input.target_readers.length ? input.target_readers.slice(0, 8).map((t) => `- ${t}`).join('\n') : '(なし)';
  const titles = input.sample_titles.length ? input.sample_titles.slice(0, 10).map((t) => `- ${t}`).join('\n') : '(なし)';

  const platformHook = PLATFORM_HOOK[input.channel] ?? PLATFORM_HOOK.x;

  const lines = [
    `あなたは「${channelLabel}」を運営する **良書紹介アカウントのSNSグロース責任者** です。`,
    '仕事は、実在の良書を1冊とりあげ、読んだ人が「この本を読みたい」と強く思う投稿を作ること。宣伝臭さは出さず、本の核心的な気づき・刺さる一節・意外な要点で"中身の価値"を見せてフォロワーを育てます。',
    '',
    `【この媒体で「止めて・最後まで見せる」ための原則】\n${platformHook}`,
    '',
    input.concept ? `【アカウントのコンセプト】\n${input.concept}` : '',
    input.tone_of_voice ? `【トーン&マナー】\n${input.tone_of_voice}` : '',
    input.character_sheet
      ? `【キャラクター設定(このアカウントの人柄。毎投稿に自然に滲ませる)】\n${input.character_sheet}`
      : '',
    input.playbook_guidance
      ? `\n【市場リサーチに基づく販促プレイブック(最新の"今伸びている型"。必ず反映する)】\n${input.playbook_guidance}`
      : '',
    '',
    '【取り上げる本のテーマ/切り口(この軸で実在の良書を選ぶ)】',
    pillars,
    '',
    '【想定読者(この人の悩み・関心に刺さるように)】',
    readers,
    '',
    '【自社の書籍テーマ(世界観の参考。※自社本の宣伝・購入誘導はしない)】',
    titles,
    '',
    `【作る数】${input.count} 投稿`,
    '',
    '要件:',
    `- 各投稿は完成文でそのまま投稿できる状態にする。長さの目安: ${lenGuide}。`,
    '- 実在の良書(古典・名著・話題書など)を具体的に1冊挙げ、「なぜ読む価値があるか」を1つの鋭い切り口で伝える。抽象的な要約ではなく、具体の気づき・一節・数字で"読みたい"を作る。',
    '- **自社本やAmazonの宣伝・購入誘導・URLは入れない**(それは別の宣伝投稿が担う)。ハッシュタグも入れない(後段で付与)。',
    '- テンプレっぽさ・誇張・煽りを避け、トーンを一貫させる。',
    '- 各投稿に、どのテーマ軸かを pillar(柱の name)として付ける。',
    input.character_sheet
      ? '- 毎投稿に、上記キャラクター設定の人柄が伝わる要素(口癖・日常の一コマ・率直な感情・自分の失敗談のいずれか)を最低1つ自然に入れる。ただし主役は本の紹介・価値提供で、自分語りは投稿全体の2〜3割まで。'
      : '',
    '',
    '【出す前の自己チェック(弱い案は作り直す)】各投稿が次を満たすか自問する: ①一瞬で読む手が止まるフックか ②想定読者が自分事に感じるか ③既視感がなく新規性があるか ④「この本読みたい」と思わせるか ⑤保存・人に教えたくなるか。満たさなければ書き直す。',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
