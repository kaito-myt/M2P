/**
 * docs/11-anp-design.md §3.4 F-ANP-30 — note 記事の SNS 告知投稿担当 (role='anp.promo')。
 *
 * A2P の content_creator (`packages/agents/src/content-creator/index.ts`) は「自社本や
 * Amazon の宣伝・購入誘導・URL は入れない」ことを明示的なルールとしている育成投稿担当のため、
 * note 記事の告知 (note_url を必ず含める) を content_creator に混ぜると既存ルールと矛盾する。
 * そのため役割を分離し、`anp.promo` という独立の role/プロンプトを新設した
 * (docs/11 §7 に判断根拠を記載)。
 *
 * 5 チャンネル共通の販促ペルソナ (`promotion_channel_settings.strategy_json`) を土台に、
 * note 記事 1 本を「読んでよかった記事として紹介する」投稿を 1 本生成する。
 */
import type { LLMClient } from '@a2p/contracts/agents';
import {
  AnpPromoContentInputSchema,
  AnpPromoContentOutputSchema,
  type AnpPromoContentInput,
  type AnpPromoContentOutput,
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

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

// TikTok は記事非連動の動画生成経路に乗ってしまうため Phase 4 まで対象外(docs/11 §3.4/§7)。
const CHANNEL_LABEL: Record<string, string> = {
  x: 'X (旧 Twitter)',
  instagram: 'Instagram',
};

const LEN_GUIDE: Record<string, string> = {
  x: '日本語で90〜120字程度(140字以内。URL・ハッシュタグは含めない、呼出側で付与する)',
  instagram: 'キャプション2〜3文＋自然な余白(URL・ハッシュタグは含めない)',
};

export interface CreateAnpArticlePromoContentDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  jobId?: string;
}

export async function createAnpArticlePromoContent(
  input: AnpPromoContentInput,
  deps: CreateAnpArticlePromoContentDeps = {},
): Promise<AnpPromoContentOutput> {
  const parsedInput = AnpPromoContentInputSchema.parse(input);

  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const channelLabel = CHANNEL_LABEL[parsedInput.channel] ?? parsedInput.channel;
  const lenGuide = LEN_GUIDE[parsedInput.channel] ?? '簡潔に';

  const prompt = await loadPrompt('anp.promo', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, {
    channel_label: channelLabel,
    length_guide: lenGuide,
  });

  const ctx: LoggingContext = { role: 'anp.promo' };
  if (deps.jobId !== undefined) ctx.jobId = deps.jobId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('anp.promo', null, ctx, factoryDeps);

  const completion = await client.complete<string>({
    role: 'anp.promo',
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserMessage(parsedInput, channelLabel, lenGuide) },
    ],
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    enablePromptCaching: true,
  });

  const parsed = extractLlmJson<unknown>(completion.text);
  if (parsed === undefined) {
    throw new Error('anp.promo: 応答から JSON を抽出できませんでした');
  }
  return AnpPromoContentOutputSchema.parse(parsed);
}

export function buildUserMessage(
  input: AnpPromoContentInput,
  channelLabel: string,
  lenGuide: string,
): string {
  const lines = [
    `あなたは「${channelLabel}」を運営する **良書紹介アカウントのSNSグロース責任者** です。`,
    'あなたが最近読んで良かった note 記事を1本、フォロワーに紹介する投稿を作ります。',
    '',
    input.persona.concept ? `【アカウントのコンセプト】\n${input.persona.concept}` : '',
    input.persona.tone_of_voice ? `【トーン&マナー】\n${input.persona.tone_of_voice}` : '',
    input.playbook_guidance ? `\n【市場リサーチに基づく販促プレイブック(反映する)】\n${input.playbook_guidance}` : '',
    '',
    '【紹介する記事】',
    `タイトル: ${input.article.title}`,
    input.article.hook ? `差別化フック: ${input.article.hook}` : '',
    input.article.lead ? `リード文: ${input.article.lead}` : '',
    `扱うテーマ: ${input.article.niche}`,
    '',
    '要件:',
    `- 長さの目安: ${lenGuide}。`,
    '- 「この記事読んでよかった」と素直に思わせる、記事の核心的な気づき・意外な要点を具体的に伝える。',
    '- URL・ハッシュタグは絶対に含めない(呼出側で付与する)。',
    '- テンプレっぽさ・誇張・煽りを避ける。',
    '',
    '出力形式: JSON で以下を返してください。',
    '{ "body": string }',
    'JSON 以外のテキストは出力しないこと。',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
