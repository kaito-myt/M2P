/**
 * note アカウント設計 (F-ANP-01/03/04) の共通ロジック — Server Action から切り出した
 * 「NoteAccountDesign 行を作って `note.account.design` を enqueue する」処理。
 * ブリーフ直接入力 (`actions/account-design.ts`) と AI 相談からの生成 (`actions/account-consult.ts`)
 * の両方から使う。
 */
import { Prisma, prisma } from '@a2p/db';
import type { NoteAccountDesignBrief } from '@a2p/contracts/agents/anp';

import { enqueueJob } from '@/lib/graphile-client';

export const NOTE_ACCOUNT_DESIGN_TASK_NAME = 'note.account.design';

/**
 * ブリーフから `NoteAccountDesign` (status='generating') を作成し、設計生成タスクを enqueue する。
 * @returns 作成した design の id
 */
export async function createDesignAndEnqueue(
  brief: NoteAccountDesignBrief,
  opts: { consultationId?: string } = {},
): Promise<string> {
  const design = await prisma.noteAccountDesign.create({
    data: {
      brief_json: brief as unknown as Prisma.InputJsonValue,
      status: 'generating',
      ...(opts.consultationId ? { consultation_id: opts.consultationId } : {}),
    },
    select: { id: true },
  });

  const job = await prisma.job.create({
    data: {
      kind: NOTE_ACCOUNT_DESIGN_TASK_NAME,
      status: 'queued',
      payload_json: { design_id: design.id },
    },
  });
  await enqueueJob(
    NOTE_ACCOUNT_DESIGN_TASK_NAME,
    { design_id: design.id, job_id: job.id },
    { maxAttempts: 3 },
  );
  return design.id;
}
