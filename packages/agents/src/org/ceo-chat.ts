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
  CEO_PROTECTED_ROLES,
  CEO_SETTINGS_WHITELIST,
  DIVISION_KINDS,
  type CeoChatOutput,
  type CeoResearchResult,
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
  /**
   * F-098: 前のターンで CEO が要求した検索クエリの結果 (Tavily)。
   * これが入っているターンは「調べ直し」ではなく **結論を出す** ターン。
   */
  research?: CeoResearchResult[];
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
    ...(input.research && input.research.length > 0
      ? [
          '【あなたの依頼で調べた Web 検索結果】',
          ...input.research.flatMap((r) => [
            `検索: ${r.query}`,
            ...r.results.map((x) => `  - ${x.title} ${x.url} / ${x.snippet}`),
          ]),
          '※ この結果を踏まえて結論を出すこと。research_queries は空にする。',
          '',
        ]
      : []),
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
    '',
    '【あなたが会話の中で直接できること (F-098)】',
    '運営者はあなたとの会話だけで運営を完結させたいと考えています。以下は起票ではなく **その場で反映** されます。',
    '- prompt_edits: 各エージェントのシステムプロンプトを改訂する。{role, instruction}。',
    `  改訂できない role: ${CEO_PROTECTED_ROLES.join(' / ')} (あなた自身の制御ループのため)。`,
    '- settings_changes: 運用トグルの ON/OFF。{key, value, reason}。指定できる key は次のみ:',
    ...Object.entries(CEO_SETTINGS_WHITELIST).map(([k, label]) => `    ${k} = ${label}`),
    '- model_changes: 役割ごとの AI モデル割当変更。{role, provider(anthropic|openai|google), model, reasoning_effort, reason}。',
    '  model_catalog に存在するモデルのみ。コストと品質の根拠を reason に書くこと。',
    '- research_queries: 外部情報が要るときの検索クエリ (最大3)。これを返すと worker が Web 検索し、',
    '  その結果を添えて **もう一度あなたに聞き直します**。検索結果が添えられているターンでは',
    '  research_queries を空にして結論を出すこと (無限ループ防止)。',
    '',
    '【会話ではできないこと】',
    '- ソースコードの変更はこの場では反映されません。必要なら code_requests に',
    '  {title, intent, files, change_summary, urgency} で **要求として起票** してください (運営者/開発担当が実装します)。',
    '- 出版・販促の停止/再開は settings_changes で行います (タスク起票ではなく設定変更が確実)。',
  ].join('\n');
}
