'use server';

/**
 * docs/06 — 組織エージェント (経営) の Server Actions。
 *
 * - runOrgPlan: CEO ティック (org.plan) を enqueue し、全社状況から方針＋ToDoを自動起票させる。
 * - approve/complete/cancel OrgTask: 全社ToDoボードの人手操作。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isA2PError, fail, ok, type ActionResult } from '@a2p/contracts';
import { prisma } from '@a2p/db';

import { getSessionOrThrow } from '@/lib/auth-helpers';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';
import { launchOrgModelBakeoffCore, type OrgBakeoffDeps } from '@/lib/org-bakeoff-core';
import { canRetryOrgTask } from '@/lib/org-view';

const ORG_PLAN_TASK = 'org.plan';
const ORG_EXECUTE_TASK = 'org.execute.dispatch';
const ORG_OPS_WATCH_TASK = 'org.ops.watch';
const ORG_FINANCE_TICK_TASK = 'org.finance.tick';
const ORG_KDP_SCREEN_TASK = 'org.kdp.screen';
const ORG_CEO_CHAT_TASK = 'org.ceo.chat';

function revalidateOrg(): void {
  revalidatePath('/org');
  revalidatePath('/org/tasks');
}

const CeoMessageSchema = z.object({ message: z.string().trim().min(1).max(4000) });

/**
 * 運営者 → CEO のメッセージを送信し、CEO 応答生成タスク(org.ceo.chat)を enqueue する。
 * 応答は非同期（worker が生成）。UI は /api/org/ceo/messages をポーリングして表示する。
 */
export async function sendCeoMessage(input: unknown): Promise<ActionResult<{ message_id: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }

  const parsed = CeoMessageSchema.safeParse(input);
  if (!parsed.success) return fail('validation', messages.org.dashboard.runError);

  try {
    const msg = await prisma.orgCeoMessage.create({
      data: { role: 'operator', content: parsed.data.message, status: 'pending' },
      select: { id: true },
    });
    const job = await prisma.job.create({
      data: { kind: ORG_CEO_CHAT_TASK, status: 'queued', payload_json: { message_id: msg.id } },
    });
    await enqueueJob(ORG_CEO_CHAT_TASK, { message_id: msg.id, job_id: job.id });
    revalidateOrg();
    return ok({ message_id: msg.id });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }
}

export async function runOrgPlan(): Promise<ActionResult<{ job_id: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }

  try {
    // 既に走っている org.plan があれば二重起動しない。
    const existing = await prisma.job.findFirst({
      where: { kind: ORG_PLAN_TASK, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    let jobId = existing?.id ?? null;
    if (!jobId) {
      const job = await prisma.job.create({
        data: { kind: ORG_PLAN_TASK, status: 'queued', payload_json: { trigger: 'manual' } },
      });
      jobId = job.id;
      await enqueueJob(ORG_PLAN_TASK, { job_id: jobId, trigger: 'manual' });
    }
    revalidateOrg();
    return ok({ job_id: jobId });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }
}

export async function runOrgDispatch(): Promise<ActionResult<{ job_id: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }

  try {
    // 既に走っている dispatch があれば二重起動しない。
    const existing = await prisma.job.findFirst({
      where: { kind: ORG_EXECUTE_TASK, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    let jobId = existing?.id ?? null;
    if (!jobId) {
      const job = await prisma.job.create({
        data: { kind: ORG_EXECUTE_TASK, status: 'queued', payload_json: { trigger: 'manual' } },
      });
      jobId = job.id;
      await enqueueJob(ORG_EXECUTE_TASK, { job_id: jobId, trigger: 'manual' });
    }
    revalidateOrg();
    return ok({ job_id: jobId });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }
}

/** dedup + enqueue の共通処理（org.plan/dispatch/ops.watch/finance.tick 共用）。 */
async function runOrgTick(taskName: string): Promise<ActionResult<{ job_id: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }

  try {
    const existing = await prisma.job.findFirst({
      where: { kind: taskName, status: { in: ['queued', 'running'] } },
      select: { id: true },
    });
    let jobId = existing?.id ?? null;
    if (!jobId) {
      const job = await prisma.job.create({
        data: { kind: taskName, status: 'queued', payload_json: { trigger: 'manual' } },
      });
      jobId = job.id;
      await enqueueJob(taskName, { job_id: jobId, trigger: 'manual' });
    }
    revalidateOrg();
    return ok({ job_id: jobId });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.dashboard.runError);
  }
}

/** docs/06 P3: 運用の自己復旧監視 (org.ops.watch) を手動起動。 */
export async function runOrgOpsWatch(): Promise<ActionResult<{ job_id: string }>> {
  return runOrgTick(ORG_OPS_WATCH_TASK);
}

/** docs/06 P3: 経営の予算ガード (org.finance.tick) を手動起動。 */
export async function runOrgFinanceTick(): Promise<ActionResult<{ job_id: string }>> {
  return runOrgTick(ORG_FINANCE_TICK_TASK);
}

/** docs/06 P4 増分3: KDP 公開の事前スクリーニング (org.kdp.screen) を手動起動。 */
export async function runOrgKdpScreen(): Promise<ActionResult<{ job_id: string }>> {
  return runOrgTick(ORG_KDP_SCREEN_TASK);
}

/** docs/06 P4 増分5: org ロールのモデル最適化 bakeoff を起動。 */
export async function launchOrgModelBakeoff(input: unknown): Promise<ActionResult<{ run_id: string; candidates: number }>> {
  let session: { user: { id: string } };
  try {
    session = await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.bakeoff.error);
  }
  const deps: OrgBakeoffDeps = {
    assignmentRepo: prisma.modelAssignment as unknown as OrgBakeoffDeps['assignmentRepo'],
    catalogRepo: prisma.modelCatalog as unknown as OrgBakeoffDeps['catalogRepo'],
    bakeoffRunRepo: prisma.bakeoffRun as unknown as OrgBakeoffDeps['bakeoffRunRepo'],
    session,
    enqueue: async (task, payload) => {
      await enqueueJob(task, payload);
    },
  };
  const res = await launchOrgModelBakeoffCore(input, deps);
  if (res.ok) revalidateOrg();
  return res;
}

const TaskIdSchema = z.object({ task_id: z.string().min(1) });

async function transitionTask(
  input: unknown,
  next: 'approved' | 'done' | 'canceled',
): Promise<ActionResult<{ task_id: string; status: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }

  const parsed = TaskIdSchema.safeParse(input);
  if (!parsed.success) return fail('validation', messages.org.board.actionError);
  const { task_id } = parsed.data;

  try {
    const task = await prisma.orgTask.findUnique({ where: { id: task_id }, select: { id: true } });
    if (!task) return fail('not_found', messages.org.board.actionError);

    await prisma.orgTask.update({
      where: { id: task_id },
      data: {
        status: next,
        ...(next === 'done' ? { done_at: new Date() } : {}),
      },
    });
    revalidateOrg();
    return ok({ task_id, status: next });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }
}

const ToggleGrowthTargetSchema = z.object({
  task_id: z.string().min(1),
  key: z.string().min(1),
  done: z.boolean(),
});

/**
 * [F-075 UX] 手動グロースToDoの1ターゲットの「フォロー/いいね済み」チェックを永続化する。
 * org_task.result_json.completed（key配列）を更新。ワンタップUIの進捗保存用。
 */
export async function toggleGrowthTarget(input: unknown): Promise<ActionResult<{ completed: string[] }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }
  const parsed = ToggleGrowthTargetSchema.safeParse(input);
  if (!parsed.success) return fail('validation', messages.org.board.actionError);
  const { task_id, key, done } = parsed.data;

  try {
    const task = await prisma.orgTask.findUnique({ where: { id: task_id }, select: { id: true, kind: true, result_json: true } });
    if (!task || task.kind !== 'growth_manual') return fail('not_found', messages.org.board.actionError);
    const rj = (task.result_json && typeof task.result_json === 'object' ? task.result_json : {}) as Record<string, unknown>;
    const set = new Set(Array.isArray(rj.completed) ? (rj.completed as string[]) : []);
    if (done) set.add(key);
    else set.delete(key);
    const completed = [...set];
    await prisma.orgTask.update({ where: { id: task_id }, data: { result_json: { ...rj, completed } } });
    revalidateOrg();
    return ok({ completed });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }
}

export async function approveOrgTask(input: unknown) {
  return transitionTask(input, 'approved');
}

export async function completeOrgTask(input: unknown) {
  return transitionTask(input, 'done');
}

export async function cancelOrgTask(input: unknown) {
  return transitionTask(input, 'canceled');
}

/**
 * blocked/needs_human で止まった全社ToDoを approved へ前進させる（自己改善ループの停滞解消）。
 * blocked からの再実行は error をクリアし、次の org.execute.dispatch サイクルで再着手させる。
 */
export async function retryOrgTask(input: unknown): Promise<ActionResult<{ task_id: string; status: string }>> {
  try {
    await getSessionOrThrow();
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }

  const parsed = TaskIdSchema.safeParse(input);
  if (!parsed.success) return fail('validation', messages.org.board.actionError);
  const { task_id } = parsed.data;

  try {
    const task = await prisma.orgTask.findUnique({ where: { id: task_id }, select: { id: true, status: true } });
    if (!task) return fail('not_found', messages.org.board.actionError);
    if (!canRetryOrgTask(task.status)) {
      return fail('validation', messages.org.board.actionError);
    }

    await prisma.orgTask.update({
      where: { id: task_id },
      data: { status: 'approved', error: null },
    });
    revalidateOrg();
    return ok({ task_id, status: 'approved' });
  } catch (err) {
    if (isA2PError(err)) return err.toActionResult();
    return fail('unknown', messages.org.board.actionError);
  }
}
