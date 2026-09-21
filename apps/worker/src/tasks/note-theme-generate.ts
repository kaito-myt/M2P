import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { generateNoteThemes as defaultGenerateNoteThemes } from '@a2p/agents/anp/theme';
import { parseNoteMonetizationPolicy, type NoteThemeInput, type NoteThemeOutput } from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `note.theme.generate` タスク (docs/11-anp-design.md §7, F-ANP-10).
 *
 * `apps/anp` の「テーマ生成」ボタンから enqueue される単発 worker タスク。
 * note Marketer (`generateNoteThemes`) でテーマ候補を生成し、`NoteTheme` を一括 INSERT する。
 * A2P `pipeline.theme.generate` (pipeline-theme-generate.ts) と同型の冪等性/エラー方針。
 *
 * フロー:
 *   1. payload zod parse ({ note_account_id, job_id, count? })
 *   2. 内部 `Job` を findUnique。既に done ならスキップ。
 *   3. CAS で queued/failed → running。
 *   4. `NoteAccount` fetch (不在 → NotFoundError)。
 *   5. 直近 90 日以内に status='accepted' となった `NoteTheme.title` を除外リストとして取得。
 *   6. `generateNoteThemes(...)` 呼出 (token_usage は role='anp.theme' で INSERT 済み)。
 *   7. `NoteTheme.createMany` — status='pending' で全候補を INSERT。
 *   8. Job を done に遷移 (result_json: { candidate_count }).
 *
 * エラー方針: A2P pipeline-theme-generate.ts と同型。
 */

export const NOTE_THEME_GENERATE_TASK_NAME = 'note.theme.generate';

export const NoteThemeGeneratePayloadSchema = z.object({
  note_account_id: z.string().min(1),
  job_id: z.string().min(1),
  count: z.number().int().min(1).max(20).default(5),
});
export type NoteThemeGeneratePayload = z.infer<typeof NoteThemeGeneratePayloadSchema>;

const EXCLUDE_LOOKBACK_DAYS = 90;
const EXCLUDE_TITLES_HARD_LIMIT = 200;

export interface NoteThemeGeneratePrisma {
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
  noteAccount: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; niche: true; target_reader: true; tone: true; editorial_policy?: true; monetization_policy_json?: true };
    }) => Promise<{
      id: string;
      niche: string;
      target_reader: string | null;
      tone: string | null;
      editorial_policy?: string | null;
      monetization_policy_json?: unknown;
    } | null>;
  };
  noteTheme: {
    findMany: (args: {
      where: { note_account_id: string; status: string; created_at: { gte: Date } };
      select: { title: true };
      take?: number;
    }) => Promise<Array<{ title: string }>>;
    createMany: (args: {
      data: Array<{
        note_account_id: string;
        title: string;
        hook: string;
        target_reader: string | null;
        recommend_paid: boolean;
        suggested_price: number | null;
        competitors_json: unknown;
        genre: string;
        status: string;
      }>;
    }) => Promise<{ count: number }>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface NoteThemeGenerateDeps {
  prisma?: NoteThemeGeneratePrisma;
  logger?: Logger;
  generateThemes?: (input: NoteThemeInput) => Promise<NoteThemeOutput>;
  now?: () => Date;
}

export async function runNoteThemeGenerate(
  payload: unknown,
  deps: NoteThemeGenerateDeps = {},
): Promise<void> {
  const parsed = NoteThemeGeneratePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.theme.generate payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_account_id: noteAccountId, job_id: jobId, count } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${NOTE_THEME_GENERATE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteThemeGeneratePrisma);
  const generateThemes = deps.generateThemes ?? defaultGenerateNoteThemes;
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, noteAccountId } });
  }
  if (existing.status === 'done') {
    log.info({ task: NOTE_THEME_GENERATE_TASK_NAME, jobId }, 'job already done — skipping (idempotent)');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now(), finished_at: null, error: null },
  });
  if (cas.count === 0) {
    log.info({ task: NOTE_THEME_GENERATE_TASK_NAME, jobId }, 'job not in queued/failed state — skipping');
    return;
  }

  try {
    const account = await prisma.noteAccount.findUnique({
      where: { id: noteAccountId },
      select: { id: true, niche: true, target_reader: true, tone: true, editorial_policy: true },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${noteAccountId}`, {
        details: { noteAccountId, jobId },
      });
    }

    const since = new Date(now().getTime() - EXCLUDE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const recentAccepted = await prisma.noteTheme.findMany({
      where: { note_account_id: noteAccountId, status: 'accepted', created_at: { gte: since } },
      select: { title: true },
      take: EXCLUDE_TITLES_HARD_LIMIT,
    });

    const input: NoteThemeInput = {
      note_account_id: noteAccountId,
      job_id: jobId,
      account: {
        niche: account.niche,
        target_reader: account.target_reader,
        tone: account.tone,
        editorial_policy: account.editorial_policy ?? null,
        monetization: parseNoteMonetizationPolicy(account.monetization_policy_json),
      },
      count,
      exclude_titles_recent: recentAccepted.map((r) => r.title),
    };

    const result = await generateThemes(input);

    const inserted = await prisma.noteTheme.createMany({
      data: result.candidates.map((c) => ({
        note_account_id: noteAccountId,
        title: c.title,
        hook: c.hook,
        target_reader: c.target_reader ?? null,
        recommend_paid: c.recommend_paid,
        suggested_price: c.suggested_price ?? null,
        competitors_json: c.competitors ?? [],
        genre: c.genre,
        status: 'pending',
      })),
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { note_account_id: noteAccountId, candidate_count: inserted.count },
      },
    });

    log.info(
      { task: NOTE_THEME_GENERATE_TASK_NAME, jobId, noteAccountId, candidateCount: inserted.count },
      'note.theme.generate done — NoteThemes inserted',
    );
  } catch (err) {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: serializeError(err) },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: NOTE_THEME_GENERATE_TASK_NAME, jobId, err: jobUpdateErr },
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

export const noteThemeGenerateTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteThemeGenerate(payload);
};
