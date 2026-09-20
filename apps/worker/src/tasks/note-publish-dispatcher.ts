/**
 * `note.publish.dispatch` タスク (docs/11-anp-design.md §7 Phase2, F-ANP-20 自動運用)。
 *
 * cron (既定 30 分毎) で起動し、`AppSettings.anp_auto_publish_enabled=true` のとき、
 * `note_articles.status='ready' AND publish_status='draft' AND paid=false` をアカウントごとに
 * 1 件、`note_accounts.status='active'` のみ選んで `pipeline.note.publish` へ enqueue する
 * (bw.submit.dispatch と同型)。1 tick の総数は 3 件まで(自然な投稿頻度に抑える)。
 * job_key で同一記事の重複投入を防ぐ。
 *
 * **`paid=false` に限定する理由 (code review 2026-09-16 #2)**: 有料記事の価格/有料ライン設定 UI が
 * 未実装のため、有料記事は `pipeline.note.publish` に渡しても実公開直前で必ず `blocked` になる
 * (`shouldBlockPaidPublish`)。dispatcher が無駄なジョブ/ブラウザ起動を繰り返さないよう、
 * 自動運用の対象からそもそも除外する(有料記事の公開は当面 UI からの手動 dry-run のみ)。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { resolveAutoPublishEnabled } from './lib/note-account-settings.js';
import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const NOTE_PUBLISH_DISPATCHER_TASK_NAME = 'note.publish.dispatch';

const MAX_PER_TICK = 3;

export interface NotePublishDispatcherPrisma {
  appSettings: {
    findUnique(args: {
      where: { id: string };
      select: { anp_auto_publish_enabled: true; anp_publish_dry_run: true };
    }): Promise<{ anp_auto_publish_enabled: boolean; anp_publish_dry_run: boolean } | null>;
  };
  noteAccount: {
    findMany(args: {
      where: { status: string };
      select: { id: true; settings_json?: true };
      orderBy: { created_at: 'asc' };
    }): Promise<Array<{ id: string; settings_json?: unknown }>>;
  };
  noteArticle: {
    findFirst(args: {
      where: { note_account_id: string; status: string; publish_status: string; paid: boolean };
      select: { id: true };
      orderBy: { updated_at: 'asc' };
    }): Promise<{ id: string } | null>;
  };
  job: {
    create(args: {
      data: { kind: string; status: string; payload_json: unknown };
    }): Promise<{ id: string }>;
  };
}

export interface NotePublishDispatcherDeps {
  prisma?: NotePublishDispatcherPrisma;
  addJob?: AddJobLike;
  logger?: Logger;
}

export interface NotePublishDispatcherResult {
  enabled: boolean;
  enqueued: number;
  articleIds: string[];
}

export async function runNotePublishDispatcher(
  deps: NotePublishDispatcherDeps = {},
): Promise<NotePublishDispatcherResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_PUBLISH_DISPATCHER_TASK_NAME}`);
  const db = deps.prisma ?? (defaultPrisma as unknown as NotePublishDispatcherPrisma);
  const addJob = deps.addJob;
  if (!addJob) throw new Error(`${NOTE_PUBLISH_DISPATCHER_TASK_NAME}: addJob must be provided`);

  const settings = await db.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { anp_auto_publish_enabled: true, anp_publish_dry_run: true },
  });
  if (!settings?.anp_auto_publish_enabled) {
    return { enabled: false, enqueued: 0, articleIds: [] };
  }

  const accounts = await db.noteAccount.findMany({
    where: { status: 'active' },
    select: { id: true, settings_json: true },
    orderBy: { created_at: 'asc' },
  });

  const articleIds: string[] = [];
  for (const account of accounts) {
    if (articleIds.length >= MAX_PER_TICK) break;
    // [F-ANP-17] アカウント別設定でグローバル既定値(=ここでは確定 true)を上書きできる
    // (未指定はグローバルに従う=true のまま)。グローバル OFF の間はこの関数自体が
    // 早期 return するため、有効化できるのは「特定アカウントだけ OFF にする」方向のみ。
    if (!resolveAutoPublishEnabled(account.settings_json, true)) continue;
    const article = await db.noteArticle.findFirst({
      where: { note_account_id: account.id, status: 'ready', publish_status: 'draft', paid: false },
      select: { id: true },
      orderBy: { updated_at: 'asc' },
    });
    if (!article) continue;

    const job = await db.job.create({
      data: {
        kind: 'pipeline.note.publish',
        status: 'queued',
        payload_json: { note_article_id: article.id, dry_run: settings.anp_publish_dry_run },
      },
    });
    await addJob(
      'pipeline.note.publish',
      { note_article_id: article.id, job_id: job.id, dry_run: settings.anp_publish_dry_run },
      { jobKey: `note-publish-${article.id}`, jobKeyMode: 'preserve_run_at', maxAttempts: 2 },
    );
    articleIds.push(article.id);
  }

  log.info(
    { enqueued: articleIds.length, dryRun: settings.anp_publish_dry_run },
    'note.publish.dispatch enqueued',
  );
  return { enabled: true, enqueued: articleIds.length, articleIds };
}

export const notePublishDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runNotePublishDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
