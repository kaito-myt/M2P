'use server';

/**
 * note アカウント戦略の AI 相談 (F-ANP-04, docs/11-anp-design.md §3.1/§7) Server Actions。
 *
 * 運営者要望 (2026-09-21)「ANP で最初アカウント戦略策定する時に、AI に相談しながらリサーチや
 * 戦略策定を行えるようにして」への対応。A2P の CEO 対話 (`apps/web/app/actions/org.ts`
 * `sendCeoMessage`) と同型: 運営者メッセージを保存 → `note.account.consult` を enqueue → worker が
 * AI 返答 (Tavily リサーチ込み) を advisor メッセージとして追加。UI は `getConsultationState` を
 * ポーリングして反映する。
 *
 * - `startConsultation`: 最初のメッセージで相談を開始する。
 * - `sendConsultMessage`: 既存の相談にメッセージを送る (前の返答待ち中は不可)。
 * - `retryConsultMessage`: 失敗した運営者メッセージの AI 返答を再実行する。
 * - `getConsultationState`: ポーリング用のスナップショット。
 * - `createDesignFromConsultation`: AI が組み立てたブリーフ草案から設計案 (F-ANP-01) を生成する。
 * - `archiveConsultation`: 相談を一覧から片付ける。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { Prisma, prisma } from '@a2p/db';
import {
  briefDraftToDesignBrief,
  NoteAccountConsultBriefDraftSchema,
  type NoteAccountConsultBriefDraft,
} from '@a2p/contracts/agents/anp';

import { auth } from '@/auth';
import { createDesignAndEnqueue } from '@/lib/account-design-core';
import { loadConsultationState, type ConsultationStateView } from '@/lib/account-consult-core';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';

import type { ActionResult } from './account-design';

const NOTE_ACCOUNT_CONSULT_TASK_NAME = 'note.account.consult';
/** 一覧用の題: 最初の運営者メッセージの先頭 40 字 (worker `deriveConsultTitle` と同じ)。 */
const CONSULT_TITLE_MAX = 40;

const m = messages.accountConsult.errors;

const MessageTextSchema = z.string().trim().min(1, m.messageRequired).max(4000, m.messageTooLong);

function deriveTitle(firstMessage: string): string {
  const oneLine = firstMessage.replace(/\s+/g, ' ').trim();
  return oneLine.length > CONSULT_TITLE_MAX ? `${oneLine.slice(0, CONSULT_TITLE_MAX)}…` : oneLine;
}

/** 運営者メッセージ 1 件を pending で作り、返答生成タスクを enqueue する。 */
async function enqueueOperatorMessage(consultationId: string, text: string): Promise<string> {
  const msg = await prisma.noteAccountConsultationMessage.create({
    data: { consultation_id: consultationId, role: 'operator', content: text, status: 'pending' },
    select: { id: true },
  });
  const job = await prisma.job.create({
    data: {
      kind: NOTE_ACCOUNT_CONSULT_TASK_NAME,
      status: 'queued',
      payload_json: { consultation_id: consultationId, message_id: msg.id },
    },
  });
  await enqueueJob(
    NOTE_ACCOUNT_CONSULT_TASK_NAME,
    { consultation_id: consultationId, message_id: msg.id, job_id: job.id },
    { maxAttempts: 2 },
  );
  return msg.id;
}

// ---------------------------------------------------------------------------
// startConsultation
// ---------------------------------------------------------------------------

const StartSchema = z.object({ message: MessageTextSchema });

export async function startConsultation(input: unknown): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? m.startFailed };

  try {
    const consultation = await prisma.noteAccountConsultation.create({
      data: { title: deriveTitle(parsed.data.message), status: 'active' },
      select: { id: true },
    });
    await enqueueOperatorMessage(consultation.id, parsed.data.message);
    revalidatePath('/accounts/design/consult');
    return { ok: true, data: { id: consultation.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.startFailed };
  }
}

// ---------------------------------------------------------------------------
// sendConsultMessage
// ---------------------------------------------------------------------------

const SendSchema = z.object({ consultation_id: z.string().min(1), message: MessageTextSchema });

export async function sendConsultMessage(
  input: unknown,
): Promise<ActionResult<{ message_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? m.sendFailed };
  const { consultation_id: consultationId, message } = parsed.data;

  try {
    const consultation = await prisma.noteAccountConsultation.findUnique({
      where: { id: consultationId },
      select: { status: true },
    });
    if (!consultation) return { ok: false, error: m.notFound };
    if (consultation.status !== 'active') return { ok: false, error: m.archived };

    // 返答待ち (pending/processing) の運営者メッセージがある間は次を受け付けない
    // (会話履歴の順序を保つ。CEO 対話と同じ制約)。
    const inflight = await prisma.noteAccountConsultationMessage.count({
      where: { consultation_id: consultationId, role: 'operator', status: { in: ['pending', 'processing'] } },
    });
    if (inflight > 0) return { ok: false, error: m.awaitingReply };

    const messageId = await enqueueOperatorMessage(consultationId, message);
    return { ok: true, data: { message_id: messageId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.sendFailed };
  }
}

// ---------------------------------------------------------------------------
// retryConsultMessage
// ---------------------------------------------------------------------------

const RetrySchema = z.object({ consultation_id: z.string().min(1), message_id: z.string().min(1) });

export async function retryConsultMessage(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = RetrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.sendFailed };
  const { consultation_id: consultationId, message_id: messageId } = parsed.data;

  try {
    const guard = await prisma.noteAccountConsultationMessage.updateMany({
      where: { id: messageId, consultation_id: consultationId, role: 'operator', status: 'failed' },
      data: { status: 'pending', error: null },
    });
    if (guard.count === 0) return { ok: false, error: m.notFound };

    const job = await prisma.job.create({
      data: {
        kind: NOTE_ACCOUNT_CONSULT_TASK_NAME,
        status: 'queued',
        payload_json: { consultation_id: consultationId, message_id: messageId, retry: true },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_CONSULT_TASK_NAME,
      { consultation_id: consultationId, message_id: messageId, job_id: job.id },
      { maxAttempts: 2 },
    );
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.sendFailed };
  }
}

// ---------------------------------------------------------------------------
// getConsultationState (ポーリング用)
// ---------------------------------------------------------------------------

const StateSchema = z.object({ consultation_id: z.string().min(1) });

export async function getConsultationState(input: unknown): Promise<ActionResult<ConsultationStateView>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const parsed = StateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.notFound };
  const state = await loadConsultationState(parsed.data.consultation_id);
  if (!state) return { ok: false, error: m.notFound };
  return { ok: true, data: state };
}

// ---------------------------------------------------------------------------
// createDesignFromConsultation
// ---------------------------------------------------------------------------

const CreateDesignSchema = z.object({
  consultation_id: z.string().min(1),
  /** 省略時は DB の最新草案を使う。UI で手直しした草案を渡すこともできる。 */
  brief_draft: NoteAccountConsultBriefDraftSchema.optional(),
});

export async function createDesignFromConsultation(
  input: unknown,
): Promise<ActionResult<{ design_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = CreateDesignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.designFailed };
  const { consultation_id: consultationId } = parsed.data;

  try {
    const row = await prisma.noteAccountConsultation.findUnique({
      where: { id: consultationId },
      select: { brief_draft_json: true },
    });
    if (!row) return { ok: false, error: m.notFound };

    let draft: NoteAccountConsultBriefDraft;
    if (parsed.data.brief_draft) {
      draft = parsed.data.brief_draft;
      // 手直し済みの草案は相談側にも保存し、以後の会話がその内容を引き継ぐようにする。
      await prisma.noteAccountConsultation.update({
        where: { id: consultationId },
        data: { brief_draft_json: draft as unknown as Prisma.InputJsonValue },
      });
    } else {
      const fromDb = NoteAccountConsultBriefDraftSchema.safeParse(row.brief_draft_json ?? {});
      draft = fromDb.success ? fromDb.data : {};
    }

    const brief = briefDraftToDesignBrief(draft);
    if (!brief) return { ok: false, error: m.ideaMissing };

    const designId = await createDesignAndEnqueue(brief, { consultationId });

    revalidatePath('/accounts/design');
    revalidatePath(`/accounts/design/consult/${consultationId}`);
    return { ok: true, data: { design_id: designId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.designFailed };
  }
}

// ---------------------------------------------------------------------------
// archiveConsultation
// ---------------------------------------------------------------------------

const ArchiveSchema = z.object({ consultation_id: z.string().min(1) });

export async function archiveConsultation(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = ArchiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.archiveFailed };

  try {
    const guard = await prisma.noteAccountConsultation.updateMany({
      where: { id: parsed.data.consultation_id, status: 'active' },
      data: { status: 'archived' },
    });
    if (guard.count === 0) return { ok: false, error: m.archiveFailed };
    revalidatePath('/accounts/design/consult');
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : m.archiveFailed };
  }
}
