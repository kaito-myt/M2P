import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  generateNoteAccountDesignImages as defaultGenerateNoteAccountDesignImages,
  type NoteAccountDesignImages,
} from '@a2p/agents/anp/strategist';
import {
  generateImage as defaultGenerateImage,
  withImageLogging,
  type GenerateImageFn,
} from '@a2p/agents';
import { NoteAccountDesignSchema, type NoteAccountDesign } from '@a2p/contracts/agents/anp';
import { ConfigError, NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';
import { anpAccountDesignAvatar, anpAccountDesignHeader } from '@a2p/storage/keys';

/**
 * `note.account.visuals` タスク (docs/11-anp-design.md §3.1/§7, F-ANP-01/03).
 *
 * `NoteAccountDesign.design_json` の avatar_prompt/header_prompt から gpt-image でアイコン/
 * ヘッダー画像を生成し R2 に保存する。`persona_type==='person'` のときのみ
 * `withPersonaVisualRules` (実写・顔なし・首から下) を適用する (`generateNoteAccountDesignImages`
 * 側で判定、`packages/agents/src/anp/strategist.ts` 参照)。
 *
 * フロー:
 *   1. payload zod parse ({ design_id, job_id })
 *   2. 内部 `Job` を findUnique。既に done ならスキップ。
 *   3. CAS で queued/failed → running。
 *   4. `NoteAccountDesign` fetch (design_json 未確定 → ConfigError)。
 *   5. `generateNoteAccountDesignImages` 呼出 (token_usage は role='anp.strategist' で INSERT)。
 *   6. R2 へ `anp/designs/{design_id}/avatar.png` / `header.jpg` を upload。
 *   7. `NoteAccountDesign.update` — avatar_r2_key/header_r2_key を保存。
 *   8. Job を done に遷移。
 */

export const NOTE_ACCOUNT_VISUALS_TASK_NAME = 'note.account.visuals';

export const NoteAccountVisualsPayloadSchema = z.object({
  design_id: z.string().min(1),
  job_id: z.string().min(1),
});
export type NoteAccountVisualsPayload = z.infer<typeof NoteAccountVisualsPayloadSchema>;

export interface NoteAccountVisualsPrisma {
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
      select: { id: true; design_json: true };
    }) => Promise<{ id: string; design_json: unknown } | null>;
    update: (args: {
      where: { id: string };
      data: { avatar_r2_key?: string; header_r2_key?: string; status?: string; error?: string | null };
    }) => Promise<unknown>;
  };
}

export interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<unknown>;
}

export interface NoteAccountVisualsDeps {
  prisma?: NoteAccountVisualsPrisma;
  logger?: Logger;
  generateImages?: (
    design: Pick<NoteAccountDesign, 'avatar_prompt' | 'header_prompt' | 'persona_type'>,
  ) => Promise<NoteAccountDesignImages>;
  /** 画像生成関数（既定は withImageLogging(generateImage)）。テスト差し替え用。 */
  generateImage?: GenerateImageFn;
  uploadBuffer?: UploadBufferFn;
  now?: () => Date;
}

async function defaultUploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<unknown> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer(key, buffer, contentType);
}

export async function runNoteAccountVisuals(
  payload: unknown,
  deps: NoteAccountVisualsDeps = {},
): Promise<void> {
  const parsed = NoteAccountVisualsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.account.visuals payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { design_id: designId, job_id: jobId } = parsed.data;

  const log = deps.logger ?? createLogger(`worker.${NOTE_ACCOUNT_VISUALS_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteAccountVisualsPrisma);
  const uploadBuffer = deps.uploadBuffer ?? defaultUploadBuffer;
  const now = deps.now ?? (() => new Date());

  // 画像生成はコスト記録（token_usage, role='anp.strategist'）付きで実行。
  const imageFn: GenerateImageFn =
    deps.generateImage ??
    withImageLogging(defaultGenerateImage, { jobId, role: 'anp.strategist' });
  const generateImages = deps.generateImages ?? ((design) => defaultGenerateNoteAccountDesignImages(design, { generateImage: imageFn }));

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, designId } });
  }
  if (existing.status === 'done') {
    log.info({ task: NOTE_ACCOUNT_VISUALS_TASK_NAME, jobId }, 'job already done — skipping (idempotent)');
    return;
  }

  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now(), finished_at: null, error: null },
  });
  if (cas.count === 0) {
    log.info({ task: NOTE_ACCOUNT_VISUALS_TASK_NAME, jobId }, 'job not in queued/failed state — skipping');
    return;
  }

  try {
    const row = await prisma.noteAccountDesign.findUnique({
      where: { id: designId },
      select: { id: true, design_json: true },
    });
    if (!row) {
      throw new NotFoundError(`NoteAccountDesign not found: ${designId}`, {
        details: { designId, jobId },
      });
    }
    if (!row.design_json) {
      throw new ConfigError('note.account.visuals: design_json が未確定です (先に設計を生成してください)', {
        details: { designId, jobId },
      });
    }
    const design = NoteAccountDesignSchema.parse(row.design_json);

    const images = await generateImages(design);
    const avatarKey = anpAccountDesignAvatar(designId);
    const headerKey = anpAccountDesignHeader(designId);
    await uploadBuffer(avatarKey, images.avatar, 'image/png');
    await uploadBuffer(headerKey, images.header, 'image/jpeg');

    await prisma.noteAccountDesign.update({
      where: { id: designId },
      data: { avatar_r2_key: avatarKey, header_r2_key: headerKey },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: { design_id: designId, avatar_r2_key: avatarKey, header_r2_key: headerKey },
      },
    });

    log.info(
      { task: NOTE_ACCOUNT_VISUALS_TASK_NAME, jobId, designId, avatarKey, headerKey },
      'note.account.visuals done — images uploaded',
    );
  } catch (err) {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: serializeError(err) },
      });
    } catch (jobUpdateErr) {
      log.warn(
        { task: NOTE_ACCOUNT_VISUALS_TASK_NAME, jobId, err: jobUpdateErr },
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

export const noteAccountVisualsTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountVisuals(payload);
};
