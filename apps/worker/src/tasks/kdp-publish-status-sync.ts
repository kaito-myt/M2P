import type { Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { isLineRelayConfigured, pushLine, type LineAuthRelayPrisma } from './lib/line-auth-relay.js';
import { kdpSessionAlertGate } from './lib/kdp-session-alert.js';
import type { BookshelfPort } from './book-cull/bookshelf-port.js';
import type { KdpProxyPrisma } from './sales-fetch/kdp-proxy.js';

/**
 * セッション切れ検知時の自己回復(自動再ログイン)。成功で新しい storageState を返す。
 * 本番ラッパ(`kdpPublishStatusSyncTask`)は `refreshKdpSession`(住宅プロキシ経由)を注入する。
 * 未注入(=旧動作)の場合、`runKdpPublishStatusSync` は再ログインを試みず従来通り通知して中断する。
 */
export type RefreshSessionFn = (
  oldStorageState: string,
) => Promise<{ ok: true; storageState: string } | { ok: false; reason: string }>;

/**
 * `kdp.publish.status.sync` タスク — KDP 本棚を READ-ONLY で巡回し、`publish_status='submitted'`
 * の本が実際に KDP で LIVE (販売中) になっていたら自動で `published` に昇格させる。
 *
 * ローカルのアシスト出版ツール (`scripts/kdp-publish.mjs`) は入稿成功時点で `submitted` に
 * するだけで、実際にいつ Amazon 側の審査が通り LIVE になるかまでは分からない。本タスクが
 * 保存済みセッション再利用でヘッドレス閲覧し、そのギャップを埋める。
 *
 * 安全策 (READ-ONLY): ログイン/出版/取り下げ等の状態変更操作は一切行わない。セッション切れを
 * 検知した場合は LINE 通知のうえ即座にループを打ち切る (再ログイン試行は行わない — 別タスクの
 * 責務外)。
 */
export const KDP_PUBLISH_STATUS_SYNC_TASK_NAME = 'kdp.publish.status.sync';

// ---------------------------------------------------------------------------
// Prisma 最小インターフェース — テストでモック可能にする。
// ---------------------------------------------------------------------------

export interface KdpPublishStatusSyncPrisma {
  account: {
    findFirst(args: {
      where: { status: string };
      select: { id: true; kdp_session_state_enc: true };
      orderBy: { created_at: 'asc' };
    }): Promise<{ id: string; kdp_session_state_enc: string | null } | null>;
  };
  book: {
    findMany(args: {
      where: { publish_status: string };
      select: { id: true; asin: true; title: true };
    }): Promise<Array<{ id: string; asin: string | null; title: string }>>;
    update(args: {
      where: { id: string };
      data: { publish_status: string; updated_at: Date; asin?: string };
    }): Promise<unknown>;
  };
  auditLog: {
    create(args: {
      data: {
        actor_id: string | null;
        action: string;
        target_kind: string;
        target_id: string;
        before_json?: Record<string, unknown>;
        after_json?: Record<string, unknown>;
      };
    }): Promise<unknown>;
  };
}

export interface KdpPublishStatusSyncDeps {
  bookshelfPort: BookshelfPort;
  prisma?: KdpPublishStatusSyncPrisma;
  logger?: Logger;
  now?: () => Date;
  /**
   * セッション切れ検知時の自己回復(自動再ログイン)。注入時: 1度だけ再ログインを試み、
   * 成功したら更新後セッションで走査を継続する(= 本棚同期が自己回復し、切れ通知も出ない)。
   * 未注入時: 従来通り通知して中断する。
   */
  refreshSession?: RefreshSessionFn;
}

export interface KdpPublishStatusSyncResult {
  checked: number;
  promoted: number;
}

// ---------------------------------------------------------------------------
// 純ロジック関数
// ---------------------------------------------------------------------------

export async function runKdpPublishStatusSync(
  deps: KdpPublishStatusSyncDeps,
): Promise<KdpPublishStatusSyncResult> {
  const log = deps.logger ?? createLogger(`worker.${KDP_PUBLISH_STATUS_SYNC_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as KdpPublishStatusSyncPrisma);
  const now = deps.now ?? (() => new Date());

  // 1. アカウント + セッション取得 (単一運営者 = 作成日最古の active アカウントを対象とする)
  const account = await db.account.findFirst({
    where: { status: 'active' },
    select: { id: true, kdp_session_state_enc: true },
    orderBy: { created_at: 'asc' },
  });
  if (!account) {
    log.info({ task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME }, '有効な KDP アカウントが無いためスキップ');
    return { checked: 0, promoted: 0 };
  }
  if (!account.kdp_session_state_enc) {
    log.info(
      { task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME, accountId: account.id },
      'KDP セッション未設定のためスキップ',
    );
    return { checked: 0, promoted: 0 };
  }

  let sessionState: string;
  try {
    sessionState = decryptKdpCredentials(account.kdp_session_state_enc);
  } catch (err) {
    log.warn({ err, accountId: account.id }, 'KDP セッションの復号に失敗したためスキップ');
    return { checked: 0, promoted: 0 };
  }

  // 2. 入稿済み(未LIVE確認)の本を全件取得
  const books = await db.book.findMany({
    where: { publish_status: 'submitted' },
    select: { id: true, asin: true, title: true },
  });

  let checked = 0;
  let promoted = 0;
  let reloginTried = false; // 自動再ログインは1巡につき1度だけ試みる(無限リトライ防止)。
  const promotedTitles: string[] = []; // [PUB-2] 出版完了通知用にLIVE昇格した書名を集める。

  const readStatus = (book: { asin: string | null; title: string }) =>
    deps.bookshelfPort.readBookStatus({
      asin: book.asin ?? undefined,
      title: book.title,
      sessionState,
    });

  for (const book of books) {
    checked++;
    let res;
    try {
      res = await readStatus(book);
    } catch (err) {
      log.warn({ err, bookId: book.id }, 'readBookStatus が例外を投げたためこの本はスキップ');
      continue;
    }

    // [F-086 根本対応] セッション切れ → 自己回復(自動再ログイン)を1度だけ試み、
    // 成功したら更新後セッションで同じ本を再読込し走査を継続する。これにより本棚同期が
    // sales.fetch と同様に自己回復し、6h毎の「セッション切れ」通知スパムが解消する。
    if (!res.ok && res.reason === 'session_expired' && !reloginTried && deps.refreshSession) {
      reloginTried = true;
      log.warn({ bookId: book.id }, 'セッション切れを検知 — 自動再ログインを試行');
      const ref = await deps
        .refreshSession(sessionState)
        .catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.message : String(e) }));
      if (ref.ok) {
        sessionState = ref.storageState;
        log.info('自動再ログイン成功 — セッションを更新して同期を継続');
        try {
          res = await readStatus(book); // 同じ本を新セッションで再読込
        } catch (err) {
          log.warn({ err, bookId: book.id }, '再ログイン後の再読込で例外 — この本はスキップ');
          continue;
        }
      } else {
        // 再ログインにも失敗 = 本当に人手が要る。通知(24hゲート)して中断。
        log.warn({ bookId: book.id, reason: ref.reason }, '自動再ログイン失敗 — 同期を中断');
        if (isLineRelayConfigured() && (await kdpSessionAlertGate())) {
          await pushLine(
            `KDP本棚セッションが切れ、自動再ログインにも失敗しました（${ref.reason}）。手動でのセッション再取得が必要です。`,
          ).catch(() => {});
        }
        break;
      }
    }

    if (!res.ok) {
      if (res.reason === 'session_expired') {
        // refreshSession 未注入(旧動作) または 再ログイン後もなお切れ。通知(ゲート)して中断。
        log.warn(
          { task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME, bookId: book.id },
          'KDP セッション期限切れを検知 — 同期を中断',
        );
        if (isLineRelayConfigured() && (await kdpSessionAlertGate())) {
          await pushLine('KDP本棚の閲覧セッションが切れています。売上取得などで再ログインが必要です。').catch(
            () => {},
          );
        }
        break; // 以降ヒットしても同じ結果なので走査を打ち切る (連打を避ける)
      }
      log.warn(
        { bookId: book.id, reason: res.reason, message: res.message },
        'KDP ステータス取得に失敗 — この本はスキップ',
      );
      continue;
    }

    if (res.status !== 'live') continue;

    // 本棚行から読み取った ASIN を backfill(未記録なら)。ASIN が無いと /shop 等の公開一覧に
    // 載らないため、LIVE 昇格と同時に確実に記録して DB↔本棚のドリフトを自己修復する。
    const backfillAsin =
      !book.asin && typeof res.asin === 'string' && /^B0[A-Z0-9]{8}$/.test(res.asin)
        ? res.asin
        : undefined;

    try {
      await db.book.update({
        where: { id: book.id },
        data: {
          publish_status: 'published',
          updated_at: now(),
          ...(backfillAsin ? { asin: backfillAsin } : {}),
        },
      });
      await db.auditLog.create({
        data: {
          actor_id: null, // cron 起動 = システム実行
          action: 'kdp.publish.published',
          target_kind: 'book',
          target_id: book.id,
          before_json: { publish_status: 'submitted', asin: book.asin },
          after_json: {
            publish_status: 'published',
            detected_status: res.status,
            ...(backfillAsin ? { asin: backfillAsin } : {}),
          },
        },
      });
      promoted++;
      promotedTitles.push(book.title);
      log.info({ task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME, bookId: book.id }, 'LIVE 検知 → published に昇格');
    } catch (err) {
      log.warn({ err, bookId: book.id }, 'published への更新に失敗');
    }
  }

  // [PUB-2] 出版完了通知: LIVE 昇格した本があれば運営者に LINE 通知する。
  // 従来は「published」種別の通知が無く、出版完了が運営者に一切届いていなかった。
  if (promotedTitles.length > 0 && isLineRelayConfigured()) {
    const lines = promotedTitles.slice(0, 20).map((t) => `・${t}`);
    const extra = promotedTitles.length > 20 ? `\n…ほか${promotedTitles.length - 20}冊` : '';
    await pushLine(
      `📗 KDP出版完了のお知らせ\n${promotedTitles.length}冊がKindleで販売開始(LIVE)になりました。\n\n${lines.join('\n')}${extra}`,
    ).catch(() => {});
  }

  log.info(
    { task: KDP_PUBLISH_STATUS_SYNC_TASK_NAME, checked, promoted },
    'kdp.publish.status.sync done',
  );
  return { checked, promoted };
}

// ---------------------------------------------------------------------------
// graphile-worker Task 薄ラッパ
// ---------------------------------------------------------------------------

export const kdpPublishStatusSyncTask: Task = async () => {
  const { createPlaywrightBookshelfPort } = await import('./book-cull/playwright-bookshelf-port.js');
  const { refreshKdpSession } = await import('./sales-fetch/kdp-login-refresh.js');
  const { resolveKdpProxy } = await import('./sales-fetch/kdp-proxy.js');
  const { encryptKdpCredentials } = await import('@a2p/crypto');

  // 住宅IPプロキシ(あれば)経由。データセンターIP直結でも現状は再ログイン成功しているが、
  // sales.fetch と同条件に揃える。
  const proxy =
    (await resolveKdpProxy(defaultPrisma as unknown as KdpProxyPrisma).catch(() => null)) ?? undefined;

  await runKdpPublishStatusSync({
    bookshelfPort: createPlaywrightBookshelfPort(),
    // 自己回復: 本棚(kdp.amazon.co.jp)着地で signin を発火させ再ログイン → 新セッションをDBへ書き戻す。
    refreshSession: async (oldStorageState) => {
      const ref = await refreshKdpSession({
        // LineAuthRelayPrisma 形状(kdpAuthRequest 等)を満たす defaultPrisma を渡す。
        prisma: defaultPrisma as unknown as LineAuthRelayPrisma,
        oldStorageState,
        proxy,
      });
      if (!ref.ok) return { ok: false as const, reason: ref.reason };
      // 更新後セッションを最古 active アカウントへ書き戻す(単一運営者)。
      try {
        const acc = await defaultPrisma.account.findFirst({
          where: { status: 'active' },
          orderBy: { created_at: 'asc' },
          select: { id: true },
        });
        if (acc) {
          await defaultPrisma.account.update({
            where: { id: acc.id },
            data: { kdp_session_state_enc: encryptKdpCredentials(ref.storageState) },
          });
        }
      } catch {
        /* 書き戻し失敗しても回復セッションで今回の走査は継続する */
      }
      return { ok: true as const, storageState: ref.storageState };
    },
  });
};
