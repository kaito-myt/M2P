/**
 * `kdp.submit` (F-041, Phase 3) — サーバー側 KDP 自動入稿。
 *
 * 既存下書きを resume して上書き入稿する（作成上限を消費しない）。セッションは
 * `accounts.kdp_session_state_enc` を再利用し、再認証は password 実タイプ＋OTP
 * (TOTP 自動生成 or LINE リレー) で通す。原稿/表紙は R2 から取得。IP は既定
 * データセンター(proxy 有効時のみ住宅IP)。詳細: docs/05 §5.3.15 / docs/02 F-041。
 *
 * DI 境界: `KdpPublishPort` を注入して実ブラウザなしで単体テスト可能。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Task } from 'graphile-worker';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials, encryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';
import { downloadBuffer } from '@a2p/storage';

import { isLineRelayConfigured, pushLine, type LineAuthRelayPrisma } from './lib/line-auth-relay.js';
import { resolveKdpProxy, type KdpProxyConfig, type KdpProxyPrisma } from './sales-fetch/kdp-proxy.js';
import type { KdpBookInput, KdpPublishPort, KdpPublishResult } from './kdp-submit/playwright-publish-port.js';
import { buildOtpProvider } from './kdp-submit/totp.js';

export const KDP_SUBMIT_TASK_NAME = 'kdp.submit';

export const KdpSubmitPayload = z.object({
  book_id: z.string(),
  dry_run: z.boolean().optional(),
  account_id: z.string().optional(),
});
export type KdpSubmitPayload = z.infer<typeof KdpSubmitPayload>;

/** 入稿対象の DB 行(raw query 結果)。 */
interface BookRow {
  id: string;
  title: string;
  subtitle: string | null;
  account_id: string | null;
  pen_name: string | null;
  description: string | null;
  categories: string[] | null;
  keywords: string[] | null;
  price_jpy: number | null;
  title_kana: string | null;
  title_romaji: string | null;
  subtitle_kana: string | null;
  subtitle_romaji: string | null;
  author_kana: string | null;
  author_romaji: string | null;
  cover_key: string | null;
  docx_key: string | null;
  kdp_session_state_enc: string | null;
  kdp_2fa_secret_enc: string | null;
}

export interface KdpSubmitDeps {
  payload: KdpSubmitPayload;
  publishPort: KdpPublishPort;
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  /** R2 から key をローカル tmp に取得(テスト差替)。既定は @a2p/storage.downloadBuffer。 */
  fetchAsset?: (key: string) => Promise<Buffer | null>;
  proxy?: KdpProxyConfig | null;
}

export interface KdpSubmitResult {
  ok: boolean;
  status: string;
  reason?: string;
  asin?: string | null;
}

export async function runKdpSubmit(deps: KdpSubmitDeps): Promise<KdpSubmitResult> {
  const log = deps.logger ?? createLogger(`worker.${KDP_SUBMIT_TASK_NAME}`);
  const prisma = deps.prisma ?? defaultPrisma;
  const fetchAsset = deps.fetchAsset ?? ((key: string) => downloadBuffer(key));
  const { book_id, dry_run } = deps.payload;

  const email = process.env.AMAZON_EMAIL;
  const password = process.env.AMAZON_PASSWORD;
  if (!email || !password) {
    log.warn('AMAZON_EMAIL/AMAZON_PASSWORD 未設定 — kdp.submit を実行しません');
    return { ok: false, status: 'no_creds', reason: 'no_creds' };
  }

  // 1. 対象書籍 + メタ + アカウント(セッション/2FAシークレット) + 資産キーを取得。
  const rows = await prisma.$queryRawUnsafe<BookRow[]>(
    `SELECT b.id, b.title, b.subtitle, b.account_id, acc.pen_name,
        km.description, km.categories, km.keywords, km.price_jpy,
        km.title_kana, km.title_romaji, km.subtitle_kana, km.subtitle_romaji,
        km.author_kana, km.author_romaji,
        acc.kdp_session_state_enc, acc.kdp_2fa_secret_enc,
        (SELECT r2_key FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted' ORDER BY cv.created_at DESC LIMIT 1) AS cover_key,
        (SELECT r2_key FROM artifacts a WHERE a.book_id=b.id AND a.kind='docx' ORDER BY a.created_at DESC LIMIT 1) AS docx_key
     FROM books b
     LEFT JOIN accounts acc ON acc.id=b.account_id
     LEFT JOIN kdp_metadata km ON km.book_id=b.id
     WHERE b.id=$1 LIMIT 1`,
    book_id,
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 'not_found', reason: 'not_found' };
  if (!row.cover_key || !row.docx_key) {
    log.warn({ book_id, cover: !!row.cover_key, docx: !!row.docx_key }, '資産不足(cover/docx) — skip');
    return { ok: false, status: 'skip_no_assets', reason: 'skip_no_assets' };
  }
  if (!row.kdp_session_state_enc) {
    return { ok: false, status: 'no_session', reason: 'no_session' };
  }

  // 2. セッション復号。
  let sessionState: string;
  try {
    sessionState = decryptKdpCredentials(row.kdp_session_state_enc);
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'session 復号失敗');
    return { ok: false, status: 'session_decrypt_failed', reason: 'error' };
  }
  let totpSecret: string | null = null;
  if (row.kdp_2fa_secret_enc) {
    try {
      totpSecret = decryptKdpCredentials(row.kdp_2fa_secret_enc);
    } catch {
      totpSecret = null;
    }
  }

  // 3. 資産を tmp に取得。
  const stageDir = mkdtempSync(path.join(tmpdir(), 'kdp-submit-'));
  const docxPath = path.join(stageDir, `${book_id}.docx`);
  const coverPath = path.join(stageDir, `${book_id}-cover.jpg`);
  try {
    const docxBuf = await fetchAsset(row.docx_key);
    const coverBuf = await fetchAsset(row.cover_key);
    if (!docxBuf || !coverBuf) throw new Error('R2 asset not found (docx/cover)');
    writeFileSync(docxPath, docxBuf);
    writeFileSync(coverPath, coverBuf);
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'R2 資産取得失敗');
    return { ok: false, status: 'asset_fetch_failed', reason: 'error' };
  }

  // 4. OTP プロバイダ (TOTP 自動 or LINE リレー)。
  const otp = buildOtpProvider({
    prisma: prisma as unknown as LineAuthRelayPrisma,
    totpSecret,
    purpose: 'kdp_submit_relogin',
  });
  if (otp.kind === 'line' && !isLineRelayConfigured()) {
    log.warn('TOTP 未設定かつ LINE リレー未設定 — 再認証が必要になると失敗します');
  }

  // 5. proxy 解決 (既定はデータセンターIP直結。app_settings で有効時のみ住宅IP)。
  const proxy =
    deps.proxy !== undefined
      ? deps.proxy ?? undefined
      : (await resolveKdpProxy(prisma as unknown as KdpProxyPrisma)) ?? undefined;

  const book: KdpBookInput = {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    title_kana: row.title_kana,
    title_romaji: row.title_romaji,
    subtitle_kana: row.subtitle_kana,
    subtitle_romaji: row.subtitle_romaji,
    pen_name: row.pen_name,
    author_kana: row.author_kana,
    author_romaji: row.author_romaji,
    keywords: row.keywords,
    description: row.description,
    categories: row.categories,
    price_jpy: row.price_jpy,
    docxPath,
    coverPath,
  };

  log.info({ book_id, title: row.title, dry_run: !!dry_run, otp: otp.kind, proxy: !!proxy }, 'kdp.submit start');
  let result: KdpPublishResult;
  try {
    result = await deps.publishPort.publishOne({
      book,
      sessionState,
      proxy,
      otp,
      amazonEmail: email,
      amazonPassword: password,
      dryRun: dry_run,
      stageDir,
    });
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'publishOne threw');
    return { ok: false, status: 'error', reason: 'error' };
  }

  // 6. 新しい storageState があれば書き戻す(セッション延命)。
  const freshState = result.storageState;
  if (freshState && row.account_id) {
    try {
      await prisma.account.update({
        where: { id: row.account_id },
        data: { kdp_session_state_enc: encryptKdpCredentials(freshState) },
      });
    } catch (err) {
      log.warn({ err: errMsg(err) }, 'refreshed session 書き戻し失敗(無視)');
    }
  }

  if (result.ok) {
    if (result.status === 'submitted') {
      await prisma.book.update({
        where: { id: book_id },
        data: {
          publish_status: 'submitted',
          kdp_publish_queued: false,
          ...(result.asin ? { asin: result.asin } : {}),
        },
      });
      log.info({ book_id, asin: result.asin }, 'kdp.submit done — published/submitted');
      await pushLine(`✅ A2P: 「${row.title}」をKDPに出版しました${result.asin ? ` (ASIN ${result.asin})` : ''}`).catch(() => {});
      return { ok: true, status: 'submitted', asin: result.asin };
    }
    log.info({ book_id }, 'kdp.submit dry-run: 出版直前まで到達');
    return { ok: true, status: 'dry_run_ready' };
  }

  // 失敗系。creation_limit / no_draft は保留(翌日再試行/下書き用意待ち)、その他は要調査通知。
  log.warn({ book_id, reason: result.reason, message: result.message }, 'kdp.submit failed');
  if (result.reason !== 'creation_limit' && result.reason !== 'no_draft') {
    await pushLine(`⚠️ A2P: 「${row.title}」のKDP自動入稿に失敗 (${result.reason}). スクショ確認要。`).catch(() => {});
  }
  return { ok: false, status: result.reason, reason: result.reason };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------
import { createPlaywrightPublishPort } from './kdp-submit/playwright-publish-port.js';

export const kdpSubmitTask: Task = async (payload: unknown) => {
  const parsed = KdpSubmitPayload.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid kdp.submit payload: ${parsed.error.message}`);
  }
  await runKdpSubmit({ payload: parsed.data, publishPort: createPlaywrightPublishPort() });
};
