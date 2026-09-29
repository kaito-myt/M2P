/**
 * `paperback.draft` タスク — **ペーパーバックの下書き作成をサーバー側で行う** (F-097f)。
 *
 * 運営者指示 (2026-09-29)「ペーパーバックの下書き作成についてもローカルではなくてサーバー側で
 * やってって言ったよね？基本すべての作業をサーバー側でやってほしいのですよ」。
 * ローカル専用だった `scripts/paperback/pb-auto.sh draft`（plan → 表紙 PDF 生成 → pb-pilot）を
 * そのまま worker に移す。出版側 (`paperback.submit`) と合わせて、ペーパーバックの全工程が
 * Railway で回るようになる。
 *
 * 流れ:
 *   1. 対象本の本文 PDF (`books/{id}/manuscript/final.pdf`) を R2 から取得し、頁数から可否判定
 *      (`computePaperbackPlan`。ノド余白 NG / 頁数レンジ外はここで落として長めのクールダウン)
 *   2. ラップカバー PDF を生成して R2 `books/{id}/paperback/cover.pdf` に保存
 *      (既にあれば再利用。`buildPaperbackWrapCover` + sharp でセーフゾーン画像を作る)
 *   3. `PaperbackDraftPort.createDraft` が KDP の本棚から下書きを作り、原稿と表紙を上げる
 *   4. 成功したら `pb_publish_status='drafted'` / `pb_title_id` / `pb_drafted_at` を書き戻す
 *      (以降は `paperback.submit.dispatch` が拾って出版する)
 *
 * 安全側:
 *   - 作成数上限 (`creation_limit`) を引いたら **20 時間**のクールダウンを置く。叩き続けない。
 *   - 判定 NG (ノド余白/頁数) は 168 時間 (1 週間)。本文の組版を変えない限り直らないため。
 *   - 出版はしない。下書きまで。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { NotFoundError, ValidationError } from '@a2p/contracts/errors';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';
import { buildPaperbackWrapCover, safeAreaPixels } from '@a2p/output-pdf';

import { computePaperbackPlan, countPdfPages } from './paperback-draft/plan.js';
import type { PaperbackDraftPort, PaperbackDraftResult } from './paperback-draft/playwright-paperback-draft-port.js';

export const PAPERBACK_DRAFT_TASK_NAME = 'paperback.draft';

/** 作成数上限に当たったときのクールダウン (時間)。 */
export const CREATION_LIMIT_COOLDOWN_HOURS = 20;
/** 判定 NG (ノド余白/頁数レンジ) のクールダウン (時間)。 */
export const PLAN_NG_COOLDOWN_HOURS = 168;
/** その他の失敗のクールダウン (時間)。 */
export const FAILURE_COOLDOWN_HOURS = 20;

export const PaperbackDraftPayloadSchema = z.object({
  book_id: z.string().min(1),
});
export type PaperbackDraftPayload = z.infer<typeof PaperbackDraftPayloadSchema>;

interface DraftBookRow {
  id: string;
  title: string;
  subtitle: string | null;
  asin: string | null;
  pb_publish_status: string;
  pb_title_id: string | null;
}

export interface PaperbackDraftPrisma {
  book: {
    findUnique: (args: { where: { id: string } }) => Promise<DraftBookRow | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  kdpMetadata: {
    findFirst: (args: {
      where: { book_id: string };
      orderBy: { created_at: 'desc' };
    }) => Promise<{ categories: unknown; description: string | null } | null>;
  };
  /** 採用済みの表紙画像 (`covers.status='adopted'` の最新)。 */
  cover: {
    findFirst: (args: {
      where: { book_id: string; status: string };
      orderBy: { created_at: 'desc' };
    }) => Promise<{ r2_key: string | null } | null>;
  };
  /** 本文 PDF (`artifacts.kind='pdf'` の最新)。 */
  artifact: {
    findFirst: (args: {
      where: { book_id: string; kind: string };
      orderBy: { created_at: 'desc' };
    }) => Promise<{ r2_key: string | null } | null>;
  };
  account: {
    findFirst: (args: {
      where: Record<string, unknown>;
    }) => Promise<{ kdp_session_state_enc: string | null; kdp_2fa_secret_enc: string | null } | null>;
  };
}

export interface PaperbackDraftDeps {
  prisma?: PaperbackDraftPrisma;
  logger?: Logger;
  port: PaperbackDraftPort;
  now?: () => Date;
  /** R2 からの取得 (テスト差し替え可)。 */
  fetchAsset?: (key: string) => Promise<Buffer | null>;
  /** R2 への保存。 */
  putAsset?: (key: string, buf: Buffer, contentType: string) => Promise<unknown>;
  decryptSession?: (enc: string) => string;
  env?: NodeJS.ProcessEnv;
}

export interface PaperbackDraftResultSummary {
  ok: boolean;
  status: string;
  titleId?: string | null;
  pages?: number;
}

/** R2 のラップカバー保存先。 */
export function paperbackCoverKey(bookId: string): string {
  return `books/${bookId}/paperback/cover.pdf`;
}

/** 本文 PDF の R2 キー。 */
export function manuscriptPdfKey(bookId: string): string {
  return `books/${bookId}/manuscript/final.pdf`;
}

/** kdp_metadata.categories を文字列配列に正規化する。 */
export function readCategoryPaths(categories: unknown): string[] {
  if (Array.isArray(categories)) return categories.map((c) => String(c));
  if (typeof categories === 'string') {
    try {
      const parsed: unknown = JSON.parse(categories);
      return Array.isArray(parsed) ? parsed.map((c) => String(c)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function runPaperbackDraft(
  payload: unknown,
  deps: PaperbackDraftDeps,
): Promise<PaperbackDraftResultSummary> {
  const parsed = PaperbackDraftPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ValidationError('paperback.draft payload が不正です', { details: { issues: parsed.error.issues } });
  }
  const bookId = parsed.data.book_id;

  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_DRAFT_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PaperbackDraftPrisma);
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;

  const cooldown = (hours: number): Date => new Date(now().getTime() + hours * 3600_000);
  const fail = async (status: string, message: string, hours: number): Promise<PaperbackDraftResultSummary> => {
    await prisma.book
      .update({
        where: { id: bookId },
        data: { pb_last_error: `${status}: ${message}`.slice(0, 400), pb_submit_cooldown_until: cooldown(hours) },
      })
      .catch(() => {});
    log.warn({ bookId, status, fail_message: message }, 'paperback.draft failed');
    return { ok: false, status };
  };

  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) throw new NotFoundError(`Book not found: ${bookId}`, { details: { bookId } });
  if (book.pb_publish_status !== 'unlisted' || book.pb_title_id) {
    log.info({ bookId, status: book.pb_publish_status }, '既に下書き以降 — skip');
    return { ok: true, status: 'already_drafted', titleId: book.pb_title_id };
  }
  if (!book.asin) {
    return fail('no_asin', 'Kindle 版の ASIN が無いので本棚から行を特定できません', PLAN_NG_COOLDOWN_HOURS);
  }

  const fetchAsset = deps.fetchAsset ?? (await defaultFetchAsset());
  const putAsset = deps.putAsset ?? (await defaultPutAsset());

  // 表紙は `covers` の採用済み最新、本文 PDF は `artifacts.kind='pdf'` を正とする
  // (`pb-plan.cjs` と同じ取り方。books に列は無い)。
  const coverRow = await prisma.cover.findFirst({
    where: { book_id: bookId, status: 'adopted' },
    orderBy: { created_at: 'desc' },
  });
  if (!coverRow?.r2_key) {
    return fail('no_cover', '採用済みの表紙画像がありません (covers.status=adopted)', PLAN_NG_COOLDOWN_HOURS);
  }
  const pdfArtifact = await prisma.artifact.findFirst({
    where: { book_id: bookId, kind: 'pdf' },
    orderBy: { created_at: 'desc' },
  });

  // --- 1. 本文 PDF → 頁数 → 可否判定 ---
  const interiorKey = pdfArtifact?.r2_key ?? manuscriptPdfKey(bookId);
  const interior = await fetchAsset(interiorKey);
  if (!interior) {
    return fail('no_manuscript', `本文 PDF が R2 にありません (${interiorKey})`, PLAN_NG_COOLDOWN_HOURS);
  }
  const pages = await countPdfPages(interior);
  const plan = computePaperbackPlan(pages);
  log.info({ bookId, pages, plan }, 'paperback plan');
  if (!plan.ready) {
    return fail('plan_ng', plan.reason ?? 'plan not ready', PLAN_NG_COOLDOWN_HOURS);
  }

  // --- 2. ラップカバー PDF (無ければ作る) ---
  const coverKey = paperbackCoverKey(bookId);
  let coverPdf = await fetchAsset(coverKey);
  const meta = await prisma.kdpMetadata.findFirst({ where: { book_id: bookId }, orderBy: { created_at: 'desc' } });
  if (!coverPdf) {
    const coverImage = await fetchAsset(coverRow.r2_key);
    if (!coverImage) {
      return fail('no_cover_image', `表紙画像が R2 にありません (${coverRow.r2_key})`, PLAN_NG_COOLDOWN_HOURS);
    }
    const sharp = (await import('sharp')).default;
    const stats = await sharp(coverImage).stats();
    const [r, g, b] = stats.channels.map((ch) => Math.round(ch.mean));
    const safe = safeAreaPixels();
    const frontImagePng = await sharp(coverImage)
      .resize(safe.width, safe.height, { fit: 'contain', kernel: 'lanczos3', background: { r: r!, g: g!, b: b! } })
      .png()
      .toBuffer();
    coverPdf = await buildPaperbackWrapCover({
      title: book.title,
      subtitle: book.subtitle,
      description: meta?.description ?? null,
      pages,
      coverImage,
      frontImagePng,
      averageColor: { r: r!, g: g!, b: b! },
    });
    await putAsset(coverKey, coverPdf, 'application/pdf');
    log.info({ bookId, coverKey, bytes: coverPdf.length }, 'paperback wrap cover built');
  }

  // --- 3. KDP で下書きを作る ---
  // セッションは `accounts.kdp_session_state_enc` が正 (kdp.submit と同じ)。
  // `kdp_credentials_enc` は別物で、ここを読むと**未ログイン状態で KDP に入ってしまう**
  // (2026-09-29 に実際にそれで `reauth_failed` になった)。
  const account = await prisma.account.findFirst({ where: { kdp_session_state_enc: { not: null } } });
  if (!account?.kdp_session_state_enc) {
    return fail('no_session', 'KDP セッション (kdp_session_state_enc) が保存されていません', FAILURE_COOLDOWN_HOURS);
  }
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  let sessionState: string;
  try {
    sessionState = decryptSession(account.kdp_session_state_enc);
  } catch (err) {
    return fail('session_decrypt_failed', err instanceof Error ? err.message : String(err), FAILURE_COOLDOWN_HOURS);
  }
  let totpSecret: string | null = null;
  if (account.kdp_2fa_secret_enc) {
    try {
      totpSecret = decryptSession(account.kdp_2fa_secret_enc);
    } catch {
      totpSecret = null;
    }
  }
  const { buildOtpProvider } = await import('./kdp-submit/totp.js');
  const otp = buildOtpProvider({
    prisma: prisma as never,
    totpSecret,
    purpose: 'paperback_draft_relogin',
  });

  const stageDir = mkdtempSync(path.join(tmpdir(), 'pb-draft-'));
  const interiorPath = path.join(stageDir, `${bookId}-interior.pdf`);
  const coverPath = path.join(stageDir, `${bookId}-cover.pdf`);
  writeFileSync(interiorPath, interior);
  writeFileSync(coverPath, coverPdf);

  let result: PaperbackDraftResult;
  try {
    result = await deps.port.createDraft({
      bookId,
      asin: book.asin,
      categoryPaths: readCategoryPaths(meta?.categories),
      interiorPath,
      coverPath,
      sessionState,
      email: env.AMAZON_EMAIL ?? null,
      password: env.AMAZON_PASSWORD ?? '',
      otp,
    });
  } catch (err) {
    return fail('error', err instanceof Error ? err.message : String(err), FAILURE_COOLDOWN_HOURS);
  }

  if (!result.ok) {
    const hours = result.reason === 'creation_limit' ? CREATION_LIMIT_COOLDOWN_HOURS : FAILURE_COOLDOWN_HOURS;
    return fail(result.reason, result.message, hours);
  }

  // --- 4. DB へ書き戻す ---
  await prisma.book.update({
    where: { id: bookId },
    data: {
      pb_publish_status: 'drafted',
      pb_title_id: result.titleId,
      pb_drafted_at: now(),
      pb_last_error: null,
      pb_submit_cooldown_until: null,
    },
  });
  log.info({ bookId, titleId: result.titleId, pages, isbn: result.isbn }, 'paperback.draft 完了');
  return { ok: true, status: 'drafted', titleId: result.titleId, pages };
}

async function defaultFetchAsset(): Promise<(key: string) => Promise<Buffer | null>> {
  const mod = await import('@a2p/storage');
  return async (key: string) => {
    try {
      return (await mod.downloadBuffer(key)) as Buffer | null;
    } catch {
      return null;
    }
  };
}

async function defaultPutAsset(): Promise<(key: string, buf: Buffer, contentType: string) => Promise<unknown>> {
  const mod = await import('@a2p/storage');
  return (key, buf, contentType) => mod.uploadBuffer(key, buf, contentType);
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------

export const paperbackDraftTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  const { createPlaywrightPaperbackDraftPort } = await import(
    './paperback-draft/playwright-paperback-draft-port.js'
  );
  await runPaperbackDraft(payload, { port: createPlaywrightPaperbackDraftPort() });
};
