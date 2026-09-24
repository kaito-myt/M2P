/**
 * `paperback.status.sync` タスク (F-097b)。
 *
 * ローカルのアシスト実行 (`pb-auto.sh`) は「投稿ボタンを押せた」時点で `pb_publish_status='published'`
 * にするだけで、Amazon の審査を通って実際に販売中になったかまでは分からない。電子書籍側の
 * `kdp.publish.status.sync` と同じ考え方で、KDP 本棚を **READ-ONLY** で巡回してギャップを埋める。
 *
 * 実 DOM (2026-09-24 実測): 本棚は 1 タイトルのカードに「Kindle 本」行と「ペーパーバック」行を並べ、
 * 各行は `<種別> <状態> 提出日: … ¥<価格> … ASIN: <ASIN>` というテキストを持つ。Kindle の ASIN で
 * 検索するとそのカードだけが出るので、同カード内のペーパーバック行を読めば紙版の状態が分かる。
 *
 * 安全策: 状態変更操作は一切行わない。セッション切れを検知したら即座に打ち切る (再ログインは別タスクの責務)。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import type { BookshelfPort } from './book-cull/bookshelf-port.js';

export const PAPERBACK_STATUS_SYNC_TASK_NAME = 'paperback.status.sync';

/** 1 回の実行で見る冊数 (本棚検索 1 冊あたり十数秒かかるため絞る)。 */
const DEFAULT_LIMIT = 12;

/** 本棚の状態 → `books.pb_publish_status`。 */
export function mapShelfStatusToPb(
  status: 'live' | 'draft' | 'in_review' | 'blocked' | 'not_found' | 'unpublished',
): { pbStatus: string; note: string } | null {
  switch (status) {
    case 'live':
      return { pbStatus: 'published', note: '販売中' };
    case 'in_review':
      return { pbStatus: 'submitted', note: 'レビュー中/出版準備中' };
    case 'draft':
      return { pbStatus: 'drafted', note: '下書き' };
    case 'blocked':
      return { pbStatus: 'failed', note: 'ブロック' };
    case 'unpublished':
      return { pbStatus: 'failed', note: '販売停止中' };
    case 'not_found':
      // カードにペーパーバック行が無い = まだ作られていない。DB 側が drafted/published なら
      // 取り消された可能性があるが、検索の取りこぼしと区別できないので触らない。
      return null;
    default:
      return null;
  }
}

export interface PaperbackStatusSyncDeps {
  prisma?: typeof defaultPrisma;
  logger?: Logger;
  bookshelfPort?: BookshelfPort;
  decryptSession?: (enc: string) => string;
  now?: () => Date;
  limit?: number;
}

export interface PaperbackStatusSyncResult {
  checked: number;
  updated: number;
  status: 'done' | 'no_session' | 'session_expired';
}

export async function runPaperbackStatusSync(
  deps: PaperbackStatusSyncDeps = {},
): Promise<PaperbackStatusSyncResult> {
  const prisma = deps.prisma ?? defaultPrisma;
  const log = deps.logger ?? createLogger(`worker.${PAPERBACK_STATUS_SYNC_TASK_NAME}`);
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const decrypt = deps.decryptSession ?? ((enc: string) => decryptKdpCredentials(enc));

  const port = deps.bookshelfPort;
  if (!port) {
    log.warn({ task: PAPERBACK_STATUS_SYNC_TASK_NAME }, 'bookshelf port not provided — skip');
    return { checked: 0, updated: 0, status: 'done' };
  }

  const account = await prisma.account.findFirst({
    where: { status: 'active' },
    orderBy: { created_at: 'asc' },
    select: { id: true, kdp_session_state_enc: true },
  });
  if (!account?.kdp_session_state_enc) {
    log.info({ task: PAPERBACK_STATUS_SYNC_TASK_NAME }, 'no kdp session — skip');
    return { checked: 0, updated: 0, status: 'no_session' };
  }

  let sessionState: string;
  try {
    sessionState = decrypt(account.kdp_session_state_enc);
  } catch (err) {
    log.warn({ task: PAPERBACK_STATUS_SYNC_TASK_NAME, err }, 'kdp session decrypt failed');
    return { checked: 0, updated: 0, status: 'no_session' };
  }

  // 下書き/申請済み/公開済みを、最後に確認してから古い順に見る。
  const targets = await prisma.book.findMany({
    where: {
      asin: { not: null },
      pb_publish_status: { in: ['drafted', 'submitted', 'published'] },
    },
    orderBy: [{ pb_status_checked_at: { sort: 'asc', nulls: 'first' } }],
    take: limit,
    select: { id: true, title: true, asin: true, pb_publish_status: true, pb_asin: true },
  });

  let checked = 0;
  let updated = 0;
  for (const b of targets) {
    if (!b.asin) continue;
    const res = await port.readPaperbackStatus({ asin: b.asin, sessionState });
    checked += 1;
    if (!res.ok) {
      if (res.reason === 'session_expired') {
        log.warn({ task: PAPERBACK_STATUS_SYNC_TASK_NAME, bookId: b.id }, 'kdp session expired — abort loop');
        return { checked, updated, status: 'session_expired' };
      }
      log.warn({ task: PAPERBACK_STATUS_SYNC_TASK_NAME, bookId: b.id, reason: res.reason }, 'read failed');
      continue;
    }

    const mapped = mapShelfStatusToPb(res.status);
    const data: Record<string, unknown> = { pb_status_checked_at: now() };
    if (res.pbAsin && res.pbAsin !== b.pb_asin) data.pb_asin = res.pbAsin;
    if (mapped && mapped.pbStatus !== b.pb_publish_status) {
      data.pb_publish_status = mapped.pbStatus;
      // 販売中を確認できたらキューからも降ろす。
      if (mapped.pbStatus === 'published') data.pb_publish_queued = false;
      updated += 1;
      log.info(
        { task: PAPERBACK_STATUS_SYNC_TASK_NAME, bookId: b.id, from: b.pb_publish_status, to: mapped.pbStatus },
        `paperback status synced (${mapped.note})`,
      );
    }
    await prisma.book.update({ where: { id: b.id }, data: data as never });
  }

  log.info({ task: PAPERBACK_STATUS_SYNC_TASK_NAME, checked, updated }, 'paperback status sync done');
  return { checked, updated, status: 'done' };
}

export const paperbackStatusSyncTask: Task = async (_payload: unknown, _helpers: JobHelpers) => {
  const { createPlaywrightBookshelfPort } = await import('./book-cull/playwright-bookshelf-port.js');
  await runPaperbackStatusSync({ bookshelfPort: createPlaywrightBookshelfPort() });
};
