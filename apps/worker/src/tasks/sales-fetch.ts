import { z } from 'zod';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials, encryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';
import {
  parseKdpReportWorkbook,
  normalizeKdpRows,
  deriveKenpRateFromRecords,
  type KenpEffectiveRate,
} from '@a2p/kdp-report';

import { isLineRelayConfigured, pushLine, type LineAuthRelayPrisma } from './lib/line-auth-relay.js';
import { kdpSessionAlertGate } from './lib/kdp-session-alert.js';
import type { BrowserPort } from './sales-fetch/browser-port.js';
import { refreshKdpSession } from './sales-fetch/kdp-login-refresh.js';
import { resolveKdpProxy, type KdpProxyConfig, type KdpProxyPrisma } from './sales-fetch/kdp-proxy.js';

/**
 * `sales.fetch` ワーカタスク (F-038, 自動取得 Phase2)。
 *
 * セッション再利用方式: accounts.kdp_session_state_enc(暗号化 storageState)を復号し、
 * `BrowserPort.downloadReport` で KDP 月別ロイヤリティ(PMR)レポート xlsx を取得 →
 * 共有パーサ(@a2p/kdp-report)で対象月を正規化 → ASIN 突合 → sales_records を upsert。
 *
 * source='auto'。運営者の手動確定値(source='manual_upload')は上書きしない。
 * BrowserPort を DI して実ブラウザなしで単体テスト可能。
 */

export const SALES_FETCH_TASK_NAME = 'sales.fetch';

/**
 * 自動取得が上書きしない source。
 * - 'manual'        : 運営者が /sales/manual で手入力した数値 → 保護する。
 * - 'manual_upload' : レポート手動取込 = 自動取得と同じ権威データ源なので上書きOK(保護しない)。
 */
const PROTECTED_SOURCES = new Set(['manual']);

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export const SalesFetchPayload = z.object({
  account_id: z.string(),
  year_month: z.string().regex(/^\d{4}-\d{2}$/),
});
export type SalesFetchPayload = z.infer<typeof SalesFetchPayload>;

/** Prisma 最小インターフェース — テストでモック可能にする。 */
export interface SalesFetchPrisma {
  account: {
    findUnique(args: {
      where: { id: string };
      select: { kdp_session_state_enc: true };
    }): Promise<{ kdp_session_state_enc: string | null } | null>;
    /** 自動再ログイン成功時に更新後の storageState を書き戻す。 */
    update(args: {
      where: { id: string };
      data: { kdp_session_state_enc: string };
    }): Promise<unknown>;
  };
  /** LINE 双方向認証リレー (自動再ログインの OTP 中継) が利用する。 */
  kdpAuthRequest: LineAuthRelayPrisma['kdpAuthRequest'];
  salesFetchRun: {
    create(args: {
      data: { account_id: string; year_month: string; status: string };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: {
        status: string;
        records_upserted?: number;
        error_message?: string | null;
        finished_at?: Date;
      };
    }): Promise<unknown>;
  };
  book: {
    findMany(args: {
      where: { asin: { in: string[] } };
      select: { id: true; asin: true };
    }): Promise<Array<{ id: string; asin: string | null }>>;
  };
  salesRecord: {
    findMany(args: {
      where: { book_id: { in: string[] }; year_month: string };
      select: { book_id: true; source: true; kenp_royalty_jpy: true };
    }): Promise<Array<{ book_id: string; source: string; kenp_royalty_jpy?: number }>>;
    /** KENP 実効レート導出用: 確定済み (推計でない) KENP 金額を持つ過去月の行。 */
    findMany(args: {
      where: {
        year_month: { lt: string };
        kenp_royalty_jpy: { gt: number };
        kenp_royalty_estimated_jpy: number;
      };
      select: { year_month: true; kenp_read: true; kenp_royalty_jpy: true; source: true };
    }): Promise<Array<{ year_month: string; kenp_read: number; kenp_royalty_jpy: number; source?: string }>>;
    upsert(args: {
      where: { book_id_year_month: { book_id: string; year_month: string } };
      create: {
        book_id: string;
        year_month: string;
        royalty_jpy: number;
        units_sold: number;
        kenp_read: number;
        kenp_royalty_jpy: number;
        kenp_royalty_estimated_jpy: number;
        source: string;
      };
      update: {
        royalty_jpy: number;
        units_sold: number;
        kenp_read: number;
        kenp_royalty_jpy: number;
        kenp_royalty_estimated_jpy: number;
        source: string;
      };
    }): Promise<unknown>;
  };
  modelCatalog: {
    findFirst(args: {
      where: { is_current: boolean };
      select: { fx_rate_usd_jpy: true };
      orderBy: { fetched_at: 'desc' };
    }): Promise<{ fx_rate_usd_jpy: unknown } | null>;
  };
}

export interface SalesFetchDeps {
  payload: SalesFetchPayload;
  browserPort: BrowserPort;
  prisma?: SalesFetchPrisma;
  logger?: Logger;
  now?: () => Date;
  /** 自宅回線経由の HTTP プロキシ(住宅IP)。指定時は DL/再ログインをこのプロキシ経由で行う。 */
  proxy?: KdpProxyConfig;
}

export interface SalesFetchResult {
  ok: boolean;
  recordsUpserted: number;
  runId: string;
  reason?: 'session_expired' | 'no_session' | 'download_failed' | 'parse_error' | 'unknown';
}

// ---------------------------------------------------------------------------
// 純ロジック関数
// ---------------------------------------------------------------------------

export async function runSalesFetch(deps: SalesFetchDeps): Promise<SalesFetchResult> {
  const { payload } = deps;
  const log = deps.logger ?? createLogger(`worker.${SALES_FETCH_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as SalesFetchPrisma);
  const now = deps.now ?? (() => new Date());

  const run = await db.salesFetchRun.create({
    data: { account_id: payload.account_id, year_month: payload.year_month, status: 'running' },
  });
  const runId = run.id;
  log.info({ runId, account_id: payload.account_id, year_month: payload.year_month }, 'sales.fetch start');

  // 1. セッション取得
  const account = await db.account.findUnique({
    where: { id: payload.account_id },
    select: { kdp_session_state_enc: true },
  });
  if (!account?.kdp_session_state_enc) {
    return fail(db, runId, now, 'no_session', 'KDP セッションが未設定です (初回キャプチャが必要)', log);
  }

  let sessionState: string;
  try {
    sessionState = decryptKdpCredentials(account.kdp_session_state_enc);
  } catch (err) {
    log.warn({ err, runId }, 'failed to decrypt kdp_session_state_enc');
    return fail(db, runId, now, 'unknown', 'セッションの復号に失敗しました', log);
  }

  // 2. レポート DL
  let dl = await deps.browserPort.downloadReport({
    sessionState,
    yearMonth: payload.year_month,
    proxy: deps.proxy,
  });

  // 2b. セッション切れ → LINE 中継 + AMAZON_EMAIL/PASSWORD が揃っていれば自動再ログインを試みる。
  if (!dl.ok && dl.reason === 'session_expired') {
    const canAutoRelogin =
      isLineRelayConfigured() && Boolean(process.env.AMAZON_EMAIL) && Boolean(process.env.AMAZON_PASSWORD);
    if (canAutoRelogin) {
      // [F-086 根本対応] セッション切れは自動再ログインで自己回復するのが常態(3週間 OTP 不要で成功中)。
      // そのため「検知しました/試みます」の予告通知は出さず、システムは黙って自己回復する。
      // 通知するのは自己回復に失敗した=人手が必要なときだけ(24hゲートで連投も防止)。
      // 本棚 (kdp.amazon.co.jp) は browse セッションで通ってしまい再認証が起きないため、
      // レポートホスト (kdpreports.amazon.co.jp) を着地先にして OpenID サインイン
      // (→ email/password/OTP) を確実に発火させ、reports 側セッションを確立する。
      const ref = await refreshKdpSession({
        prisma: db,
        oldStorageState: sessionState,
        proxy: deps.proxy,
        landingUrl: 'https://kdpreports.amazon.co.jp/',
      });
      if (ref.ok) {
        try {
          await db.account.update({
            where: { id: payload.account_id },
            data: { kdp_session_state_enc: encryptKdpCredentials(ref.storageState) },
          });
        } catch (err) {
          log.warn({ err, runId }, 'failed to persist refreshed kdp_session_state_enc');
        }
        const retryDl = await deps.browserPort.downloadReport({
          sessionState: ref.storageState,
          yearMonth: payload.year_month,
          proxy: deps.proxy,
        });
        if (!retryDl.ok) {
          log.warn({ runId, reason: retryDl.reason }, 'auto re-login succeeded but retry download still failed');
        }
        dl = retryDl;
      } else {
        // 自己回復に失敗したときだけ通知(24hゲートで連投防止)。
        if (await kdpSessionAlertGate()) {
          await pushLine(
            `KDP売上取得: セッション切れを自動再ログインで回復できませんでした（${ref.reason}）。手動でのセッション再取得が必要です。`,
          ).catch(() => {});
        }
        log.warn({ runId, reason: ref.reason, message: ref.message }, 'auto kdp re-login failed');
      }
    }
  }

  if (!dl.ok) {
    const reason = dl.reason === 'session_expired' ? 'session_expired' : dl.reason === 'download_failed' ? 'download_failed' : 'unknown';
    const msg =
      dl.reason === 'session_expired'
        ? `KDP セッション期限切れ。再ログイン(セッション再取得)が必要です: ${dl.message}`
        : dl.message;
    return fail(db, runId, now, reason, msg, log);
  }

  // 3. パース + 正規化 (対象月のみ)
  let normalized;
  try {
    const parsed = parseKdpReportWorkbook(dl.buffer);
    // KENP ページ数が KDP ダッシュボードと食い違う調査用 (docs/09 §KENP 二重計上調査): 解析したシートと行数を残す。
    const dupes = countDuplicateKeys(parsed.rows);
    log.info(
      {
        runId,
        layout: parsed.layout,
        sheetsParsed: parsed.sheetsParsed,
        rowCount: parsed.rows.length,
        months: parsed.months,
        duplicateKeyCount: dupes.count,
        maxDuplicate: dupes.max,
        duplicateExamples: dupes.examples,
        // 4 シート構成 (電子書籍/既読KENPC/ペーパーバック/総収益) の分類・検出ヘッダ・集計 (docs/09 §10.4)
        sheetDiagnostics: parsed.sheetDiagnostics,
        monthlySummaries: parsed.monthlySummaries,
      },
      'sales.fetch parsed report',
    );
    const fx = await getFxUsdJpy(db);
    normalized = normalizeKdpRows(parsed.rows, {
      targetMonth: payload.year_month,
      monthlySummaries: parsed.monthlySummaries,
      fxToJpy: { USD: fx },
      kenpRate: await getKenpRate(db, payload.year_month),
    });
  } catch (err) {
    log.warn({ err, runId }, 'failed to parse KDP report');
    return fail(db, runId, now, 'parse_error', 'レポートの解析に失敗しました', log);
  }
  log.info(
    { runId, totals: normalized.totals, kenpDiagnostics: normalized.kenpDiagnostics, kenpRateUsed: normalized.kenpRateUsed },
    'sales.fetch normalized totals',
  );

  if (normalized.rows.length === 0) {
    // 当月にまだ実績が無いケース等。エラーではなく 0 件 done。
    await db.salesFetchRun.update({
      where: { id: runId },
      data: { status: 'done', records_upserted: 0, finished_at: now() },
    });
    log.info({ runId }, 'sales.fetch done (0 rows for month)');
    return { ok: true, recordsUpserted: 0, runId };
  }

  // 4. ASIN → book_id
  const asins = normalized.rows.map((r) => r.asin);
  const books = await db.book.findMany({ where: { asin: { in: asins } }, select: { id: true, asin: true } });
  const bookByAsin = new Map(books.filter((b) => b.asin).map((b) => [b.asin as string, b.id]));
  const bookIds = Array.from(bookByAsin.values());

  // 手動確定(manual_upload)は自動で上書きしない。
  const existing =
    bookIds.length > 0
      ? await db.salesRecord.findMany({ where: { book_id: { in: bookIds }, year_month: payload.year_month }, select: { book_id: true, source: true, kenp_royalty_jpy: true } })
      : [];
  const existingSource = new Map(existing.map((e) => [e.book_id, e.source]));
  const existingKenpConfirmed = new Map(existing.map((e) => [e.book_id, (e.kenp_royalty_jpy ?? 0) > 0]));

  let upserted = 0;
  let skippedProtected = 0;
  let skippedEstimate = 0;
  for (const r of normalized.rows) {
    const bookId = bookByAsin.get(r.asin);
    if (!bookId) continue;
    if (PROTECTED_SOURCES.has(existingSource.get(bookId) ?? '')) {
      skippedProtected++;
      continue;
    }
    // 推計は確定済み KENP 金額を上書きしない (確定 > 推計)。確定値の取込は推計を 0 に戻す。
    if (r.kenp_royalty_estimated_jpy > 0 && existingKenpConfirmed.get(bookId)) {
      skippedEstimate++;
      continue;
    }
    try {
      await db.salesRecord.upsert({
        where: { book_id_year_month: { book_id: bookId, year_month: payload.year_month } },
        create: {
          book_id: bookId,
          year_month: payload.year_month,
          royalty_jpy: r.royalty_jpy,
          units_sold: r.units_sold,
          kenp_read: r.kenp_read,
          kenp_royalty_jpy: r.kenp_royalty_jpy,
          kenp_royalty_estimated_jpy: r.kenp_royalty_estimated_jpy,
          source: 'auto',
        },
        update: {
          royalty_jpy: r.royalty_jpy,
          units_sold: r.units_sold,
          kenp_read: r.kenp_read,
          kenp_royalty_jpy: r.kenp_royalty_jpy,
          kenp_royalty_estimated_jpy: r.kenp_royalty_estimated_jpy,
          source: 'auto',
        },
      });
      upserted++;
    } catch (err) {
      log.warn({ err, runId, asin: r.asin }, 'salesRecord.upsert failed; skipping');
    }
  }

  await db.salesFetchRun.update({
    where: { id: runId },
    data: {
      status: 'done',
      records_upserted: upserted,
      finished_at: now(),
      ...(skippedProtected > 0 || skippedEstimate > 0 || normalized.estimatedKenpRoyaltyJpy > 0
        ? {
            error_message: [
              skippedProtected > 0 ? `手動確定 ${skippedProtected} 件は上書き回避` : null,
              skippedEstimate > 0 ? `確定済み KENP ${skippedEstimate} 件は推計での上書き回避` : null,
              normalized.estimatedKenpRoyaltyJpy > 0
                ? `KENP 推計 ¥${normalized.estimatedKenpRoyaltyJpy} を計上 (根拠 ${normalized.kenpRateUsed?.month} レート)`
                : null,
            ]
              .filter(Boolean)
              .join(' / '),
          }
        : {}),
    },
  });
  log.info({ runId, recordsUpserted: upserted, skippedProtected }, 'sales.fetch done');
  return { ok: true, recordsUpserted: upserted, runId };
}

/**
 * 対象月より前の確定月 (DB の KENP 確定金額 ÷ ページ数) から実効レートを導出する。
 * 確定月が無ければ null = 推計しない。取得失敗も推計しない側に倒す (既定レートは置かない)。
 */
async function getKenpRate(db: SalesFetchPrisma, yearMonth: string): Promise<KenpEffectiveRate | null> {
  try {
    const confirmed = await db.salesRecord.findMany({
      where: {
        year_month: { lt: yearMonth },
        kenp_royalty_jpy: { gt: 0 },
        kenp_royalty_estimated_jpy: 0,
      },
      select: { year_month: true, kenp_read: true, kenp_royalty_jpy: true, source: true },
    });
    return deriveKenpRateFromRecords(confirmed, yearMonth);
  } catch {
    return null;
  }
}

type DupRow = {
  asin: string;
  marketplace?: string | null;
  month?: string | null;
  royalty_kind?: string;
  sheet?: string;
  units_sold: number;
  kenp_read: number;
  royalty: number;
};

/**
 * 同一 asin|marketplace|month|royalty_kind の行の重複を数え、例を最大 3 件返す (二重計上調査用。docs/09 §10.4)。
 * 例には由来シートと各行の値を含め、「同一シート内の重複 (日別行など)」か「別シート由来の二重計上」かを判別できるようにする。
 */
function countDuplicateKeys(rows: ReadonlyArray<DupRow>): {
  count: number;
  max: number;
  examples: Array<{
    key: string;
    n: number;
    crossSheet: boolean;
    rows: Array<{ sheet: string | null; units: number; kenp: number; royalty: number }>;
  }>;
} {
  const groups = new Map<string, DupRow[]>();
  for (const r of rows) {
    const k = `${r.asin}|${r.marketplace ?? ''}|${r.month ?? ''}|${r.royalty_kind ?? 'paid'}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const dup = Array.from(groups.entries()).filter(([, g]) => g.length > 1);
  dup.sort((a, b) => b[1].length - a[1].length);
  return {
    count: dup.length,
    max: dup.reduce((m, [, g]) => Math.max(m, g.length), 1),
    examples: dup.slice(0, 3).map(([key, g]) => ({
      key,
      n: g.length,
      crossSheet: new Set(g.map((r) => r.sheet ?? '')).size > 1,
      rows: g.map((r) => ({ sheet: r.sheet ?? null, units: r.units_sold, kenp: r.kenp_read, royalty: r.royalty })),
    })),
  };
}

async function getFxUsdJpy(db: SalesFetchPrisma): Promise<number> {
  try {
    const row = await db.modelCatalog.findFirst({
      where: { is_current: true },
      select: { fx_rate_usd_jpy: true },
      orderBy: { fetched_at: 'desc' },
    });
    const v = row ? Number(row.fx_rate_usd_jpy) : NaN;
    return Number.isFinite(v) && v > 0 ? v : 150;
  } catch {
    return 150;
  }
}

async function fail(
  db: SalesFetchPrisma,
  runId: string,
  now: () => Date,
  reason: NonNullable<SalesFetchResult['reason']>,
  message: string,
  log: Logger,
): Promise<SalesFetchResult> {
  await db.salesFetchRun.update({
    where: { id: runId },
    data: { status: 'failed', error_message: message, finished_at: now() },
  });
  log.warn({ runId, reason, message }, 'sales.fetch failed');
  return { ok: false, recordsUpserted: 0, runId, reason };
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------

import type { Task } from 'graphile-worker';
import { createPlaywrightBrowserPort } from './sales-fetch/playwright-browser-port.js';

export const salesFetchTask: Task = async (payload: unknown, _helpers) => {
  const parsed = SalesFetchPayload.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid sales.fetch payload: ${parsed.error.message}`);
  }
  // 自宅プロキシ(住宅IP経由)が有効かつ heartbeat が新しければ、KDP アクセスを経由させる。
  const proxy = (await resolveKdpProxy(defaultPrisma as unknown as KdpProxyPrisma)) ?? undefined;
  await runSalesFetch({ payload: parsed.data, browserPort: createPlaywrightBrowserPort(), proxy });
};
