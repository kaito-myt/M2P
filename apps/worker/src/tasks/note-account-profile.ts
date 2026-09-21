import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import {
  generateNoteAccountDesignImages as defaultGenerateNoteAccountDesignImages,
  generateNoteAccountEditorial as defaultGenerateNoteAccountEditorial,
  generateNoteAccountPromotionPolicy as defaultGenerateNoteAccountPromotionPolicy,
  generateNoteAccountProfile as defaultGenerateNoteAccountProfile,
  type NoteAccountDesignImages,
  type NoteAccountEditorialInput,
} from '@a2p/agents/anp/strategist';
import {
  generateImage as defaultGenerateImage,
  withImageLogging,
  type GenerateImageFn,
} from '@a2p/agents';
import {
  NoteAccountDesignSchema,
  NoteAccountProfileTargetSchema,
  type NoteAccountEditorialOutput,
  type NoteAccountProfileInput,
  type NoteAccountProfileOutput,
  type NoteAccountProfileTarget,
  NOTE_PROMOTION_CHANNELS,
  parseNotePromotionPolicy,
  type NotePromotionPolicyInput,
  type NotePromotionPolicyOutput,
} from '@a2p/contracts/agents/anp';
import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';
import { anpAccountAvatar, anpAccountHeader } from '@a2p/storage/keys';

/**
 * `note.account.profile` タスク (docs/11-anp-design.md §3.1/§7, F-ANP-05).
 *
 * 運営者要望 (2026-09-21)「アカウント詳細ページで、アイコン、カバー画像を生成して DL できるように
 * して。自己紹介文も生成してコピーできるようにして」への対応。`/accounts/[id]` の
 * 「自己紹介文を生成」「アイコン/カバーを生成」から enqueue される。
 *
 * フロー:
 *   1. payload zod parse ({ note_account_id, job_id, targets: ('bio'|'visuals')[], instruction? })
 *   2. 内部 `Job` を findUnique。既に done ならスキップ。CAS で queued/failed → running。
 *   3. `note_accounts` (+ 採用済み設計案があればその design_json) を読む。
 *   4. LLM (`generateNoteAccountProfile`, role=anp.strategist) で bio / avatar_prompt / header_prompt /
 *      persona_type を生成。**targets が visuals のみ、かつ採用済み設計案に画像プロンプトがあり、
 *      追加指示も無い場合は LLM を呼ばず設計案のプロンプトを使う** (コスト節約)。
 *   5. targets に 'bio' があれば `note_accounts.bio` を更新。
 *   6. targets に 'visuals' があれば gpt-image でアイコン/ヘッダーを生成し R2
 *      `anp/accounts/<id>/avatar-<stamp>.png` / `header-<stamp>.jpg` に保存、キーを更新。
 *   7. Job を done (result_json: bio_alternatives / prompts / keys)。
 *
 * 失敗時: Job を failed にして rethrow (`note_accounts` は変更しない = 再試行可能)。
 *
 * 進捗 (運営者要望 2026-09-21「生成中の完了目安時間が分からないから進捗率を見えるように」):
 *   実行中は `Job.result_json.progress = { stage, pct, at }` を段階ごとに書く (UI がポーリングで表示)。
 *   stage = prompt (LLM) → avatar → header → upload。done 時は result_json を最終結果で置き換える。
 */

export type NoteAccountProfileStage = 'prompt' | 'avatar' | 'header' | 'upload' | 'editorial' | 'promotion';

export const NOTE_ACCOUNT_PROFILE_TASK_NAME = 'note.account.profile';

export const NoteAccountProfilePayloadSchema = z.object({
  note_account_id: z.string().min(1),
  job_id: z.string().min(1),
  targets: z.array(NoteAccountProfileTargetSchema).min(1),
  instruction: z.string().max(1000).optional(),
  /** F-ANP-06: 添付した参考画像の R2 キー。LLM のビジョン入力として渡す (縮小して base64 化)。 */
  reference_image_keys: z.array(z.string().min(1)).max(4).optional(),
  /** F-ANP-32: targets=['promotion'] のときの対象媒体。 */
  channel: z.enum(NOTE_PROMOTION_CHANNELS).optional(),
});
export type NoteAccountProfilePayload = z.infer<typeof NoteAccountProfilePayloadSchema>;

export interface NoteAccountProfilePrisma {
  job: {
    findUnique: (args: { where: { id: string }; select: { status: true } }) => Promise<{ status: string } | null>;
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
      select: {
        id: true;
        display_name: true;
        handle: true;
        niche: true;
        target_reader: true;
        tone: true;
        bio: true;
        editorial_policy?: true;
        promotion_policy_json?: true;
        designs: { where: { status: string }; orderBy: { created_at: 'desc' }; take: number; select: { design_json: true } };
      };
    }) => Promise<{
      id: string;
      display_name: string;
      handle: string | null;
      niche: string;
      target_reader: string | null;
      tone: string | null;
      bio: string | null;
      editorial_policy?: string | null;
      promotion_policy_json?: unknown;
      designs: Array<{ design_json: unknown }>;
    } | null>;
    update: (args: {
      where: { id: string };
      data: {
        bio?: string;
        avatar_r2_key?: string;
        header_r2_key?: string;
        profile_generated_at?: Date;
        target_reader?: string;
        tone?: string;
        editorial_policy?: string;
        promotion_policy_json?: unknown;
      };
    }) => Promise<unknown>;
  };
}

export interface UploadBufferFn {
  (key: string, buffer: Buffer, contentType: string): Promise<unknown>;
}

export interface ReferenceImage {
  data: string;
  mimeType: string;
}

export interface NoteAccountProfileDeps {
  prisma?: NoteAccountProfilePrisma;
  logger?: Logger;
  /** R2 キー → ビジョン入力 (既定: downloadBuffer + sharp で長辺 1280px の JPEG に縮小)。 */
  loadReferenceImages?: (keys: string[]) => Promise<ReferenceImage[]>;
  generateProfile?: (input: NoteAccountProfileInput) => Promise<NoteAccountProfileOutput>;
  /** F-ANP-07: 記事の方針・トンマナの生成 (targets=['editorial'])。 */
  generateEditorial?: (input: NoteAccountEditorialInput) => Promise<NoteAccountEditorialOutput>;
  /** F-ANP-32: 媒体別の販促施策の生成 (targets=['promotion'], payload.channel)。 */
  generatePromotionPolicy?: (input: NotePromotionPolicyInput) => Promise<NotePromotionPolicyOutput>;
  generateImages?: (
    design: { avatar_prompt: string; header_prompt: string; persona_type: 'person' | 'brand' },
  ) => Promise<NoteAccountDesignImages>;
  generateImage?: GenerateImageFn;
  uploadBuffer?: UploadBufferFn;
  now?: () => Date;
}

async function defaultUploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<unknown> {
  const mod = await import('@a2p/storage/operations');
  return mod.uploadBuffer(key, buffer, contentType);
}

/** 参考画像を R2 から読み、LLM 向けに縮小 (長辺 1280px, JPEG q80) して base64 で返す。失敗した画像は飛ばす。 */
export async function defaultLoadReferenceImages(keys: string[]): Promise<ReferenceImage[]> {
  const { downloadBuffer } = await import('@a2p/storage/operations');
  const sharp = (await import('sharp')).default;
  const out: ReferenceImage[] = [];
  for (const key of keys) {
    try {
      const buf = await downloadBuffer(key);
      if (!buf) continue;
      const resized = await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      out.push({ data: resized.toString('base64'), mimeType: 'image/jpeg' });
    } catch {
      // 読めない/壊れた画像は無視して続行
    }
  }
  return out;
}

/** R2 キー用のスタンプ (`YYYYMMDDHHmmss`、`assertId` の英数字制約を満たす)。 */
export function profileKeyStamp(d: Date): string {
  return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

export async function runNoteAccountProfile(
  payload: unknown,
  deps: NoteAccountProfileDeps = {},
): Promise<void> {
  const parsed = NoteAccountProfilePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('note.account.profile payload が不正です', {
      details: { issues: parsed.error.issues },
    });
  }
  const { note_account_id: accountId, job_id: jobId, targets, instruction, reference_image_keys: referenceImageKeys, channel } = parsed.data;
  const wants = (t: NoteAccountProfileTarget) => targets.includes(t);

  const log = deps.logger ?? createLogger(`worker.${NOTE_ACCOUNT_PROFILE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteAccountProfilePrisma);
  const uploadBuffer = deps.uploadBuffer ?? defaultUploadBuffer;
  const loadReferenceImages = deps.loadReferenceImages ?? defaultLoadReferenceImages;
  const now = deps.now ?? (() => new Date());
  const generateProfile =
    deps.generateProfile ?? ((input: NoteAccountProfileInput) => defaultGenerateNoteAccountProfile(input, { jobId }));
  const generateEditorial =
    deps.generateEditorial ?? ((input: NoteAccountEditorialInput) => defaultGenerateNoteAccountEditorial(input, { jobId }));
  const generatePromotionPolicy =
    deps.generatePromotionPolicy ?? ((input: NotePromotionPolicyInput) => defaultGenerateNoteAccountPromotionPolicy(input, { jobId }));
  const imageFn: GenerateImageFn =
    deps.generateImage ?? withImageLogging(defaultGenerateImage, { jobId, role: 'anp.strategist' });
  // 画像は avatar → header の順に直列で呼ばれるので、呼出回数で段階を判定して進捗を書く。
  let imageCalls = 0;
  const trackedImageFn: GenerateImageFn = async (args) => {
    imageCalls += 1;
    if (imageCalls === 2) await report('header', 65);
    return imageFn(args);
  };
  const generateImages =
    deps.generateImages ??
    ((design) => defaultGenerateNoteAccountDesignImages(design, { generateImage: trackedImageFn }));

  /** 進捗を Job.result_json.progress に書く (失敗しても処理は止めない)。 */
  const report = async (stage: NoteAccountProfileStage, pct: number): Promise<void> => {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { result_json: { progress: { stage, pct, at: now().toISOString() } } },
      });
    } catch (err) {
      log.warn({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId, stage, err }, 'failed to report progress');
    }
  };

  const existing = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  if (!existing) {
    throw new NotFoundError(`Job not found: ${jobId}`, { details: { jobId, accountId } });
  }
  if (existing.status === 'done') {
    log.info({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId }, 'job already done — skipping (idempotent)');
    return;
  }
  const cas = await prisma.job.updateMany({
    where: { id: jobId, status: { in: ['queued', 'failed'] } },
    data: { status: 'running', started_at: now(), finished_at: null, error: null },
  });
  if (cas.count === 0) {
    log.info({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId }, 'job not in queued/failed state — skipping');
    return;
  }

  try {
    const account = await prisma.noteAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        display_name: true,
        handle: true,
        niche: true,
        target_reader: true,
        tone: true,
        bio: true,
        editorial_policy: true,
        promotion_policy_json: true,
        designs: { where: { status: 'adopted' }, orderBy: { created_at: 'desc' }, take: 1, select: { design_json: true } },
      },
    });
    if (!account) {
      throw new NotFoundError(`NoteAccount not found: ${accountId}`, { details: { accountId, jobId } });
    }

    const designParsed = account.designs[0]?.design_json
      ? NoteAccountDesignSchema.safeParse(account.designs[0].design_json)
      : null;
    const design = designParsed?.success ? designParsed.data : null;

    // 参考画像 (F-ANP-06) があれば LLM に渡す (= 追加指示と同じく LLM 経由にする)。
    const referenceImages = referenceImageKeys && referenceImageKeys.length > 0 ? await loadReferenceImages(referenceImageKeys) : [];

    // F-ANP-32: 媒体別の販促施策 (promotion) も独立して処理し、ここで完了する。
    if (wants('promotion')) {
      if (!channel) throw new ValidationError('note.account.profile: channel is required for targets=promotion', { details: { jobId } });
      await report('promotion', 15);
      const current = parseNotePromotionPolicy(account.promotion_policy_json);
      const existing = current[channel];
      const promoInput: NotePromotionPolicyInput = {
        note_account_id: accountId,
        job_id: jobId,
        channel,
        account: {
          display_name: account.display_name,
          handle: account.handle,
          niche: account.niche,
          target_reader: account.target_reader,
          tone: account.tone,
          bio: account.bio,
          editorial_policy: account.editorial_policy ?? null,
          concept: design?.concept ?? null,
        },
        ...(existing ? { existing_policy: existing } : {}),
        ...(instruction ? { instruction } : {}),
        ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
      };
      const generated = await generatePromotionPolicy(promoInput);
      const nextChannel = {
        ...(existing ?? { hashtags: [] }),
        policy: generated.policy,
        hashtags: generated.hashtags,
        ...(generated.posts_per_week !== undefined ? { posts_per_week: generated.posts_per_week } : {}),
        ...(generated.cta ? { cta: generated.cta } : {}),
        ...(generated.rationale ? { rationale: generated.rationale } : {}),
        updated_at: now().toISOString(),
      };
      const nextPolicy = { ...current, [channel]: nextChannel };
      await prisma.noteAccount.update({ where: { id: accountId }, data: { promotion_policy_json: nextPolicy } });
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'done',
          finished_at: now(),
          error: null,
          result_json: {
            note_account_id: accountId,
            targets,
            channel,
            used_llm: true,
            reference_images: referenceImages.length,
            promotion: { hashtags: generated.hashtags, posts_per_week: generated.posts_per_week ?? null, rationale: generated.rationale ?? null },
          },
        },
      });
      log.info({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId, accountId, channel }, 'note.account.profile done (promotion)');
      return;
    }

    // F-ANP-07: 記事の方針・トンマナ (editorial) は bio/visuals と独立して処理し、ここで完了する。
    if (wants('editorial')) {
      await report('editorial', 15);
      const editorialInput: NoteAccountEditorialInput = {
        display_name: account.display_name,
        ...(account.handle ? { handle: account.handle } : {}),
        niche: account.niche,
        ...(account.target_reader ? { target_reader: account.target_reader } : {}),
        ...(account.tone ? { tone: account.tone } : {}),
        ...(design?.concept ? { concept: design.concept } : {}),
        ...(design?.character_sheet ? { character_sheet: design.character_sheet } : {}),
        ...(design ? { content_pillars: design.content_pillars.map((p) => p.name) } : {}),
        ...(design ? { persona_type: design.persona_type } : {}),
        ...(account.bio ? { existing_bio: account.bio } : {}),
        ...(account.editorial_policy ? { existing_policy: account.editorial_policy } : {}),
        ...(instruction ? { instruction } : {}),
        ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
      };
      const editorial = await generateEditorial(editorialInput);
      await prisma.noteAccount.update({
        where: { id: accountId },
        data: {
          target_reader: editorial.target_reader,
          tone: editorial.tone,
          editorial_policy: editorial.editorial_policy,
          profile_generated_at: now(),
        },
      });
      await prisma.job.update({
        where: { id: jobId },
        data: {
          status: 'done',
          finished_at: now(),
          error: null,
          result_json: {
            note_account_id: accountId,
            targets,
            used_llm: true,
            reference_images: referenceImages.length,
            editorial: { target_reader: editorial.target_reader, tone: editorial.tone, rationale: editorial.rationale ?? null },
          },
        },
      });
      log.info({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId, accountId }, 'note.account.profile done (editorial)');
      return;
    }

    // 段階 4: プロンプト/bio の決定。
    let profile: NoteAccountProfileOutput;
    let usedLlm = false;
    if (!wants('bio') && design && !instruction && referenceImages.length === 0) {
      profile = {
        bio: account.bio ?? design.bio,
        bio_alternatives: [],
        avatar_prompt: design.avatar_prompt,
        header_prompt: design.header_prompt,
        persona_type: design.persona_type,
      };
    } else {
      const input: NoteAccountProfileInput = {
        display_name: account.display_name,
        ...(account.handle ? { handle: account.handle } : {}),
        niche: account.niche,
        ...(account.target_reader ? { target_reader: account.target_reader } : {}),
        ...(account.tone ? { tone: account.tone } : {}),
        ...(design?.concept ? { concept: design.concept } : {}),
        ...(design?.character_sheet ? { character_sheet: design.character_sheet } : {}),
        ...(design ? { content_pillars: design.content_pillars.map((p) => p.name) } : {}),
        ...(design ? { persona_type: design.persona_type } : {}),
        ...(account.bio ? { existing_bio: account.bio } : {}),
        ...(instruction ? { instruction } : {}),
        ...(referenceImages.length > 0 ? { reference_images: referenceImages } : {}),
      };
      await report('prompt', 10);
      profile = await generateProfile(input);
      usedLlm = true;
    }

    const update: { bio?: string; avatar_r2_key?: string; header_r2_key?: string; profile_generated_at: Date } = {
      profile_generated_at: now(),
    };
    if (wants('bio')) update.bio = profile.bio;

    // 段階 6: 画像。
    let avatarKey: string | undefined;
    let headerKey: string | undefined;
    if (wants('visuals')) {
      await report('avatar', 35);
      const images = await generateImages({
        avatar_prompt: profile.avatar_prompt,
        header_prompt: profile.header_prompt,
        persona_type: profile.persona_type,
      });
      await report('upload', 90);
      const stamp = profileKeyStamp(now());
      avatarKey = anpAccountAvatar(accountId, stamp);
      headerKey = anpAccountHeader(accountId, stamp);
      await uploadBuffer(avatarKey, images.avatar, 'image/png');
      await uploadBuffer(headerKey, images.header, 'image/jpeg');
      update.avatar_r2_key = avatarKey;
      update.header_r2_key = headerKey;
    }

    await prisma.noteAccount.update({ where: { id: accountId }, data: update });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        finished_at: now(),
        error: null,
        result_json: {
          note_account_id: accountId,
          targets,
          used_llm: usedLlm,
          reference_images: referenceImages.length,
          bio_alternatives: profile.bio_alternatives,
          avatar_prompt: profile.avatar_prompt,
          header_prompt: profile.header_prompt,
          persona_type: profile.persona_type,
          ...(avatarKey ? { avatar_r2_key: avatarKey } : {}),
          ...(headerKey ? { header_r2_key: headerKey } : {}),
        },
      },
    });

    log.info(
      { task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId, accountId, targets, usedLlm, avatarKey, headerKey },
      'note.account.profile done',
    );
  } catch (err) {
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'failed', finished_at: now(), error: serializeError(err) },
      });
    } catch (jobUpdateErr) {
      log.warn({ task: NOTE_ACCOUNT_PROFILE_TASK_NAME, jobId, err: jobUpdateErr }, 'failed to mark internal Job as failed');
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

export const noteAccountProfileTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountProfile(payload);
};
