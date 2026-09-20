/**
 * `note.publish.status.sync` タスク (docs/11-anp-design.md §7 Phase2, F-ANP-22)。
 *
 * 6 時間毎 (cron) に `NoteArticle.publish_status='published'` の記事の `note_url` を
 * READ-ONLY で開き、公開中(live)か非公開/404(unlisted)かを確認する。unlisted 検知時は
 * `publish_status='unlisted'` に降格させる。セッション失効時は dispatcher と同じ扱い
 * (アカウントを `status='paused'` にして LINE 通知)で、そのアカウントの走査は打ち切る。
 */
import type { Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { decryptKdpCredentials } from '@a2p/crypto';
import { prisma as defaultPrisma } from '@a2p/db';

import { pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import type { NotePublishPort } from './note-publish/playwright-note-publish-port.js';

export const NOTE_PUBLISH_STATUS_SYNC_TASK_NAME = 'note.publish.status.sync';

interface NoteAccountRow {
  id: string;
  display_name: string;
  session_state_enc: string | null;
}
interface NoteArticleRow {
  id: string;
  note_url: string | null;
  title: string;
}

export interface NotePublishStatusSyncPrisma {
  noteAccount: {
    findMany(args: {
      where: { status: string; session_state_enc: { not: null } };
      select: { id: true; display_name: true; session_state_enc: true };
    }): Promise<NoteAccountRow[]>;
    update(args: { where: { id: string }; data: { status: string } }): Promise<unknown>;
  };
  noteArticle: {
    findMany(args: {
      where: { note_account_id: string; publish_status: string; note_url: { not: null } };
      select: { id: true; note_url: true; title: true };
    }): Promise<NoteArticleRow[]>;
    update(args: { where: { id: string }; data: { publish_status: string } }): Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
}

export interface NotePublishStatusSyncDeps {
  publishPort: NotePublishPort;
  prisma?: NotePublishStatusSyncPrisma;
  logger?: Logger;
  decryptSession?: (enc: string) => string;
  notify?: (text: string) => Promise<boolean>;
}

export interface NotePublishStatusSyncResult {
  checked: number;
  unlisted: number;
}

export async function runNotePublishStatusSync(
  deps: NotePublishStatusSyncDeps,
): Promise<NotePublishStatusSyncResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_PUBLISH_STATUS_SYNC_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as NotePublishStatusSyncPrisma);
  const decryptSession = deps.decryptSession ?? decryptKdpCredentials;
  const notify = deps.notify ?? pushLine;

  const accounts = await db.noteAccount.findMany({
    where: { status: 'active', session_state_enc: { not: null } },
    select: { id: true, display_name: true, session_state_enc: true },
  });

  let checked = 0;
  let unlisted = 0;

  for (const account of accounts) {
    let sessionState: string;
    try {
      sessionState = decryptSession(account.session_state_enc!);
    } catch (err) {
      log.warn({ err: errMsg(err), accountId: account.id }, 'note セッション復号失敗 — このアカウントはスキップ');
      continue;
    }

    const articles = await db.noteArticle.findMany({
      where: { note_account_id: account.id, publish_status: 'published', note_url: { not: null } },
      select: { id: true, note_url: true, title: true },
    });

    for (const article of articles) {
      checked++;
      const res = await deps.publishPort.checkPublished({ noteUrl: article.note_url!, sessionState }).catch((err) => ({
        ok: false as const,
        reason: 'error' as const,
        message: errMsg(err),
      }));

      if (!res.ok) {
        if (res.reason === 'not_logged_in') {
          log.warn({ accountId: account.id }, 'note セッション失効を検知 — アカウントを一時停止');
          await db.noteAccount.update({ where: { id: account.id }, data: { status: 'paused' } }).catch(() => {});
          await notifyNoteSessionExpired(db, account.id, account.display_name, notify);
          break; // このアカウントの残り記事は次回以降に持ち越し
        }
        log.warn({ articleId: article.id, reason: res.reason, message: res.message }, 'ステータス取得失敗 — スキップ');
        continue;
      }

      if (res.status === 'unlisted') {
        await db.noteArticle
          .update({ where: { id: article.id }, data: { publish_status: 'unlisted' } })
          .catch((err) => log.warn({ err: errMsg(err), articleId: article.id }, 'unlisted 更新失敗'));
        unlisted++;
        log.info({ articleId: article.id, title: article.title }, '非公開/404 を検知 — unlisted に更新');
      }
    }
  }

  log.info({ checked, unlisted }, 'note.publish.status.sync done');
  return { checked, unlisted };
}

export const notePublishStatusSyncTask: Task = async () => {
  const { createPlaywrightNotePublishPort } = await import('./note-publish/playwright-note-publish-port.js');
  await runNotePublishStatusSync({ publishPort: createPlaywrightNotePublishPort() });
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
