/**
 * docs/06 — CEO 対話エージェント。運営者が自然言語で会社(CEO)に指示・相談し、
 * CEO が対話で応じつつ、施策として起票すべき org_tasks を new_tasks に出す。
 *
 * ceo.ts(方針立案)と別ロール 'ceo_chat' を用いる（チャット用プロンプト＋モデル割当）。
 * manager.ts と同パターン: loadActivePrompt → createAgentClient → responseSchema。
 */
import type { LLMClient, AgentRole } from '@a2p/contracts/agents';
import {
  CeoChatOutputSchema,
  DIVISION_KINDS,
  type CeoChatOutput,
  type Division,
} from '@a2p/contracts/org';

import { createAgentClient as defaultCreateAgentClient } from '../lib/llm-client-factory.js';
import {
  loadActivePrompt as defaultLoadActivePrompt,
  type PromptLoaderDeps,
} from '../lib/prompt-loader.js';
import type { LoggingContext, WithTokenLoggingDeps } from '../lib/with-token-logging.js';
import type { LoadModelAssignmentDeps } from '../lib/load-model-assignment.js';
import type { CompanySnapshot } from './ceo.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

const CEO_CHAT_ROLE = 'ceo_chat' as AgentRole;

export interface CeoChatTurn {
  role: 'operator' | 'ceo';
  content: string;
}

export interface CeoChatInput {
  /** 会社の現況スナップショット（worker が DB から組み立てる）。 */
  snapshot: CompanySnapshot;
  /** これまでの対話履歴（古い順）。最後の operator 発話が今回の指示。 */
  history: CeoChatTurn[];
  /** 今回の運営者メッセージ。 */
  message: string;
}

export interface CeoChatDeps {
  loadActivePrompt?: typeof defaultLoadActivePrompt;
  createAgentClient?: typeof defaultCreateAgentClient;
  promptLoaderDeps?: PromptLoaderDeps;
  loadAssignmentDeps?: LoadModelAssignmentDeps;
  withTokenLoggingDeps?: WithTokenLoggingDeps;
  getApiKey?: (provider: string) => Promise<string>;
  orgTaskId?: string;
}

function kindsCatalog(): string {
  return (Object.keys(DIVISION_KINDS) as Division[])
    .map((d) => `${d}: ${DIVISION_KINDS[d].join(', ')}`)
    .join('\n');
}

export async function chatWithCeo(input: CeoChatInput, deps: CeoChatDeps = {}): Promise<CeoChatOutput> {
  const loadPrompt = deps.loadActivePrompt ?? defaultLoadActivePrompt;
  const makeClient = deps.createAgentClient ?? defaultCreateAgentClient;

  const prompt = await loadPrompt(CEO_CHAT_ROLE, null, deps.promptLoaderDeps);
  const systemPrompt = prompt.template;

  const ctx: LoggingContext = { role: CEO_CHAT_ROLE };
  if (deps.orgTaskId !== undefined) ctx.orgTaskId = deps.orgTaskId;

  const factoryDeps: Parameters<typeof makeClient>[3] = {};
  if (deps.loadAssignmentDeps) factoryDeps.loadAssignmentDeps = deps.loadAssignmentDeps;
  if (deps.withTokenLoggingDeps) factoryDeps.withTokenLoggingDeps = deps.withTokenLoggingDeps;
  if (deps.getApiKey) factoryDeps.getApiKey = deps.getApiKey;

  const client: LLMClient = await makeClient(CEO_CHAT_ROLE, null, ctx, factoryDeps);

  const completion = await client.complete<CeoChatOutput>({
    role: CEO_CHAT_ROLE,
    genre: null,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildCeoChatUserMessage(input) },
    ],
    responseSchema: CeoChatOutputSchema,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  });

  return CeoChatOutputSchema.parse(completion.text);
}

export function buildCeoChatUserMessage(input: CeoChatInput): string {
  const s = input.snapshot;
  const top = s.sales.top_books.slice(0, 5).map((b) => `${b.title}(¥${b.royalty_jpy})`).join(', ') || '(なし)';
  const history = input.history.length
    ? input.history
        .slice(-10)
        .map((t) => `${t.role === 'operator' ? '運営者' : 'CEO'}: ${t.content}`)
        .join('\n')
    : '(履歴なし)';

  return [
    'あなたは KDP 出版事業を運営する AI 企業の社長(CEO)であり、この会社の P&L に責任を負う経営パートナーです。',
    'オーナー(運営者)と対等に議論します。反射的に同意せず、まず自分の見解(賛成/反対とその根拠)を数字に基づいて述べ、',
    '非効率・時期尚早・前提誤りと判断したら遠慮なく反対し代替案を出してください。おべっかや当たり障りのない同意は不要です。',
    'あなたが経営者として妥当と判断した施策のみ new_tasks に落とし、各本部（制作/出版/分析/販促/運用/経営管理）へ',
    '正しい division と kind で割り当ててください。反対・保留するなら起票せず reply で理由を述べます。',
    '恒常的に効かせたい方針は(合意のうえ) directive_summary に要約し、以後の全社方針に引き継ぎます。',
    '',
    '【会社の現況】',
    `- 期間: ${s.period_label}`,
    `- 書籍: 合計${s.books.total} / 公開${s.books.published} / 要人手${s.books.needs_human_review}`,
    `- 売上: 当月¥${s.sales.last_month_royalty_jpy} / 累計¥${s.sales.total_royalty_jpy}`,
    `- 売れ筋: ${top}`,
    `- 当月コスト: ¥${s.cost.month_jpy}${s.cost.monthly_budget_jpy != null ? ` / 上限¥${s.cost.monthly_budget_jpy}` : ''}`,
    `- 接続チャンネル: ${s.channels.connected.join(', ') || '(なし)'} / 自動投稿ON: ${s.channels.auto_enabled.join(', ') || '(なし)'}`,
    `- 未消化ToDo: ${s.open_tasks}件`,
    '',
    '【本部別に起票できる kind（越境禁止・必ずこの対応で）】',
    kindsCatalog(),
    '',
    '【これまでの対話】',
    history,
    '',
    '【運営者からの新しいメッセージ】',
    input.message,
    '',
    '出力要件:',
    '- reply: 運営者への返答。必ず ①あなた自身の見解(賛成/反対とその根拠) ②数字に基づく現状認識',
    '  (売上/コスト/冊数/公開数から、効いている点・ボトルネック・単位経済) ③次の一手 or オーナーへの問い を含める。',
    '  現状ほぼ未黒字である前提で「黒字化への最短距離か」を最優先の判断軸にする。抽象論・精神論は禁止。',
    '- new_tasks: あなたが妥当と判断した施策のみ。反対・保留なら空配列(reply に理由)。kind は必ず該当 division のものを使う。',
    '  制作の新規企画は production/plan_book（書籍コンセプトのみ。SNS販促等は入れない）。',
    '  販促は promotion/create_content|publish_post|analyze_promo。価格/メタデータは publishing。',
    '- directive_summary: 恒常的に効かせたい方針があれば1〜2文で要約（なければ省略）。',
  ].join('\n');
}
