import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `org.ops.watch` タスク (docs/06 §8-4) — 運用本部の横断監視。
 *
 * 制作パイプラインの Job を走査し、
 *  - 失敗ジョブ（リトライ余地あり）→ `recover_job`(approved) を起票（dispatcher が自動再投入）
 *  - リトライ上限到達 or 長時間スタックの running → `triage_error`(needs_human) を起票（人手判断）
 * を全社ToDoバックログに追加する。
 *
 * 暴走防止: 1 book につき開いている sysops タスクがあれば重複起票しない。1 回の起票上限あり。
 * cron（既定OFF）＋ web からの手動起動。
 */

export const ORG_OPS_WATCH_TASK_NAME = 'org.ops.watch';

/** 失敗ジョブを recover と判定する retries 上限（超えたら人手 triage）。 */
const MAX_RECOVER_RETRIES = 3;
/** running のままこの分数を超えたらスタックとみなす。 */
const STUCK_MINUTES = 30;
/** 1 回の watch で起票する ops タスクの上限。 */
const MAX_OPS_TASKS_PER_RUN = 10;
/** 失敗ジョブの検出ウィンドウ（時間）。 */
const FAILED_LOOKBACK_HOURS = 24;

const OPEN_STATUSES = ['proposed', 'approved', 'in_progress', 'blocked', 'needs_human'];

/**
 * モデル/プロバイダの「提供終了・枠枯渇・存在しない」系エラーの検出パターン。
 * これらは失敗ジョブを何度再投入しても直らない（＝設定の是正が必要）ため、
 * 通常の recover(再投入) では無限に空回りする。org.ops.watch が原因を診断して
 * モデル割当を安全な Claude フォールバックへ自動切替する（自己修復）。
 * 過去3回（Gemini枠枯渇×2・モデル廃止×1）書籍生成を静かに止めた事故の恒久対策。
 */
export const MODEL_OUTAGE_RE =
  /no longer available|not available|has been (deprecated|decommissioned|retired|sunset)|model .*(not found|does not exist|is not supported|is not found)|model_not_found|NOT_FOUND|exceeded your .*quota|quota.*(exceed|exhaust)|resource_exhausted|PERMISSION_DENIED|invalid[_ ]?api[_ ]?key|permission denied/i;

/** 失敗した pipeline ジョブの kind → runtime エージェント役割（テキストLLM役のみ）。 */
export const KIND_TO_ROLE: Record<string, string> = {
  'pipeline.book.marketer': 'marketer',
  'pipeline.book.writer.outline': 'writer',
  'pipeline.book.writer.chapter': 'writer',
  'pipeline.book.editor': 'editor',
  'pipeline.book.judge': 'judge',
  'pipeline.book.thumbnail.text': 'thumbnail_text',
  'pipeline.book.readings.generate': 'readings',
};

/** 自己修復のフォールバック先（信頼性重視の Claude）。画像役(thumbnail_image)は対象外。 */
export const MODEL_HEAL_FALLBACK = { provider: 'anthropic', model: 'claude-sonnet-4-6' } as const;

/** エラー文がモデル/プロバイダ提供障害かを判定。 */
export function isModelOutageError(error: string | null | undefined): boolean {
  if (!error) return false;
  return MODEL_OUTAGE_RE.test(error);
}

/** 失敗ジョブ kind → 是正対象の役割（未知kind/画像役は null）。 */
export function roleForKind(kind: string): string | null {
  return KIND_TO_ROLE[kind] ?? null;
}

export const OrgOpsWatchPayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  trigger: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
});

interface WatchJobRow {
  id: string;
  book_id: string | null;
  kind: string;
  status: string;
  retries: number;
  error: string | null;
  started_at: Date | null;
  created_at: Date;
  payload_json?: unknown;
}

export interface OrgOpsWatchPrisma {
  job: {
    findMany: (args: {
      where: {
        kind: { startsWith: string };
        OR: Array<Record<string, unknown>>;
      };
      select: {
        id: true;
        book_id: true;
        kind: true;
        status: true;
        retries: true;
        error: true;
        started_at: true;
        created_at: true;
        payload_json: true;
      };
      orderBy: { created_at: 'desc' };
      take: number;
    }) => Promise<WatchJobRow[]>;
    update?: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  orgTask: {
    findMany: (args: {
      where: { division: string; status: { in: string[] }; kind: { in: string[] } };
      select: { book_id: true };
    }) => Promise<Array<{ book_id: string | null }>>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  modelAssignment: {
    findMany: (args: {
      where: { role: { in: string[] }; status: string };
      select: { id: true; role: true; genre: true; provider: true; model: true };
    }) => Promise<Array<{ id: string; role: string; genre: string | null; provider: string; model: string }>>;
    update: (args: {
      where: { id: string };
      data: { provider: string; model: string };
    }) => Promise<unknown>;
  };
  auditLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
}

/**
 * デプロイ残骸ジョブの自己修復関数（テストで差し替え可）。
 * true = 修復した（queued に戻し再投入した）/ false = 対象外（graphile に生きたジョブがある・本が終端状態 等）。
 */
export type RepairOrphanFn = (row: {
  id: string;
  kind: string;
  book_id: string | null;
  payload_json?: unknown;
}) => Promise<boolean>;

export interface OrgOpsWatchDeps {
  prisma?: OrgOpsWatchPrisma;
  logger?: Logger;
  now?: () => Date;
  /** デプロイ残骸(stale running × graphile不在)の修復。既定は raw SQL 実装。 */
  repairOrphan?: RepairOrphanFn;
}

export interface OrgOpsWatchResult {
  scanned: number;
  recover_created: number;
  triage_created: number;
  /** モデル/プロバイダ障害を検知して割当を自動切替した件数（自己修復）。 */
  model_heals: number;
  /** デプロイ残骸ジョブを queued に戻して再投入した件数（自己修復）。 */
  orphan_repairs: number;
}

const TERMINAL_BOOK_STATUSES = ['done', 'failed', 'cancelled', 'archived', 'culled', 'retracted', 'external'];

/**
 * 2026-09-02 実障害の恒久対策: デプロイ/強制終了で worker ごと殺された実行中ジョブは
 * `public.jobs` が status='running' のまま残り、graphile 側の再試行も各タスクの
 * CAS(queued/failed→running) に弾かれて空振りで消滅する。結果、本はジョブ無しで無言凍結する
 * （実測: 12:23 のデプロイで editor 6 本が凍結）。
 * stale running かつ「同 kind×book の graphile ジョブが存在しない」行を queued に戻し、
 * 保存済み payload（feedback 等を含む）で同一 job_id のまま再投入する。
 */
async function defaultRepairOrphan(row: {
  id: string;
  kind: string;
  book_id: string | null;
  payload_json?: unknown;
}): Promise<boolean> {
  if (!row.book_id) return false;
  if (!process.env.DATABASE_URL) return false; // テスト環境ガード
  const raw = defaultPrisma as unknown as {
    $queryRawUnsafe: (q: string, ...v: unknown[]) => Promise<Array<Record<string, unknown>>>;
    $executeRawUnsafe: (q: string, ...v: unknown[]) => Promise<number>;
  };
  // graphile に同 kind×book の生きたジョブがあれば触らない（実行中/待機中を潰さない）
  const live = await raw.$queryRawUnsafe(
    `SELECT 1 FROM graphile_worker._private_jobs j
       JOIN graphile_worker._private_tasks t ON t.id = j.task_id
      WHERE t.identifier = $1 AND j.payload::jsonb->>'book_id' = $2 LIMIT 1`,
    row.kind,
    row.book_id,
  );
  if (live.length > 0) return false;
  const book = await raw.$queryRawUnsafe(`SELECT status FROM books WHERE id = $1`, row.book_id);
  if (book.length === 0 || TERMINAL_BOOK_STATUSES.includes(String(book[0]!.status))) return false;

  const base: Record<string, unknown> =
    row.payload_json && typeof row.payload_json === 'object' && !Array.isArray(row.payload_json)
      ? { ...(row.payload_json as Record<string, unknown>) }
      : {};
  delete base.job_id;
  const payload = JSON.stringify({ ...base, book_id: row.book_id, job_id: row.id });

  const reset = await raw.$executeRawUnsafe(
    `UPDATE jobs SET status = 'queued', error = NULL WHERE id = $1 AND status = 'running'`,
    row.id,
  );
  if (reset === 0) return false; // 誰かが先に触った
  const g = await raw.$queryRawUnsafe(
    `SELECT id FROM graphile_worker.add_job($1, $2::json, max_attempts := 2)`,
    row.kind,
    payload,
  );
  await raw.$executeRawUnsafe(`UPDATE jobs SET graphile_job_id = $2 WHERE id = $1`, row.id, String(g[0]!.id));
  return true;
}

export interface ModelHealDeps {
  prisma: Pick<OrgOpsWatchPrisma, 'modelAssignment' | 'auditLog' | 'orgTask'>;
  log: Logger;
  now: () => Date;
}

/**
 * モデル/プロバイダ提供障害を診断し、影響ロールの active 割当を安全な Claude へ自動切替する。
 * - 対象: `MODEL_OUTAGE_RE` に一致するエラーで失敗した pipeline ジョブの役割。
 * - 切替条件: その役割の active 割当が **anthropic 以外**（＝google/openai の障害モデル）である場合のみ。
 *   既に anthropic の場合は同プロバイダ内フォールバック不可のため切替せず、通常の triage(人手)に委ねる。
 * - 記録: audit_log + sysops org_task(done) を残し「サイレントに直す」のではなく可視化する。
 * 返り値: 切替した役割数。
 */
export async function healModelOutages(
  failedJobs: Array<{ kind: string; error: string | null }>,
  deps: ModelHealDeps,
): Promise<number> {
  const { prisma, log, now } = deps;

  // 障害エラーで失敗した役割を収集（役割→代表エラー）。
  const roleErr = new Map<string, string>();
  for (const j of failedJobs) {
    if (!isModelOutageError(j.error)) continue;
    const role = roleForKind(j.kind);
    if (!role) continue;
    if (!roleErr.has(role)) roleErr.set(role, (j.error ?? '').slice(0, 300));
  }
  if (roleErr.size === 0) return 0;

  const roles = [...roleErr.keys()];
  const actives = await prisma.modelAssignment.findMany({
    where: { role: { in: roles }, status: 'active' },
    select: { id: true, role: true, genre: true, provider: true, model: true },
  });

  let heals = 0;
  for (const a of actives) {
    // 既に anthropic なら自己修復対象外（別プロバイダ障害でないと判断）。
    if (a.provider === 'anthropic') continue;
    const before = { provider: a.provider, model: a.model };
    try {
      await prisma.modelAssignment.update({
        where: { id: a.id },
        data: { provider: MODEL_HEAL_FALLBACK.provider, model: MODEL_HEAL_FALLBACK.model },
      });
      await prisma.auditLog.create({
        data: {
          actor_id: null,
          action: 'model_assignment.auto_heal',
          target_kind: 'model_assignment',
          target_id: a.id,
          before_json: { role: a.role, genre: a.genre, ...before },
          after_json: {
            role: a.role,
            genre: a.genre,
            ...MODEL_HEAL_FALLBACK,
            reason: roleErr.get(a.role) ?? 'model outage',
          },
        },
      });
      // 可視化: 何が起きて何を直したかを /org 盤面に残す（done=対応済み記録）。
      await prisma.orgTask.create({
        data: {
          division: 'sysops',
          book_id: null,
          owner_role: 'ops_mgr',
          assignee_role: 'ops_worker',
          kind: 'triage_error',
          title: `自動復旧: ${a.role} のモデルを ${before.provider}/${before.model} → ${MODEL_HEAL_FALLBACK.provider}/${MODEL_HEAL_FALLBACK.model} へ切替`,
          instruction: [
            `${a.role} の active モデル(${before.provider}/${before.model})が提供障害で全ジョブ失敗していたため、`,
            `安全な ${MODEL_HEAL_FALLBACK.provider}/${MODEL_HEAL_FALLBACK.model} へ自動切替しました（書籍生成の停止を自己修復）。`,
            `検知エラー: ${roleErr.get(a.role) ?? ''}`,
            '恒久対応が必要なら人手で最適モデルへ再設定してください。',
          ].join('\n'),
          status: 'done',
          priority: 'must',
          done_at: now(),
          result_json: { action: 'model_auto_heal', role: a.role, before, after: MODEL_HEAL_FALLBACK },
        },
      });
      heals += 1;
      log.warn(
        { task: ORG_OPS_WATCH_TASK_NAME, role: a.role, before, after: MODEL_HEAL_FALLBACK },
        'model outage detected — auto-healed model assignment to Claude fallback',
      );
    } catch (healErr) {
      log.warn(
        { task: ORG_OPS_WATCH_TASK_NAME, role: a.role, err: healErr },
        'failed to auto-heal model assignment',
      );
    }
  }
  return heals;
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function runOrgOpsWatch(payload: unknown, deps: OrgOpsWatchDeps = {}): Promise<OrgOpsWatchResult> {
  const parsed = OrgOpsWatchPayloadSchema.safeParse(payload ?? {});
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const limit = (parsed.success && parsed.data.limit) || MAX_OPS_TASKS_PER_RUN;

  const log = deps.logger ?? createLogger(`worker.${ORG_OPS_WATCH_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as OrgOpsWatchPrisma);
  const now = deps.now ?? (() => new Date());

  const result: OrgOpsWatchResult = { scanned: 0, recover_created: 0, triage_created: 0, model_heals: 0, orphan_repairs: 0 };

  try {
    const nowTs = now();
    const failedSince = new Date(nowTs.getTime() - FAILED_LOOKBACK_HOURS * 3600_000);
    const stuckBefore = new Date(nowTs.getTime() - STUCK_MINUTES * 60_000);

    const jobs = await prisma.job.findMany({
      where: {
        kind: { startsWith: 'pipeline.book.' },
        OR: [
          { status: 'failed', created_at: { gte: failedSince } },
          { status: 'running', started_at: { lt: stuckBefore } },
        ],
      },
      select: {
        id: true,
        book_id: true,
        kind: true,
        status: true,
        retries: true,
        error: true,
        started_at: true,
        created_at: true,
        payload_json: true,
      },
      orderBy: { created_at: 'desc' },
      take: 200,
    });
    result.scanned = jobs.length;

    // 0. 自己修復: モデル/プロバイダ提供障害を診断し、影響ロールの割当を安全な Claude へ自動切替。
    //    (単純再投入では直らない「設定起因の停止」を根本から解消する。docs/06)
    try {
      const failedForHeal = jobs
        .filter((j) => j.status === 'failed')
        .map((j) => ({ kind: j.kind, error: j.error }));
      result.model_heals = await healModelOutages(failedForHeal, { prisma, log, now });
    } catch (healErr) {
      log.warn({ task: ORG_OPS_WATCH_TASK_NAME, err: healErr }, 'healModelOutages failed (non-fatal)');
    }

    // 0.5 自己修復: デプロイ残骸 (stale running かつ graphile 不在) を queued に戻して再投入。
    //     成功した book は下の triage 起票をスキップ（自動で直したものに人手タスクを積まない）。
    const repairFn = deps.repairOrphan ?? defaultRepairOrphan;
    const repairedBooks = new Set<string>();
    for (const j of jobs) {
      if (j.status !== 'running') continue;
      try {
        if (await repairFn(j)) {
          result.orphan_repairs += 1;
          if (j.book_id) repairedBooks.add(j.book_id);
          log.info(
            { task: ORG_OPS_WATCH_TASK_NAME, jobId: j.id, kind: j.kind, bookId: j.book_id },
            'orphaned running job repaired (reset to queued + re-enqueued)',
          );
        }
      } catch (repairErr) {
        log.warn({ task: ORG_OPS_WATCH_TASK_NAME, jobId: j.id, err: repairErr }, 'orphan repair failed (non-fatal)');
      }
    }

    // 既に開いている sysops(recover/triage) タスクの book を集めて重複起票を防ぐ。
    const openOps = await prisma.orgTask.findMany({
      where: { division: 'sysops', status: { in: OPEN_STATUSES }, kind: { in: ['recover_job', 'triage_error'] } },
      select: { book_id: true },
    });
    const covered = new Set(openOps.map((t) => t.book_id).filter((x): x is string => !!x));

    // book 単位に集約（最進捗の失敗/スタックを代表に）。
    const byBook = new Map<string, WatchJobRow>();
    for (const j of jobs) {
      if (!j.book_id) continue;
      const prev = byBook.get(j.book_id);
      if (!prev || j.created_at > prev.created_at) byBook.set(j.book_id, j);
    }

    let created = 0;
    for (const [bookId, rep] of byBook) {
      if (created >= limit) break;
      if (covered.has(bookId)) continue;
      if (repairedBooks.has(bookId)) continue; // 自己修復済み — 人手タスク不要

      const stuck = rep.status === 'running';
      const retriable = !stuck && rep.retries < MAX_RECOVER_RETRIES;
      const kind = retriable ? 'recover_job' : 'triage_error';
      const status = retriable ? 'approved' : 'needs_human';
      const assignee = retriable ? 'ops_worker' : 'human';
      const errSnippet = (rep.error ?? (stuck ? `${STUCK_MINUTES}分以上 running のままスタック` : '(詳細不明)')).slice(0, 500);
      const title = retriable
        ? `復旧: ${rep.kind} 失敗ジョブを再投入`
        : `要調査: ${rep.kind} が${stuck ? 'スタック' : `リトライ上限(${MAX_RECOVER_RETRIES})到達`}`;
      const instruction = [
        `対象書籍のパイプライン ${rep.kind} が ${stuck ? 'スタック(running)' : `失敗(retries=${rep.retries})`}。`,
        retriable
          ? '最進捗の失敗ステップを再投入して復旧する。'
          : '自動復旧の範囲を超過。原因（コスト停止/データ不整合/外部API）を調査し人手で判断する。',
        '',
        `失敗ジョブ: ${rep.id} (${rep.kind})`,
        `エラー: ${errSnippet}`,
      ].join('\n');

      await prisma.orgTask.create({
        data: {
          division: 'sysops',
          book_id: bookId,
          owner_role: 'ops_mgr',
          assignee_role: assignee,
          kind,
          title,
          instruction,
          status,
          priority: 'should',
        },
      });
      created += 1;
      covered.add(bookId);
      if (retriable) result.recover_created += 1;
      else result.triage_created += 1;
    }

    if (jobId && prisma.job.update) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', finished_at: now(), error: null, result_json: result },
      });
    }
    log.info({ task: ORG_OPS_WATCH_TASK_NAME, ...result }, 'org.ops.watch done');
    return result;
  } catch (err) {
    if (jobId && prisma.job.update) {
      try {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'failed', finished_at: now(), error: serializeError(err) },
        });
      } catch {
        // best-effort
      }
    }
    throw err;
  }
}

export const orgOpsWatchTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runOrgOpsWatch(payload);
};
