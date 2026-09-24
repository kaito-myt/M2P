/**
 * `org.ceo.chat` タスク — 運営者 ⇔ CEO の対話を 1 往復処理する。
 *
 * フロー:
 *  1. payload.message_id の operator メッセージ(status=pending)を processing にする
 *  2. 会社の現況スナップショット＋直近の対話履歴を組み立てる
 *  3. chatWithCeo(CEOエージェント)で返答＋起票すべき new_tasks を生成
 *  4. new_tasks を org_tasks へ起票（kind は division 内のもののみ採用。
 *     自動承認トグルに従い approved/proposed、人手前提kindは needs_human）
 *  5. CEO 返答を org_ceo_messages(role='ceo') に保存、operator メッセージを done に
 *
 * directive_summary は org.plan(日次ティック)が別途 operator メッセージ本文から拾うため
 * ここでは result_json に保存するのみ（恒常方針は運営者メッセージ自体が引き継ぎ元）。
 */
import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  chatWithCeo as defaultChatWithCeo,
  rewriteAgentPrompt as defaultRewriteAgentPrompt,
  type CeoChatDeps,
  type CeoChatTurn,
} from '@a2p/agents';
import type { CompanySnapshot } from '@a2p/agents';
import {
  CEO_PROTECTED_ROLES,
  CEO_SETTINGS_WHITELIST,
  DIVISION_KINDS,
  DIVISION_DEFAULT_ASSIGNEE,
  isHumanKind,
  type CeoChatOutput,
  type CeoCodeRequest,
  type CeoModelChange,
  type CeoResearchResult,
  type CeoSettingChange,
  type Division,
  type PromptEditorInput,
  type PromptEditorOutput,
} from '@a2p/contracts/org';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { Prisma, prisma as defaultPrisma } from '@a2p/db';

export const ORG_CEO_CHAT_TASK_NAME = 'org.ceo.chat';

export const OrgCeoChatPayloadSchema = z.object({
  message_id: z.string().min(1),
});

/** F-089 — CEO が改訂してはならない role（自身の制御ループ保護）。 */
const PROMPT_EDIT_EXCLUDED_ROLES = new Set<string>(CEO_PROTECTED_ROLES);

/** F-098 — 1 ターンで許す Web 検索の往復回数 (無限ループ防止)。 */
const MAX_RESEARCH_ROUNDS = 1;
/** F-098 — 1 クエリあたりの検索結果数。 */
const RESEARCH_RESULTS_PER_QUERY = 5;

type RewriteAgentPromptFn = (input: PromptEditorInput) => Promise<PromptEditorOutput>;

/** 本文中の {placeholder} を重複なく抽出する。 */
function extractPlaceholders(body: string): string[] {
  const found = body.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  return [...new Set(found)];
}

interface PromptEditResult {
  role: string;
  ok: boolean;
  to_version?: number;
  note: string;
}

/**
 * F-089 — CEO 起点の 1 件のプロンプト改訂を適用する。
 * loadActivePrompt 相当を prisma で行い、prompt_editor で最小改訂 → プレースホルダ検証 →
 * $transaction で「提案作成＋旧activeをarchive＋新版active＋監査」を原子的に実施。
 */
async function applyCeoPromptEdit(
  prisma: typeof defaultPrisma,
  rewrite: RewriteAgentPromptFn,
  edit: { role: string; instruction: string },
  messageId: string,
  now: Date,
  log: Logger,
): Promise<PromptEditResult> {
  const role = edit.role.trim();
  if (PROMPT_EDIT_EXCLUDED_ROLES.has(role)) {
    return { role, ok: false, note: `${role} は保護対象のため改訂できません` };
  }

  // 現行 active プロンプト（genre 既定 = null を優先、無ければ任意の active）。
  const current =
    (await prisma.prompt.findFirst({
      where: { role, genre: null, status: 'active' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, body: true, genre: true, placeholders_json: true },
    })) ??
    (await prisma.prompt.findFirst({
      where: { role, status: 'active' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, body: true, genre: true, placeholders_json: true },
    }));

  if (!current) {
    return { role, ok: false, note: `${role} の現行プロンプトが見つかりません` };
  }

  const placeholders = extractPlaceholders(current.body);
  const out = await rewrite({
    target_role: role,
    current_body: current.body,
    instruction: edit.instruction,
    placeholders,
  });

  const newBody = out.new_body?.trim() ?? '';
  if (!newBody) {
    return { role, ok: false, note: `${role} の改訂結果が空でした` };
  }
  if (newBody === current.body.trim()) {
    return { role, ok: false, note: `${role} は変更なしでした` };
  }
  const missing = placeholders.filter((p) => !newBody.includes(p));
  if (missing.length) {
    return { role, ok: false, note: `${role} は必須プレースホルダ ${missing.join(' ')} が欠落したため中止` };
  }

  const newVersion = current.version + 1;
  const rollbackUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const diff = `-- ${role} v${current.version} → v${newVersion}\n${out.summary || out.rationale || ''}`.slice(0, 4000);

  await prisma.$transaction(async (tx) => {
    const proposal = await tx.promptProposal.create({
      data: {
        source_prompt_id: current.id,
        role,
        genre: current.genre,
        proposed_body: newBody,
        diff,
        rationale: out.rationale || out.summary || 'CEO 指示による改訂',
        expected_effect_json: { source: 'ceo', summary: out.summary || '' },
        status: 'auto_approved',
        decided_by: 'ceo',
        decided_at: now,
        rollback_until: rollbackUntil,
      },
      select: { id: true },
    });

    await tx.prompt.update({
      where: { id: current.id },
      data: { status: 'archived', archived_at: now },
    });

    const created = await tx.prompt.create({
      data: {
        role,
        genre: current.genre,
        version: newVersion,
        body: newBody,
        placeholders_json: current.placeholders_json ?? [],
        status: 'active',
        created_by: `ceo:${messageId}`,
        activated_at: now,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        actor_id: null,
        action: 'prompt.approve',
        target_kind: 'prompt_proposal',
        target_id: proposal.id,
        before_json: { status: 'pending', trigger: 'ceo', message_id: messageId },
        after_json: {
          status: 'auto_approved',
          new_prompt_id: created.id,
          role,
          from_version: current.version,
          to_version: newVersion,
          rollback_until: rollbackUntil.toISOString(),
        },
      },
    });
  });

  log.info({ task: ORG_CEO_CHAT_TASK_NAME, role, to_version: newVersion }, 'ceo prompt edit applied');
  return { role, ok: true, to_version: newVersion, note: `${role} を v${newVersion} に更新（${out.summary || '改訂'}）` };
}

/**
 * [F-098] CEO による運用トグルの変更を適用する。ホワイトリスト外・boolean 以外は拒否。
 * 会話で完結させるための機能なので「起票」ではなくその場で反映し、audit_log に残す。
 */
export async function applyCeoSettingChanges(
  prisma: typeof defaultPrisma,
  changes: readonly CeoSettingChange[],
  messageId: string,
  log: Logger,
): Promise<Array<{ key: string; ok: boolean; note: string }>> {
  const out: Array<{ key: string; ok: boolean; note: string }> = [];
  if (changes.length === 0) return out;

  const allowed = Object.keys(CEO_SETTINGS_WHITELIST);
  const current = (await prisma.appSettings.findUnique({ where: { id: 'singleton' } })) as unknown as
    | Record<string, unknown>
    | null;

  for (const ch of changes) {
    const key = ch.key.trim();
    if (!allowed.includes(key)) {
      out.push({ key, ok: false, note: `${key} は CEO が変更できる設定ではありません` });
      continue;
    }
    const before = current ? current[key] : null;
    if (before === ch.value) {
      out.push({ key, ok: true, note: `${CEO_SETTINGS_WHITELIST[key]} は既に ${ch.value ? 'ON' : 'OFF'} です` });
      continue;
    }
    try {
      await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: { [key]: ch.value } as never,
      });
      await prisma.auditLog.create({
        data: {
          actor_id: null,
          action: 'settings.update',
          target_kind: 'app_settings',
          target_id: key,
          before_json: { value: before ?? null, trigger: 'ceo', message_id: messageId },
          after_json: { value: ch.value, reason: ch.reason },
        },
      });
      out.push({
        key,
        ok: true,
        note: `${CEO_SETTINGS_WHITELIST[key]} を ${ch.value ? 'ON' : 'OFF'} に変更 (${ch.reason})`,
      });
      log.info({ task: ORG_CEO_CHAT_TASK_NAME, key, value: ch.value }, 'ceo setting change applied');
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      out.push({ key, ok: false, note: `${key} の変更に失敗 (${em})` });
    }
  }
  return out;
}

/**
 * [F-098] CEO によるモデル割当の変更を適用する (genre 既定行のみ)。
 * 保護 role・カタログに無いモデル・利用不可のモデルは拒否する。
 */
export async function applyCeoModelChanges(
  prisma: typeof defaultPrisma,
  changes: readonly CeoModelChange[],
  messageId: string,
  now: Date,
  log: Logger,
): Promise<Array<{ role: string; ok: boolean; note: string }>> {
  const out: Array<{ role: string; ok: boolean; note: string }> = [];
  for (const ch of changes) {
    const role = ch.role.trim();
    if (PROMPT_EDIT_EXCLUDED_ROLES.has(role)) {
      out.push({ role, ok: false, note: `${role} は保護対象のためモデルを変更できません` });
      continue;
    }
    const catalog = await prisma.modelCatalog.findFirst({
      where: { provider: ch.provider, model: ch.model, is_current: true },
      select: { available: true },
    });
    if (!catalog) {
      out.push({ role, ok: false, note: `${ch.provider}/${ch.model} はモデルカタログにありません` });
      continue;
    }
    if (catalog.available === false) {
      out.push({ role, ok: false, note: `${ch.provider}/${ch.model} は現在利用できません` });
      continue;
    }
    const before = await prisma.modelAssignment.findFirst({
      where: { role, genre: null, status: 'active' },
      select: { id: true, provider: true, model: true, reasoning_effort: true },
    });
    if (before && before.provider === ch.provider && before.model === ch.model) {
      out.push({ role, ok: true, note: `${role} は既に ${ch.provider}/${ch.model} です` });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.modelAssignment.updateMany({
          where: { role, genre: null, status: 'active' },
          data: { status: 'archived', archived_at: now },
        });
        await tx.modelAssignment.create({
          data: {
            role,
            genre: null,
            provider: ch.provider,
            model: ch.model,
            reasoning_effort: ch.reasoning_effort ?? null,
            status: 'active',
            activated_at: now,
            created_by: `ceo:${messageId}`,
          },
        });
        await tx.auditLog.create({
          data: {
            actor_id: null,
            action: 'model_assignment.upsert',
            target_kind: 'model_assignment',
            target_id: `${role}:default`,
            before_json: before
              ? { provider: before.provider, model: before.model, reasoning_effort: before.reasoning_effort ?? null }
              : Prisma.JsonNull,
            after_json: {
              provider: ch.provider,
              model: ch.model,
              reasoning_effort: ch.reasoning_effort ?? null,
              reason: ch.reason,
              trigger: 'ceo',
              message_id: messageId,
            },
          },
        });
      });
      out.push({
        role,
        ok: true,
        note: `${role} を ${ch.provider}/${ch.model}${ch.reasoning_effort ? ` (${ch.reasoning_effort})` : ''} に変更 (${ch.reason})`,
      });
      log.info({ task: ORG_CEO_CHAT_TASK_NAME, role, model: ch.model }, 'ceo model change applied');
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      out.push({ role, ok: false, note: `${role} のモデル変更に失敗 (${em})` });
    }
  }
  return out;
}

/** [F-098] CEO からのソースコード変更要求を起票する (自動では適用されない)。 */
export async function saveCeoCodeRequests(
  prisma: typeof defaultPrisma,
  requests: readonly CeoCodeRequest[],
  messageId: string,
): Promise<Array<{ title: string; id: string }>> {
  const out: Array<{ title: string; id: string }> = [];
  for (const r of requests) {
    const created = await prisma.orgCodeRequest.create({
      data: {
        title: r.title,
        intent: r.intent,
        files_json: r.files,
        change_summary: r.change_summary,
        urgency: r.urgency,
        status: 'open',
        source_message_id: messageId,
      },
      select: { id: true },
    });
    out.push({ title: r.title, id: created.id });
  }
  return out;
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function periodLabel(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

type ChatWithCeoFn = (input: {
  snapshot: CompanySnapshot;
  history: CeoChatTurn[];
  message: string;
  research?: CeoResearchResult[];
}, deps?: CeoChatDeps) => Promise<CeoChatOutput>;

export interface OrgCeoChatDeps {
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  chatWithCeo?: ChatWithCeoFn;
  rewriteAgentPrompt?: RewriteAgentPromptFn;
  now?: () => Date;
  /** F-098: Web 検索 (既定は Tavily)。空配列を返すと検索なしで続行する。 */
  webSearch?: (queries: readonly string[]) => Promise<CeoResearchResult[]>;
}

export interface OrgCeoChatResult {
  reply_message_id: string | null;
  created_task_ids: string[];
  status: 'done' | 'failed';
}

async function buildSnapshot(prisma: typeof defaultPrisma, now: Date): Promise<CompanySnapshot> {
  const [books, sales, costAgg, channelRows, openTasks, settings] = await Promise.all([
    prisma.book.findMany({ select: { id: true, status: true, publish_status: true } }),
    prisma.salesRecord.findMany({
      select: { book_id: true, year_month: true, royalty_jpy: true, book: { select: { title: true } } },
    }),
    prisma.tokenUsage.aggregate({
      _sum: { cost_jpy: true },
      where: { created_at: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) } },
    }),
    prisma.promotionChannelSetting.findMany({
      select: { channel: true, auto_enabled: true, handle: true, token_mask: true },
    }),
    prisma.orgTask.count({ where: { status: { in: ['proposed', 'approved', 'in_progress'] } } }),
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { monthly_cost_red_jpy: true } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const b of books) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  const published = books.filter((b) => b.publish_status === 'published').length;

  const maxMonth = sales.reduce((m, r) => (r.year_month > m ? r.year_month : m), '');
  const lastMonth = sales.filter((r) => r.year_month === maxMonth).reduce((a, r) => a + toNumber(r.royalty_jpy), 0);
  const total = sales.reduce((a, r) => a + toNumber(r.royalty_jpy), 0);
  const bookMap = new Map<string, { title: string; royalty: number }>();
  for (const r of sales) {
    const cur = bookMap.get(r.book_id) ?? { title: r.book?.title ?? '(不明)', royalty: 0 };
    cur.royalty += toNumber(r.royalty_jpy);
    bookMap.set(r.book_id, cur);
  }
  const topBooks = [...bookMap.values()]
    .sort((a, b) => b.royalty - a.royalty)
    .slice(0, 5)
    .map((x) => ({ title: x.title, royalty_jpy: x.royalty }));

  const connected = channelRows.filter((c) => c.handle || c.token_mask).map((c) => c.channel);
  const autoEnabled = channelRows.filter((c) => c.auto_enabled).map((c) => c.channel);

  return {
    period_label: periodLabel(now),
    books: {
      total: books.length,
      by_status: byStatus,
      needs_human_review: byStatus['judging'] ?? 0,
      published,
    },
    sales: { last_month_royalty_jpy: lastMonth, total_royalty_jpy: total, top_books: topBooks },
    cost: { month_jpy: Math.round(toNumber(costAgg._sum.cost_jpy)), monthly_budget_jpy: settings?.monthly_cost_red_jpy ?? null },
    channels: { connected, auto_enabled: autoEnabled },
    open_tasks: openTasks,
  };
}

/**
 * [F-098] 既定の Web 検索 — Tavily。キー未設定なら空配列 (検索なしで続行)。
 * Anthropic 純正 web_search は無上限ループで数分かかる実測があるため使わない (docs/03 §R-04)。
 */
async function defaultCeoWebSearch(queries: readonly string[]): Promise<CeoResearchResult[]> {
  const { getTavilyApiKey } = await import('@a2p/agents/lib/get-tavily-key');
  const key = await getTavilyApiKey();
  if (!key) return [];
  const { createWebSearchAdapter } = await import('@a2p/agents/tools/web-search');
  const adapter = createWebSearchAdapter({ provider: 'tavily', tavilyApiKey: key });
  const out: CeoResearchResult[] = [];
  for (const query of queries.slice(0, 3)) {
    try {
      const res = await adapter.search({ query, maxResults: RESEARCH_RESULTS_PER_QUERY });
      out.push({
        query,
        results: res.items.slice(0, RESEARCH_RESULTS_PER_QUERY).map((i) => ({
          title: i.title,
          url: i.url,
          snippet: (i.snippet ?? '').slice(0, 300),
        })),
      });
    } catch {
      out.push({ query, results: [] });
    }
  }
  return out;
}

export async function runOrgCeoChat(payload: unknown, deps: OrgCeoChatDeps = {}): Promise<OrgCeoChatResult> {
  const parsed = OrgCeoChatPayloadSchema.parse(payload ?? {});
  const prisma = deps.prisma ?? defaultPrisma;
  const log = deps.logger ?? createLogger(`worker.${ORG_CEO_CHAT_TASK_NAME}`);
  const now = deps.now ?? (() => new Date());
  const chat = deps.chatWithCeo ?? (defaultChatWithCeo as unknown as ChatWithCeoFn);
  const rewrite = deps.rewriteAgentPrompt ?? (defaultRewriteAgentPrompt as unknown as RewriteAgentPromptFn);

  const opMsg = await prisma.orgCeoMessage.findUnique({ where: { id: parsed.message_id } });
  if (!opMsg || opMsg.role !== 'operator') {
    log.warn({ task: ORG_CEO_CHAT_TASK_NAME, message_id: parsed.message_id }, 'operator message not found');
    return { reply_message_id: null, created_task_ids: [], status: 'failed' };
  }
  if (opMsg.status !== 'pending' && opMsg.status !== 'failed') {
    // 既に処理済み（二重実行防止）。
    return { reply_message_id: null, created_task_ids: [], status: 'done' };
  }

  await prisma.orgCeoMessage.update({ where: { id: opMsg.id }, data: { status: 'processing' } });

  try {
    const snapshot = await buildSnapshot(prisma, now());

    const historyRows = await prisma.orgCeoMessage.findMany({
      where: { created_at: { lt: opMsg.created_at } },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { role: true, content: true },
    });
    const history: CeoChatTurn[] = historyRows
      .reverse()
      .map((r) => ({ role: r.role === 'ceo' ? 'ceo' : 'operator', content: r.content }));

    let out = await chat({ snapshot, history, message: opMsg.content });

    // [F-098] CEO が外部情報を要求したら 1 往復だけ検索して聞き直す (無限ループ防止)。
    let research: CeoResearchResult[] = [];
    const searchFn = deps.webSearch ?? defaultCeoWebSearch;
    for (let round = 0; round < MAX_RESEARCH_ROUNDS; round += 1) {
      const queries = (out.research_queries ?? []).filter((q) => q.trim().length > 0);
      if (queries.length === 0) break;
      log.info({ task: ORG_CEO_CHAT_TASK_NAME, queries }, 'ceo requested web research');
      research = await searchFn(queries).catch((e) => {
        log.warn({ task: ORG_CEO_CHAT_TASK_NAME, err: e }, 'ceo web research failed');
        return [] as CeoResearchResult[];
      });
      if (research.length === 0) break;
      out = await chat({ snapshot, history, message: opMsg.content, research });
    }

    // 自動承認トグル。
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { org_auto_approve_tasks: true },
    });
    const autoApprove = settings?.org_auto_approve_tasks ?? true;

    // アクティブ Objective（あれば紐付け）。
    const activeObj = await prisma.orgObjective.findFirst({
      where: { status: 'active' },
      orderBy: { created_at: 'desc' },
      select: { id: true },
    });

    // 対象書籍の存在チェック用。
    const createdTaskIds: string[] = [];
    for (const t of out.new_tasks) {
      const allowed = DIVISION_KINDS[t.division as Division] as readonly string[] | undefined;
      if (!allowed || !allowed.includes(t.kind)) {
        log.warn({ task: ORG_CEO_CHAT_TASK_NAME, division: t.division, kind: t.kind }, 'skip task: kind not in division');
        continue;
      }
      let bookId: string | null = null;
      if (t.book_id) {
        const b = await prisma.book.findUnique({ where: { id: t.book_id }, select: { id: true } });
        bookId = b?.id ?? null;
      }
      const status = isHumanKind(t.kind) ? 'needs_human' : autoApprove ? 'approved' : 'proposed';
      const created = await prisma.orgTask.create({
        data: {
          objective_id: activeObj?.id ?? null,
          division: t.division,
          book_id: bookId,
          owner_role: 'ceo',
          assignee_role: isHumanKind(t.kind) ? 'human' : DIVISION_DEFAULT_ASSIGNEE[t.division as Division],
          kind: t.kind,
          title: t.title,
          instruction: t.instruction,
          status,
          priority: t.priority ?? 'should',
        },
        select: { id: true },
      });
      createdTaskIds.push(created.id);
    }

    // F-089 — CEO 起点のプロンプト改訂。1件ずつ安全に適用（1件失敗しても対話は壊さない）。
    const promptEditResults: PromptEditResult[] = [];
    for (const edit of out.prompt_edits ?? []) {
      try {
        const r = await applyCeoPromptEdit(prisma, rewrite, edit, opMsg.id, now(), log);
        promptEditResults.push(r);
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        log.error({ task: ORG_CEO_CHAT_TASK_NAME, role: edit.role, err: e }, 'ceo prompt edit failed');
        promptEditResults.push({ role: edit.role, ok: false, note: `${edit.role} の改訂に失敗（${em}）` });
      }
    }

    // [F-098] 運用トグル / モデル割当 / コード変更要求を適用する。
    const settingResults = await applyCeoSettingChanges(prisma, out.settings_changes ?? [], opMsg.id, log);
    const modelResults = await applyCeoModelChanges(prisma, out.model_changes ?? [], opMsg.id, now(), log);
    const codeRequests = await saveCeoCodeRequests(prisma, out.code_requests ?? [], opMsg.id);

    const NL2 = String.fromCharCode(10);
    const sections: string[] = [];
    const bullets = (rows: Array<{ ok: boolean; note: string }>): string =>
      rows.map((r) => `${r.ok ? '✅' : '⚠️'} ${r.note}`).join(NL2);
    if (promptEditResults.length) sections.push(`――― プロンプト改訂 ―――${NL2}${bullets(promptEditResults)}`);
    if (settingResults.length) sections.push(`――― 設定変更 ―――${NL2}${bullets(settingResults)}`);
    if (modelResults.length) sections.push(`――― モデル割当 ―――${NL2}${bullets(modelResults)}`);
    if (codeRequests.length) {
      sections.push(
        `――― コード変更要求 (起票のみ・実装は開発側) ―――${NL2}${codeRequests.map((c) => `📝 ${c.title}`).join(NL2)}`,
      );
    }
    if (research.length) {
      sections.push(`――― 参照した Web 検索 ―――${NL2}${research.map((r) => `🔎 ${r.query} (${r.results.length}件)`).join(NL2)}`);
    }
    const replyContent = sections.length ? `${out.reply}${NL2}${NL2}${sections.join(NL2 + NL2)}` : out.reply;

    const ceoMsg = await prisma.orgCeoMessage.create({
      data: {
        role: 'ceo',
        content: replyContent,
        status: 'done',
        result_json: {
          directive_summary: out.directive_summary ?? null,
          created_task_ids: createdTaskIds,
          auto_approve: autoApprove,
          prompt_edits: promptEditResults.map((r) => ({
            role: r.role,
            ok: r.ok,
            to_version: r.to_version ?? null,
            note: r.note,
          })),
          settings_changes: settingResults,
          model_changes: modelResults,
          code_request_ids: codeRequests.map((c) => c.id),
          research_queries: research.map((r) => r.query),
        },
      },
      select: { id: true },
    });

    await prisma.orgCeoMessage.update({ where: { id: opMsg.id }, data: { status: 'done' } });

    log.info(
      { task: ORG_CEO_CHAT_TASK_NAME, message_id: opMsg.id, created: createdTaskIds.length },
      'ceo chat replied',
    );
    return { reply_message_id: ceoMsg.id, created_task_ids: createdTaskIds, status: 'done' };
  } catch (err) {
    const emsg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log.error({ task: ORG_CEO_CHAT_TASK_NAME, message_id: opMsg.id, err }, 'ceo chat failed');
    await prisma.orgCeoMessage.update({ where: { id: opMsg.id }, data: { status: 'failed' } });
    // 失敗時もCEO側にエラー返答を残す（UIで見えるように）。
    const ceoMsg = await prisma.orgCeoMessage.create({
      data: {
        role: 'ceo',
        content: `申し訳ありません、指示の処理中にエラーが発生しました。もう一度お試しください。（${emsg}）`,
        status: 'done',
        result_json: { error: emsg },
      },
      select: { id: true },
    });
    return { reply_message_id: ceoMsg.id, created_task_ids: [], status: 'failed' };
  }
}

export const orgCeoChatTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runOrgCeoChat(payload);
};
