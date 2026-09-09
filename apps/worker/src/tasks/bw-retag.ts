/**
 * `bw.retag.tick` (F-094b) — 却下(AI生成タグ欠落・内容紹介途切れ)書籍の自動再申請。
 *
 * 日次 cron。`AppSettings.bw_retag_enabled=true` かつ BW セッション保存済のとき、
 * 著者センター本棚を走査して**却下**書籍を拾い、編集導線で
 *   ①「AI生成」サブカテゴリ付与 ②内容紹介を文末で整形 ③クリーンEPUB(本文からAI開示文除去済)再アップ ④再申請
 * を行う。BW は AI 作品の申請を「月3作品」に制限(faq/9999)するため、`register` が 403 を返したら
 * その tick は打ち切る(rate_limited)。却下→申請中に遷移すると次回は拾われない(進捗テーブル不要)。
 *
 * 申請中の未タグ書籍は BW 審査で順次却下される想定で、却下になった時点でこの tick が再申請する。
 * DI 境界: `BwSubmitPort`(enumerateShelf/retagOne) を注入してテスト可能。詳細: docs/05 §5.3.15c。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Task } from 'graphile-worker';
import sharp from 'sharp';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials, encryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';
import { downloadBuffer } from '@a2p/storage';

import { pushLine } from './lib/line-auth-relay.js';
import { buildEpub, type BwEpubChapter } from './bw-submit/build-epub.js';
import type { BwBookInput, BwShelfEntry, BwSubmitPort } from './bw-submit/playwright-submit-port.js';

export const BW_RETAG_TASK_NAME = 'bw.retag.tick';

const DEFAULT_AUTHOR = '宮田海斗';
const DEFAULT_AUTHOR_KANA = 'ミヤタカイト';
/** 1 tick で試みる却下書籍の最大件数(BWの月3制限で通常はもっと早く 403 で止まる)。 */
const MAX_PER_TICK = 3;

interface BwBookRow {
  id: string;
  title: string;
  subtitle: string | null;
  genre: string | null;
  pen_name: string | null;
  description: string | null;
  keywords: string[] | null;
  price_jpy: number | null;
  title_kana: string | null;
  cover_key: string | null;
}

export interface BwRetagDeps {
  submitPort: BwSubmitPort;
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  fetchAsset?: (key: string) => Promise<Buffer | null>;
  toCoverJpg?: (src: Buffer) => Promise<Buffer>;
}

export interface BwRetagTickResult {
  enabled: boolean;
  reapplied: number;
  rateLimited: boolean;
  attempted: number;
}

async function defaultToCoverJpg(src: Buffer): Promise<Buffer> {
  return sharp(src).resize({ height: 1600, fit: 'inside', kernel: 'lanczos3' }).jpeg({ quality: 90 }).toBuffer();
}

export async function runBwRetagTick(deps: BwRetagDeps): Promise<BwRetagTickResult> {
  const log = deps.logger ?? createLogger(`worker.${BW_RETAG_TASK_NAME}`);
  const prisma = deps.prisma ?? defaultPrisma;
  const fetchAsset = deps.fetchAsset ?? ((key: string) => downloadBuffer(key));
  const toCoverJpg = deps.toCoverJpg ?? defaultToCoverJpg;

  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { bw_retag_enabled: true, bw_session_state_enc: true },
  });
  if (!settings?.bw_retag_enabled) return { enabled: false, reapplied: 0, rateLimited: false, attempted: 0 };
  if (!settings.bw_session_state_enc) {
    log.info('bw_session_state_enc 未保存 — bw.retag.tick skip');
    return { enabled: true, reapplied: 0, rateLimited: false, attempted: 0 };
  }
  let sessionState: string;
  try {
    sessionState = decryptKdpCredentials(settings.bw_session_state_enc);
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'BW session 復号失敗');
    return { enabled: true, reapplied: 0, rateLimited: false, attempted: 0 };
  }

  // 本棚から却下書籍を取得
  let shelf: BwShelfEntry[];
  try {
    shelf = await deps.submitPort.enumerateShelf(sessionState);
  } catch (err) {
    log.warn({ err: errMsg(err) }, 'enumerateShelf 失敗');
    return { enabled: true, reapplied: 0, rateLimited: false, attempted: 0 };
  }
  const rejected = shelf.filter((s) => s.status === '却下');
  log.info({ shelfTotal: shelf.length, rejected: rejected.length }, 'bw.retag.tick: 本棚走査');
  if (rejected.length === 0) return { enabled: true, reapplied: 0, rateLimited: false, attempted: 0 };

  let reapplied = 0;
  let attempted = 0;
  let rateLimited = false;
  for (const entry of rejected) {
    if (attempted >= MAX_PER_TICK) break;
    // タイトルで当方 books を突合(BW側book-id未保持のため)。資産(採用表紙+章)が揃うもののみ。
    const rows = await prisma.$queryRawUnsafe<BwBookRow[]>(
      `SELECT b.id, b.title, b.subtitle, tc.genre, acc.pen_name,
          km.description, km.keywords, km.price_jpy, km.title_kana,
          (SELECT cv.r2_key FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted' ORDER BY cv.created_at DESC LIMIT 1) AS cover_key
       FROM books b
       LEFT JOIN accounts acc ON acc.id=b.account_id
       LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
       LEFT JOIN kdp_metadata km ON km.book_id=b.id
       WHERE b.title = $1 OR b.title LIKE $2
       ORDER BY length(b.title) LIMIT 1`,
      entry.title,
      entry.title.slice(0, 40) + '%',
    );
    const row = rows[0];
    if (!row || !row.cover_key) {
      log.info({ bwId: entry.bwId, title: entry.title }, 'retag skip: 突合不可/表紙なし');
      continue;
    }
    const chapters = await prisma.$queryRawUnsafe<BwEpubChapter[]>(
      `SELECT index, heading, body_md FROM chapters WHERE book_id=$1 ORDER BY index`,
      row.id,
    );
    if (chapters.length === 0) continue;

    const stageDir = mkdtempSync(path.join(tmpdir(), 'bw-retag-'));
    const coverJpgPath = path.join(stageDir, `${row.id}-cover.jpg`);
    const epubPath = path.join(stageDir, `${row.id}.epub`);
    const trialEpubPath = path.join(stageDir, `${row.id}-trial.epub`);
    const author = row.pen_name || DEFAULT_AUTHOR;
    try {
      const coverSrc = await fetchAsset(row.cover_key);
      if (!coverSrc) throw new Error(`R2 cover not found: ${row.cover_key}`);
      const coverJpg = await toCoverJpg(coverSrc);
      const base = { title: row.title, subtitle: row.subtitle, author, description: row.description, chapters, coverJpg };
      writeFileSync(coverJpgPath, coverJpg);
      writeFileSync(epubPath, await buildEpub(base));
      writeFileSync(trialEpubPath, await buildEpub({ ...base, trial: true }));
    } catch (err) {
      log.warn({ bwId: entry.bwId, err: errMsg(err) }, 'retag EPUB生成失敗 — skip');
      continue;
    }

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
    attempted++;
    log.info({ bwId: entry.bwId, book_id: row.id, title: row.title }, 'bw.retag: 再申請開始');
    const result = await deps.submitPort.retagOne({ bwId: entry.bwId, withdraw: false, book, sessionState, stageDir });

    if (result.storageState) {
      await prisma.appSettings
        .update({ where: { id: 'singleton' }, data: { bw_session_state_enc: encryptKdpCredentials(result.storageState) } })
        .catch(() => {});
    }
    if (result.ok) {
      reapplied++;
      await prisma.book
        .update({ where: { id: row.id }, data: { bw_publish_status: 'submitted', bw_submitted_at: new Date() } })
        .catch(() => {});
      log.info({ bwId: entry.bwId, title: row.title }, 'bw.retag: 再申請OK(審査待ち)');
      await pushLine(`✅ A2P: 「${row.title}」をAI生成タグ付きでBOOK☆WALKERに再申請しました`).catch(() => {});
      continue;
    }
    if (result.reason === 'rate_limited') {
      rateLimited = true;
      log.info({ bwId: entry.bwId }, 'bw.retag: 当月申請枠超過(403) — tick終了');
      break;
    }
    if (result.reason === 'not_logged_in') {
      await prisma.appSettings.update({ where: { id: 'singleton' }, data: { bw_retag_enabled: false } }).catch(() => {});
      await pushLine('⚠️ A2P: BOOK☆WALKERセッション失効 — 再ログイン+bw-session-push.mjs後、bw_retag_enabledを再ONにしてください(自動再申請を停止)。').catch(() => {});
      break;
    }
    log.warn({ bwId: entry.bwId, reason: result.reason, fail_message: result.message }, 'bw.retag: 再申請失敗(skip)');
  }
  log.info({ reapplied, attempted, rateLimited }, 'bw.retag.tick done');
  return { enabled: true, reapplied, rateLimited, attempted };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { createPlaywrightBwSubmitPort } from './bw-submit/playwright-submit-port.js';

export const bwRetagTask: Task = async () => {
  await runBwRetagTick({ submitPort: createPlaywrightBwSubmitPort() });
};
