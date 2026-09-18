import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { planNoteAccountDesign as defaultPlanNoteAccountDesign } from '@a2p/agents/anp/strategist';
import {
  NoteAccountDesignBriefSchema,
  type NoteAccountDesign,
  type NoteAccountDesignBrief,
} from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `note.account.design` タスク (docs/11-anp-design.md §3.1/§7, F-ANP-01/03).
 *
 * `apps/anp` の「設計を生成」ボタンから enqueue される単発 worker タスク。
 * `NoteAccountDesign.brief_json` を読み、note Strategist (`planNoteAccountDesign`) で
 * 設計案を生成、`design_json` に保存する。A2P `pipeline.theme.generate` / note.theme.generate
 * と同型の冪等性/エラー方針。
 *
 * フロー:
 *   1. payload zod parse ({ design_id, job_id })
 *   2. 内部 `Job` を findUnique。既に done ならスキップ。
 *   3. CAS で queued/failed → running。
 *   4. `NoteAccountDesign` fetch (不在 → NotFoundError)。
 *   5. `planNoteAccountDesign(brief)` 呼出 (token_usage は role='anp.strategist' で INSERT 済み)。
 *   6. `NoteAccountDesign.update` — design_json 確定、status='proposed'。
 *   7. Job を done に遷移 (result_json: { design_id }).
 *
 * 失敗時: `NoteAccountDesign.status='failed'` + `error` を保存し、Job も failed にして rethrow。
 */

export const NOTE_ACCOUNT_DESIGN_TASK_NAME = 'note.account.design';

export const NoteAccountDesignPayloadSchema = z.object({
  design_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type NoteAccountDesignPayload = z.infer<typeof NoteAccountDesignPayloadSchema>;

export interface NoteAccountDesignPrisma {
  job: {
    findUnique: (args: {
      where: { id: string };
      select: { status: true };
    }) => Promise<{ status: string } | null>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; started_at?: Date; finished_at?: Date | null; error?: string | null };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; finished_at?: Date; error?: string | null; result_json?: unknown };
    }) => Promise<unknown>;
  };
  noteAccountDesign: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; brief_json: true };
    }) => Promise<{ id: string; brief_json: unknown } | null>;
    update: (args: {
      where: { id: string };
      data: { design_json?: unknown; status?: string; error?: string | null };
    }) => Promise<unknown>;
  };
}

export interface NoteAccountDesignDeps {
  prisma?: NoteAccountDesignPrisma;
  logger?: Logger;
  planDesign?: (brief: NoteAccountDesignBrief) => Promise<NoteAccountDesign>;
  now?: () => Date;
}

export async function runNoteAccountDesign(
  payload: unknown,
  deps: NoteAccountDesignDeps = {},
): Promise<void> {
  const parsed = NoteAccountDesignPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.account.design payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { design_id: designId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${NOTE_ACCOUNT_DESIGN_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteAccountDesignPrisma);
  const planDesign = deps.planDesign ?? ((brief: NoteAccountDesignBrief) => defaultPlanNoteAccountDesign(brief, { jobId }));
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, designId } });
  }
  if (existing.status === 'done') {
    log.info({ task: NOTE_ACCOUNT_DESIGN_TASK_NAME, jobId }, 'job already done — skipping (idempotent)');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now(), finished_at: null, error: null },
  });
  if (cas.count === 0) {
    log.info({ task: NOTE_ACCOUNT_DESIGN_TASK_NAME, jobId }, 'job not in queued/failed state — skipping');
    return;
  }

  try {
    const design = await prisma.noteAccountDesign.findUnique({
      where: { id: designId },
      select: { id: true, brief_json: true },
    });
    if (!design) {
      throw new NotFoundError(`NoteAccountDesign not found: ${designId}`, {
        details: { designId, jobId },
      });
    }

    const brief = NoteAccountDesignBriefSchema.parse(design.brief_json);
    const result = await planDesign(brief);

    await prisma.noteAccountDesign.update({
      where: { id: designId },
      data: { design_json: result as unknown as Record<string, unknown>, status: 'proposed', error: null },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'done', finished_at: now(), error: null, result_json: { design_id: designId } },
    });

    log.info(
      { task: NOTE_ACCOUNT_DESIGN_TASK_NAME, jobId, designId },
      'note.account.design done — NoteAccountDesign proposed',
    );
  } catch (err) {
    const message = serializeError(err);
    try {
      await prisma.noteAccountDesign.update({
        where: { id: designId },
        data: { status: 'failed', error: message },
      });
    } catch (designUpdateErr) {
      log.warn(
        { task: NOTE_ACCOUNT_DESIGN_TASK_NAME, jobId, designId, err: designUpdateErr },
        'failed to mark NoteAccountDesign as failed',
      );
    }
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: message },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: NOTE_ACCOUNT_DESIGN_TASK_NAME, jobId, err: jobUpdateErr },
        'failed to mark internal Job as failed',
      );
    }
    throw err;
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export const noteAccountDesignTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountDesign(payload);
};
