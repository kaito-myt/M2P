/**
 * F-075 — 手動グロース偵察担当 (growth_scout)。
 *
 * IG/TikTok/note はフォロー/いいねの公式APIが無いため自動化できない。本エージェントは
 * web_search で「そのニッチ(読書/本紹介)で実際にフォロー/いいねすべき実在アカウント・投稿」を
 * 具体的に特定し、運営者が手で実行できる ToDo(GrowthScoutOutput) を出力する。
 * promo_strategist と同じく AgentSdkClient(web_search server tool) 経由 + extractLlmJson。
 */
import type { LLMClient } from '@a2p/contracts/agents';
import {
  GrowthScoutOutputSchema,
  type GrowthScoutInput,
  type GrowthScoutOutput,
} from '@a2p/contracts/agents/growth-scout';
import { genreLabel } from '@a2p/contracts/genres';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import { extractLlmJson } from '../lib/sanitize-llm-json.js';
import {
  fillPlaceholders,
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

const CHANNEL_LABEL: Record<string, string> = {
  x: 'X (旧 Twitter)',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  note: 'note',
  blog: 'ブログ (自社所有)',
};

export interface GrowthScoutDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
}

export async function generateGrowthTodo(
  input: GrowthScoutInput,
  deps: GrowthScoutDeps = {},
): Promise<GrowthScoutOutput> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const channelLabel = CHANNEL_LABEL[input.channel] ?? input.channel;
  const genre = genreLabel(input.genre ?? undefined) ?? '実用書・ビジネス書・自己啓発';
  const prompt = await loadPrompt('growth_scout', null, deps.promptLoaderDeps);
  const systemPrompt = fillPlaceholders(prompt.template, { channel_label: channelLabel, genre });

  const ctx: LoggingContext = { role: 'growth_scout' };
  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient('growth_scout', null, ctx, factoryDeps);

  const completion = await client.complete<string>({
    role: 'growth_scout',
    genre: input.genre ?? null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildScoutUserMessage(input, channelLabel, genre) },
    ],
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  const parsed = extractLlmJson<unknown>(completion.text);
  if (parsed === undefined) {
    throw new Error('growth_scout: 応答から JSON を抽出できませんでした');
  }
  return GrowthScoutOutputSchema.parse(parsed);
}

export function buildScoutUserMessage(
  input: GrowthScoutInput,
  channelLabel: string,
  genre: string,
): string {
  const target = (input.daily_target ?? 15);
  return [
    `「${channelLabel}」で ${genre} の本を紹介するアカウントの**フォロワーを増やす**ため、`,
    '運営者が「手で」実行するフォロー/いいね/コメントの ToDo を作ります。',
    'web_search で **今この分野で実在し活発な**アカウント/投稿を調べ、具体的に特定してください。',
    '一般論やダミーは禁止。実在の @ハンドルや実際の投稿の型を挙げること。',
    '',
    input.concept ? `【アカウントのコンセプト】\n${input.concept}` : '',
    input.target_audience ? `【狙う読者層】\n${input.target_audience}` : '',
    '',
    '調べて特定すること:',
    `- フォローすべき実在アカウント(${channelLabel}): 読書/本紹介ニッチで、うちの読者層と重なるフォロワーを持つ中〜小規模アカウント(相互フォローや発見に繋がりやすい)。@ハンドルと「なぜ」を添える。`,
    '- いいね/コメントすべき投稿の型: 反応が付きやすく、こちらの存在を知ってもらえる投稿(URL か具体的な型)。コメントは定型でなく価値ある一言の例も。',
    '- 探索に使う推奨ハッシュタグ/検索語(規模別)。',
    '',
    `合計 ${target} 件程度の action を、priority(high/mid/low) 付きで出してください。`,
    'follow を中心に、like/comment も混ぜること。',
    '',
    '出力は JSON の GrowthScoutOutput のみ:',
    '{"channel":string,"summary":string,',
    '"actions":[{"action_type":"follow|like|comment","platform":string,"target_handle":string,"target_url":string,"target_desc":string,"reason":string,"priority":"high|mid|low"}],',
    '"search_hashtags":[string],"notes":[string]}。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
