/**
 * `paperback.submit` タスク (F-097d) — **サーバー側 (Railway) でのペーパーバック出版**。
 *
 * 運営者要望 (2026-09-25)「ペーパーバックの出版もローカルからじゃなくて Railway からできないの？」。
 * それまで `scripts/paperback/pb-complete.mjs` をローカル実行するしかなく、実行端末のメモリ不足で
 * バッチが全滅する等、運営者の PC 状態に出版が左右されていた。`kdp.submit` と同じく
 * 保存済みセッション + パスワード/TOTP 再認証でサーバーから実行する。
 *
 * 対象: `books.pb_publish_status='drafted'` かつ `pb_title_id` がある本 (= KDP 側に下書きが存在)。
 * **下書きの完成は KDP の作成数枠を消費しない**ので、作成上限に当たっていても出版できる。
 * 新規下書きの作成 (pb-pilot 相当) は引き続きローカル (`pb-auto.sh draft`)。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { paperbackPrice } from './paperback-submit/paperback-price.js';
import type { PaperbackPublishPort } from './paperback-submit/playwright-paperback-port.js';

export const PAPERBACK_SUBMIT_TASK_NAME = 'paperback.submit';

export const PaperbackSubmitPayloadSchema = z.object({
  book_id: z.string().min(1),
  dry_run: z.boolean().optional(),
});
export type PaperbackSubmitPayload = z.infer<typeof PaperbackSubmitPayloadSchema>;

/** 失敗理由ごとのクールダウン (時間)。原稿変換待ちは短く、構造的な失敗は長く。 */
const COOLDOWN_HOURS: Record<string, number> = {
  blocked_prior_page: 6,
  not_approved: 6,
  no_previewer: 24,
  no_price_field: 24,
  reauth_failed: 3,
  uncertain: 6,
  error: 6,
};

export interface PaperbackSubmitDeps {
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  port?: PaperbackPublishPort;
  decryptSession?: (enc: string) => string;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export interface PaperbackSubmitResult {
  ok: boolean;
  status: string;
  bookId: string;
}

export async function runPaperbackSubmit(
  payload: unknown,
  deps: PaperbackSubmitDeps = {},
): Promise<PaperbackSubmitResult> {
  const parsed = PaperbackSubmitPayloadSchema.parse(payload ?? {});
  const prisma = deps.prisma ?? defaultPrisma;
  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_SUBMIT_TASK_NAME}`);
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;
  const decrypt = deps.decryptSession ?? ((enc: string) => decryptKdpCredentials(enc));

  const book = await prisma.book.findUnique({
    where: { id: parsed.book_id },
    select: { id: true, title: true, subtitle: true, pb_title_id: true, pb_publish_status: true },
  });
  if (!book) return { ok: false, status: 'not_found', bookId: parsed.book_id };
  if (!book.pb_title_id) {
    log.warn({ bookId: book.id }, 'pb_title_id 未設定 — ローカルで下書き作成が必要');
    return { ok: false, status: 'no_title_id', bookId: book.id };
  }
  if (book.pb_publish_status === 'published') {
    return { ok: true, status: 'already_published', bookId: book.id };
  }

  const account = await prisma.account.findFirst({
    where: { status: 'active' },
    orderBy: { created_at: 'asc' },
    select: { id: true, kdp_session_state_enc: true },
  });
  if (!account?.kdp_session_state_enc) {
    log.warn({ bookId: book.id }, 'KDP セッション未保存 — skip');
    return { ok: false, status: 'no_session', bookId: book.id };
  }
  const password = env.AMAZON_PASSWORD ?? '';
  if (!password) {
    log.warn({ bookId: book.id }, 'AMAZON_PASSWORD 未設定 — 再認証できないので skip');
    return { ok: false, status: 'no_creds', bookId: book.id };
  }

  let sessionState: string;
  try {
    sessionState = decrypt(account.kdp_session_state_enc);
  } catch (err) {
    log.warn({ bookId: book.id, err }, 'KDP セッション復号失敗');
    return { ok: false, status: 'session_decrypt_failed', bookId: book.id };
  }

  const port: PaperbackPublishPort =
    deps.port ??
    (await import('./paperback-submit/playwright-paperback-port.js').then((m) =>
      m.createPlaywrightPaperbackPort(),
    ));
  const stageDir = mkdtempSync(path.join(tmpdir(), 'pb-submit-'));

  // [F-097g] 正しいラップカバーを用意して渡す。プレビューが表紙サイズ不適合を出したら
  // ポート側がこれに差し替えて再プレビューする (古い下書きには Kindle 用 A4 表紙が
  // 上がっていて、承認ボタンが無効のままだった — 2026-09-29 実測)。
  let coverPath: string | null = null;
  // [F-097h] KDP が数えた頁数で表紙を作り直すためのコールバック。
  let buildCoverForPages: ((pages: number) => Promise<string | null>) | undefined;
  let interiorPath: string | null = null;
  try {
    const { ensurePaperbackCover } = await import('./paperback-draft/build-cover.js');
    const { countPdfPages } = await import('./paperback-draft/plan.js');
    const storage = await import('@a2p/storage');
    const fetchAsset = async (key: string): Promise<Buffer | null> => {
      try {
        return (await storage.downloadBuffer(key)) as Buffer | null;
      } catch {
        return null;
      }
    };
    const coverRow = await prisma.cover.findFirst({
      where: { book_id: book.id, status: 'adopted' },
      orderBy: { created_at: 'desc' },
      select: { r2_key: true },
    });
    const pdfArtifact = await prisma.artifact.findFirst({
      where: { book_id: book.id, kind: 'pdf' },
      orderBy: { created_at: 'desc' },
      select: { r2_key: true },
    });
    const interior = pdfArtifact?.r2_key ? await fetchAsset(pdfArtifact.r2_key) : null;
    log.info(
      {
        bookId: book.id,
        coverKey: coverRow?.r2_key ?? null,
        pdfKey: pdfArtifact?.r2_key ?? null,
        interiorBytes: interior?.length ?? 0,
      },
      'paperback 表紙生成の入力',
    );
    if (coverRow?.r2_key && interior) {
      const meta = await prisma.kdpMetadata.findFirst({
        where: { book_id: book.id },
        orderBy: { created_at: 'desc' },
        select: { description: true },
      });
      const pages = await countPdfPages(interior);
      const cover = await ensurePaperbackCover({
        bookId: book.id,
        title: book.title,
        subtitle: book.subtitle,
        description: meta?.description ?? null,
        pages,
        coverImageKey: coverRow.r2_key,
        fetchAsset,
        putAsset: (key, buf, ct) => storage.uploadBuffer(key, buf, ct),
        // 下書き時と頁数が変わっていることがあるので必ず作り直す (背幅がずれると弾かれる)。
        force: true,
      });
      if (cover.ok) {
        coverPath = path.join(stageDir, `${book.id}-pb-cover.pdf`);
        writeFileSync(coverPath, cover.pdf);
        log.info({ bookId: book.id, pages, bytes: cover.pdf.length }, 'paperback wrap cover ready (差し替え用)');
      }
      // KDP 変換後の頁数は手元の PDF と一致しないため、プレビューが報告した頁数で組み直す。
      // [F-097j] 余白を広げたペーパーバック用の本文も用意する。
      try {
        const { ensurePaperbackInterior } = await import('./paperback-draft/build-interior.js');
        const chapters = await prisma.chapter.findMany({
          where: { book_id: book.id },
          select: { index: true, heading: true, body_md: true },
          orderBy: { index: 'asc' },
        });
        const built = await ensurePaperbackInterior({
          bookId: book.id,
          title: book.title,
          subtitle: book.subtitle,
          chapters,
          fetchAsset,
          putAsset: (key, buf, ct) => storage.uploadBuffer(key, buf, ct),
        });
        if (built.ok) {
          interiorPath = path.join(stageDir, `${book.id}-pb-interior.pdf`);
          writeFileSync(interiorPath, built.pdf);
          log.info(
            { bookId: book.id, bytes: built.pdf.length, rebuilt: built.rebuilt },
            'paperback 本文 (余白広め) 準備完了',
          );
        } else {
          log.warn({ bookId: book.id, reason: built.reason }, 'ペーパーバック用本文を組めませんでした');
        }
      } catch (err) {
        log.warn(
          { bookId: book.id, err: err instanceof Error ? err.message : String(err) },
          'ペーパーバック用本文の生成に失敗 — 差し替えなしで続行',
        );
      }

      buildCoverForPages = async (kdpPages: number): Promise<string | null> => {
        const rebuilt = await ensurePaperbackCover({
          bookId: book.id,
          title: book.title,
          subtitle: book.subtitle,
          description: meta?.description ?? null,
          pages: kdpPages,
          coverImageKey: coverRow.r2_key!,
          fetchAsset,
          putAsset: (key, buf, ct) => storage.uploadBuffer(key, buf, ct),
          force: true,
        });
        if (!rebuilt.ok) return null;
        const out = path.join(stageDir, `${book.id}-pb-cover-${String(kdpPages)}p.pdf`);
        writeFileSync(out, rebuilt.pdf);
        log.info({ bookId: book.id, kdpPages, bytes: rebuilt.pdf.length }, 'paperback wrap cover rebuilt (KDP 頁数)');
        return out;
      };
    }
  } catch (err) {
    log.warn({ bookId: book.id, err: err instanceof Error ? err.message : String(err) }, '表紙の事前生成に失敗 — 差し替えなしで続行');
  }

  const result = await port.publishDraft({
    titleId: book.pb_title_id,
    sessionState,
    password,
    totpSecret: env.AMAZON_TOTP_SECRET ?? null,
    dryRun: parsed.dry_run === true,
    priceFor: paperbackPrice,
    stageDir,
    coverPath,
    buildCoverForPages,
    interiorPath,
  });

  if (result.ok && result.status === 'submitted') {
    await prisma.book.update({
      where: { id: book.id },
      data: {
        pb_publish_status: 'submitted',
        pb_submitted_at: now(),
        pb_publish_queued: false,
        pb_last_error: null,
        pb_submit_cooldown_until: null,
      },
    });
    log.info({ bookId: book.id, pages: result.pages, priceJpy: result.priceJpy }, 'paperback submitted');
    return { ok: true, status: 'submitted', bookId: book.id };
  }

  if (result.ok) {
    log.info({ bookId: book.id, pages: result.pages, priceJpy: result.priceJpy }, 'paperback dry-run ready');
    return { ok: true, status: result.status, bookId: book.id };
  }

  const hours = COOLDOWN_HOURS[result.reason] ?? 6;
  await prisma.book.update({
    where: { id: book.id },
    data: {
      pb_last_error: `${result.reason}: ${result.message}`.slice(0, 500),
      pb_submit_cooldown_until: new Date(now().getTime() + hours * 60 * 60 * 1000),
    },
  });
  log.warn({ bookId: book.id, reason: result.reason, message: result.message }, 'paperback submit failed');
  return { ok: false, status: result.reason, bookId: book.id };
}

export const paperbackSubmitTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPaperbackSubmit(payload);
};
