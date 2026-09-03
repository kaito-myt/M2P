/**
 * `bw.submit` (F-094) — サーバー側 BOOK☆WALKER 自動入稿。
 *
 * DB の章 Markdown から EPUB3 (販売用+試し読み) をその場で生成し、R2 の採用表紙を
 * 高さ 1600px JPG に変換して、著者センター https://author.bookwalker.jp/books/new へ
 * 「販売を申請する」まで実行する。セッションは `app_settings.bw_session_state_enc`
 * (ローカルで手動ログイン→ scripts/bookwalker/bw-session-push.mjs で保存) を再利用。
 * ログインは reCAPTCHA によりサーバーから不可のため、失効時は LINE 通知して停止する。
 *
 * DI 境界: `BwSubmitPort` を注入して実ブラウザなしで単体テスト可能。
 * 詳細: docs/05 §5.3.15c / docs/02 F-094。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Task } from 'graphile-worker';
import sharp from 'sharp';
import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials, encryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';
import { downloadBuffer } from '@a2p/storage';

import { pushLine } from './lib/line-auth-relay.js';
import { buildEpub, type BwEpubChapter } from './bw-submit/build-epub.js';
import type { BwBookInput, BwSubmitPort, BwSubmitResult } from './bw-submit/playwright-submit-port.js';

export const BW_SUBMIT_TASK_NAME = 'bw.submit';

/** 著者ペンネームが無い場合の既定著者 (運営者名義)。 */
const DEFAULT_AUTHOR = '宮田海斗';
const DEFAULT_AUTHOR_KANA = 'ミヤタカイト';

export const BwSubmitPayload = z.object({
  book_id: z.string(),
  dry_run: z.boolean().optional(),
});
export type BwSubmitPayload = z.infer<typeof BwSubmitPayload>;

/** 入稿対象の DB 行 (raw query 結果)。 */
interface BwBookRow {
  id: string;
  title: string;
  subtitle: string | null;
  bw_publish_status: string;
  genre: string | null;
  pen_name: string | null;
  description: string | null;
  keywords: string[] | null;
  price_jpy: number | null;
  title_kana: string | null;
  cover_key: string | null;
}

export interface BwSubmitDeps {
  payload: BwSubmitPayload;
  submitPort: BwSubmitPort;
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  /** R2 から key を取得 (テスト差替)。既定は @a2p/storage.downloadBuffer。 */
  fetchAsset?: (key: string) => Promise<Buffer | null>;
  /** 表紙 JPG 変換 (テスト差替)。既定は sharp で高さ 1600px JPEG 化。 */
  toCoverJpg?: (src: Buffer) => Promise<Buffer>;
}

export interface BwSubmitTaskResult {
  ok: boolean;
  status: string;
  reason?: string;
}

async function defaultToCoverJpg(src: Buffer): Promise<Buffer> {
  // BW 推奨: 縦 1600px 以上の JPG。採用表紙 (1024x1536 PNG) を高さ 1600px に拡大して JPEG 化。
  return sharp(src).resize({ height: 1600, fit: 'inside', kernel: 'lanczos3' }).jpeg({ quality: 90 }).toBuffer();
}

export async function runBwSubmit(deps: BwSubmitDeps): Promise<BwSubmitTaskResult> {
  const log = deps.logger ?? createLogger(`worker.${BW_SUBMIT_TASK_NAME}`);
  const prisma = deps.prisma ?? defaultPrisma;
  const fetchAsset = deps.fetchAsset ?? ((key: string) => downloadBuffer(key));
  const toCoverJpg = deps.toCoverJpg ?? defaultToCoverJpg;
  const { book_id, dry_run } = deps.payload;

  // 1. セッション (単一アカウント運用のため AppSettings 保持)。
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { bw_session_state_enc: true },
  });
  if (!settings?.bw_session_state_enc) {
    log.warn('bw_session_state_enc 未設定 — ローカルで bw-session-push.mjs を実行してください');
    return { ok: false, status: 'no_session', reason: 'no_session' };
  }
  let sessionState: string;
  try {
    sessionState = decryptKdpCredentials(settings.bw_session_state_enc);
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'BW session 復号失敗');
    return { ok: false, status: 'session_decrypt_failed', reason: 'error' };
  }

  // 2. 対象書籍 + メタ + 採用表紙キー。
  const rows = await prisma.$queryRawUnsafe<BwBookRow[]>(
    `SELECT b.id, b.title, b.subtitle, b.bw_publish_status, tc.genre, acc.pen_name,
        km.description, km.keywords, km.price_jpy, km.title_kana,
        (SELECT cv.r2_key FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted' ORDER BY cv.created_at DESC LIMIT 1) AS cover_key
     FROM books b
     LEFT JOIN accounts acc ON acc.id=b.account_id
     LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
     LEFT JOIN kdp_metadata km ON km.book_id=b.id
     WHERE b.id=$1 LIMIT 1`,
    book_id,
  );
  const row = rows[0];
  if (!row) return { ok: false, status: 'not_found', reason: 'not_found' };
  // 二重申請防止: 既に申請済み/販売中なら何もしない (dispatcher でも除外するが最終防衛線)。
  if (row.bw_publish_status === 'submitted' || row.bw_publish_status === 'published') {
    log.info({ book_id, bw_publish_status: row.bw_publish_status }, '既に申請済み — skip');
    return { ok: false, status: 'already_submitted', reason: 'already_submitted' };
  }
  if (!row.cover_key) {
    log.warn({ book_id }, '採用表紙なし — skip');
    return { ok: false, status: 'skip_no_assets', reason: 'skip_no_assets' };
  }

  // 3. 章を取得して EPUB (販売用+試し読み) を生成、表紙を JPG 化。
  const chapters = await prisma.$queryRawUnsafe<BwEpubChapter[]>(
    `SELECT index, heading, body_md FROM chapters WHERE book_id=$1 ORDER BY index`,
    book_id,
  );
  if (chapters.length === 0) {
    log.warn({ book_id }, '章なし — skip');
    return { ok: false, status: 'skip_no_assets', reason: 'skip_no_assets' };
  }
  const stageDir = mkdtempSync(path.join(tmpdir(), 'bw-submit-'));
  const coverJpgPath = path.join(stageDir, `${book_id}-cover.jpg`);
  const epubPath = path.join(stageDir, `${book_id}.epub`);
  const trialEpubPath = path.join(stageDir, `${book_id}-trial.epub`);
  const author = row.pen_name || DEFAULT_AUTHOR;
  try {
    const coverSrc = await fetchAsset(row.cover_key);
    if (!coverSrc) throw new Error(`R2 cover not found: ${row.cover_key}`);
    const coverJpg = await toCoverJpg(coverSrc);
    const base = {
      title: row.title,
      subtitle: row.subtitle,
      author,
      description: row.description,
      chapters,
      coverJpg,
    };
    writeFileSync(coverJpgPath, coverJpg);
    writeFileSync(epubPath, await buildEpub(base));
    writeFileSync(trialEpubPath, await buildEpub({ ...base, trial: true }));
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'EPUB/表紙生成失敗');
    return { ok: false, status: 'asset_build_failed', reason: 'error' };
  }

  // 4. 入稿実行。BW は税抜き価格 — Kindle 税込価格から概算 (無ければ ¥500)。
  const priceNoTax = row.price_jpy ? Math.round(row.price_jpy / 1.1 / 10) * 10 : 500;
  const book: BwBookInput = {
    id: row.id,
    title: row.title,
    title_kana: row.title_kana,
    subtitle: row.subtitle,
    genre: row.genre,
    description: row.description,
    keywords: row.keywords,
    price_notax: priceNoTax,
    author,
    author_kana: DEFAULT_AUTHOR_KANA,
    coverJpgPath,
    epubPath,
    trialEpubPath,
  };
  log.info({ book_id, title: row.title, dry_run: !!dry_run, priceNoTax }, 'bw.submit start');
  let result: BwSubmitResult;
  try {
    result = await deps.submitPort.submitOne({ book, sessionState, dryRun: dry_run, stageDir });
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'submitOne threw');
    return { ok: false, status: 'error', reason: 'error' };
  }

  // 5. 新しい storageState があれば書き戻す (セッション延命)。
  if (result.storageState) {
    await prisma.appSettings
      .update({
        where: { id: 'singleton' },
        data: { bw_session_state_enc: encryptKdpCredentials(result.storageState) },
      })
      .catch((err) => log.warn({ err: errMsg(err) }, 'refreshed BW session 書き戻し失敗(無視)'));
  }

  if (result.ok) {
    if (result.status === 'submitted') {
      await prisma.book.update({
        where: { id: book_id },
        data: {
          bw_publish_status: 'submitted',
          bw_publish_queued: false,
          bw_submitted_at: new Date(),
        },
      });
      log.info({ book_id }, 'bw.submit done — 申請済み(審査待ち)');
      await pushLine(`✅ A2P: 「${row.title}」をBOOK☆WALKERに申請しました(審査待ち)`).catch(() => {});
      return { ok: true, status: 'submitted' };
    }
    log.info({ book_id }, 'bw.submit dry-run: 下書き保存まで到達');
    return { ok: true, status: 'dry_run_ready' };
  }

  // 失敗系: セッション失効は自動運用を止めて LINE 通知、それ以外は ~6h クールダウンで再試行。
  // (キー名 message は pino の予約と衝突して出力から落ちるため fail_message にする)
  log.warn({ book_id, reason: result.reason, fail_message: result.message }, 'bw.submit failed');
  if (result.reason === 'not_logged_in') {
    await prisma.appSettings
      .update({ where: { id: 'singleton' }, data: { bw_auto_submit_enabled: false } })
      .catch(() => {});
    await pushLine(
      '⚠️ A2P: BOOK☆WALKERのセッションが失効しました。ローカルで手動ログイン後 bw-session-push.mjs を実行してください(自動入稿は一時停止)。',
    ).catch(() => {});
  } else {
    const cooldownUntil = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await prisma.book
      .update({
        where: { id: book_id },
        data: { bw_submit_cooldown_until: cooldownUntil, bw_publish_status: 'failed' },
      })
      .catch((err) => log.warn({ err: errMsg(err) }, 'BW クールダウン設定失敗(無視)'));
    await pushLine(`⚠️ A2P: 「${row.title}」のBOOK☆WALKER申請に失敗 (${result.reason})`).catch(() => {});
  }
  return { ok: false, status: result.reason, reason: result.reason };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------
import { createPlaywrightBwSubmitPort } from './bw-submit/playwright-submit-port.js';

export const bwSubmitTask: Task = async (payload: unknown) => {
  const parsed = BwSubmitPayload.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid bw.submit payload: ${parsed.error.message}`);
  }
  await runBwSubmit({ payload: parsed.data, submitPort: createPlaywrightBwSubmitPort() });
};
