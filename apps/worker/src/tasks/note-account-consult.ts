import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { consultNoteAccount as defaultConsultNoteAccount } from '@a2p/agents/anp/consultant';
import {
  NoteAccountConsultBriefDraftSchema,
  type NoteAccountConsultBriefDraft,
  type NoteAccountConsultOutput,
  type NoteAccountConsultResearchItem,
  type NoteAccountConsultTurn,
} from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

/**
 * `note.account.consult` タスク (docs/11-anp-design.md §3.1/§7, F-ANP-04).
 *
 * `apps/anp` の相談チャット (`/accounts/design/consult/[id]`) から、運営者メッセージ 1 件ごとに
 * enqueue される。A2P の `org.ceo.chat` と同型: operator メッセージを processing → AI 返答
 * (`consultNoteAccount`, Tavily リサーチ込み) を advisor メッセージとして追加 → 相談の
 * `brief_draft_json` / `ready_to_design` / `title` を更新 → operator メッセージを done。
 *
 * フロー:
 *   1. payload zod parse ({ consultation_id, message_id, job_id })
 *   2. 内部 `Job` を findUnique。既に done ならスキップ。
 *   3. CAS で queued/failed → running。
 *   4. operator メッセージを pending/failed → processing (CAS。他状態ならスキップ = 二重実行防止)。
 *   5. 会話履歴 (当該メッセージより前) + 草案を読み `consultNoteAccount` 呼出
 *      (token_usage は role='anp.consultant' で INSERT 済み)。
 *   6. advisor メッセージ INSERT (research_json = { research, suggested_questions })、
 *      相談 update (brief_draft_json/ready_to_design/title)、operator メッセージ done。
 *   7. Job を done。
 *
 * 失敗時: operator メッセージを failed + error、Job も failed にして rethrow (graphile の再試行に任せる)。
 */

export const NOTE_ACCOUNT_CONSULT_TASK_NAME = 'note.account.consult';

export const NoteAccountConsultPayloadSchema = z.object({
  consultation_id: z.string().min(1),
  message_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type NoteAccountConsultPayload = z.infer<typeof NoteAccountConsultPayloadSchema>;

/** 一覧用の題: 最初の運営者メッセージの先頭 40 字。 */
export const CONSULT_TITLE_MAX = 40;

export interface NoteAccountConsultPrisma {
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
  noteAccountConsultation: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; title: true; brief_draft_json: true };
    }) => Promise<{ id: string; title: string; brief_draft_json: unknown } | null>;
    update: (args: {
      where: { id: string };
      data: { title?: string; brief_draft_json?: unknown; ready_to_design?: boolean };
    }) => Promise<unknown>;
  };
  noteAccountConsultationMessage: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; consultation_id: true; role: true; content: true; status: true; created_at: true };
    }) => Promise<{
      id: string;
      consultation_id: string;
      role: string;
      content: string;
      status: string;
      created_at: Date;
    } | null>;
    findMany: (args: {
      where: { consultation_id: string; status: string; created_at: { lt: Date } };
      orderBy: { created_at: 'asc' };
      select: { role: true; content: true };
    }) => Promise<Array<{ role: string; content: string }>>;
    updateMany: (args: {
      where: { id: string; status: { in: string[] } };
      data: { status: string; error?: string | null };
    }) => Promise<{ count: number }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; error?: string | null };
    }) => Promise<unknown>;
    create: (args: {
      data: {
        consultation_id: string;
        role: string;
        content: string;
        status: string;
        research_json?: unknown;
      };
    }) => Promise<unknown>;
  };
}

export interface NoteAccountConsultDeps {
  prisma?: NoteAccountConsultPrisma;
  logger?: Logger;
  consult?: (input: {
    history: NoteAccountConsultTurn[];
    message: string;
    briefDraft: NoteAccountConsultBriefDraft;
  }) => Promise<{ output: NoteAccountConsultOutput; research: NoteAccountConsultResearchItem[] }>;
  now?: () => Date;
}

export function deriveConsultTitle(firstMessage: string): string {
  const oneLine = firstMessage.replace(/\s+/g, ' ').trim();
  return oneLine.length > CONSULT_TITLE_MAX ? `${oneLine.slice(0, CONSULT_TITLE_MAX)}…` : oneLine;
}

export async function runNoteAccountConsult(
  payload: unknown,
  deps: NoteAccountConsultDeps = {},
): Promise<void> {
  const parsed = NoteAccountConsultPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.account.consult payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { consultation_id: consultationId, message_id: messageId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${NOTE_ACCOUNT_CONSULT_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteAccountConsultPrisma);
  const consult =
    deps.consult ??
    ((input: { history: NoteAccountConsultTurn[]; message: string; briefDraft: NoteAccountConsultBriefDraft }) =>
      defaultConsultNoteAccount(input, { jobId }));
  const now = deps.now ?? (() => new Date());

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, consultationId, messageId } });
  }
  if (existing.status === 'done') {
    log.info({ task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId }, 'job already done — skipping (idempotent)');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now(), finished_at: null, error: null },
  });
  if (cas.count === 0) {
    log.info({ task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId }, 'job not in queued/failed state — skipping');
    return;
  }

  try {
    const message = await prisma.noteAccountConsultationMessage.findUnique({
      where: { id: messageId },
      select: { id: true, consultation_id: true, role: true, content: true, status: true, created_at: true },
    });
    if (!message || message.consultation_id !== consultationId || message.role !== 'operator') {
      throw new NotFoundError(`operator message not found: ${messageId}`, {
        details: { consultationId, messageId },
      });
    }

    // 二重実行防止: pending/failed のときだけ processing に進める。
    const msgCas = await prisma.noteAccountConsultationMessage.updateMany({
      where: { id: messageId, status: { in: ['pending', 'failed'] } },
      data: { status: 'processing', error: null },
    });
    if (msgCas.count === 0) {
      log.info(
        { task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId, messageId, status: message.status },
        'message not pending/failed — skipping',
      );
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', finished_at: now(), error: null, result_json: { skipped: true } },
      });
      return;
    }

    const consultation = await prisma.noteAccountConsultation.findUnique({
      where: { id: consultationId },
      select: { id: true, title: true, brief_draft_json: true },
    });
    if (!consultation) {
      throw new NotFoundError(`NoteAccountConsultation not found: ${consultationId}`, {
        details: { consultationId, jobId },
      });
    }

    const prior = await prisma.noteAccountConsultationMessage.findMany({
      where: { consultation_id: consultationId, status: 'done', created_at: { lt: message.created_at } },
      orderBy: { created_at: 'asc' },
      select: { role: true, content: true },
    });
    const history: NoteAccountConsultTurn[] = prior
      .filter((m) => m.role === 'operator' || m.role === 'advisor')
      .map((m) => ({ role: m.role as 'operator' | 'advisor', content: m.content }));

    const draftParsed = NoteAccountConsultBriefDraftSchema.safeParse(consultation.brief_draft_json ?? {});
    const briefDraft: NoteAccountConsultBriefDraft = draftParsed.success ? draftParsed.data : {};

    const { output, research } = await consult({ history, message: message.content, briefDraft });

    await prisma.noteAccountConsultationMessage.create({
      data: {
        consultation_id: consultationId,
        role: 'advisor',
        content: output.reply,
        status: 'done',
        research_json: { research, suggested_questions: output.suggested_questions },
      },
    });

    const title = consultation.title.trim().length > 0 ? consultation.title : deriveConsultTitle(message.content);
    await prisma.noteAccountConsultation.update({
      where: { id: consultationId },
      data: {
        title,
        brief_draft_json: output.brief_draft as unknown as Record<string, unknown>,
        ready_to_design: output.ready_to_design,
      },
    });

    await prisma.noteAccountConsultationMessage.update({
      where: { id: messageId },
      data: { status: 'done', error: null },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { consultation_id: consultationId, research_count: research.length },
      },
    });

    log.info(
      { task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId, consultationId, researchCount: research.length },
      'note.account.consult done — advisor replied',
    );
  } catch (err) {
    const errorMessage = serializeError(err);
    try {
      await prisma.noteAccountConsultationMessage.update({
        where: { id: messageId },
        data: { status: 'failed', error: errorMessage },
      });
    } catch (msgErr) {
      log.warn(
        { task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId, messageId, err: msgErr },
        'failed to mark operator message as failed',
      );
    }
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: errorMessage },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: NOTE_ACCOUNT_CONSULT_TASK_NAME, jobId, err: jobUpdateErr },
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

export const noteAccountConsultTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountConsult(payload);
};
