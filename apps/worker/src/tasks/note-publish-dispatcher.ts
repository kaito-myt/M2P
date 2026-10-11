/**
 * `note.publish.dispatch` タスク (docs/11-anp-design.md §7 Phase2, F-ANP-20 自動運用)。
 *
 * cron (既定 30 分毎) で起動し、`AppSettings.anp_auto_publish_enabled=true` のとき、
 * `note_articles.status='ready' AND publish_status='draft'` をアカウントごとに 1 件、
 * `note_accounts.status='active'` のみ選んで `pipeline.note.publish` へ enqueue する
 * (bw.submit.dispatch と同型)。1 tick の総数は 3 件まで。
 * job_key で同一記事の重複投入を防ぐ。
 *
 * **有料記事も対象にする (2026-10-11)**: かつては `paid=false` に限定していた。理由は
 * 「有料記事の価格/有料ライン設定 UI が未実装で、実公開直前に必ず `blocked` になるから
 * 無駄なブラウザ起動を避ける」(code review 2026-09-16 #2)。F-ANP-16b でアカウント設定
 * `paid_publish_enabled` による実公開が入り、有料記事 19 本の公開と 9 本の後付け有料化を
 * 実走で確認済みなので、この除外条件はもう嘘になっていた。残したままだと企画どおり有料に
 * した記事 (実測 38 本) が自動公開から永久に外れるため撤去する。
 * `paid_publish_enabled` が OFF のアカウントでは judge が `paid=false` に落とすので、
 * dispatcher 側で有料を弾く必要はない。
 *
 * **1 アカウント 1 日あたりの上限 (`MAX_PER_ACCOUNT_PER_DAY`)**: 運営者指示
 * 「スケジュール通りに必ず公開するようにして」に対し、上限なしのままだと滞留分が
 * 一気に出て投稿頻度が跳ね上がる (30 分毎 × 1 件 = 最大 48 本/日)。note 側のスパム判定を
 * 避けつつ積み残しを現実的な速度で流すため、日次上限で頻度を決める。
 */
import type { JobHelpers, Task } from 'graphile-worker';

import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { resolveAutoPublishEnabled } from './lib/note-account-settings.js';
import type { AddJobLike } from './sales-fetch-dispatcher.js';

export const NOTE_PUBLISH_DISPATCHER_TASK_NAME = 'note.publish.dispatch';

const MAX_PER_TICK = 3;

/**
 * 1 アカウントが 1 日 (JST) に公開する上限。
 *
 * 15 本は実測に基づく: 2026-09-24 に同一アカウントで 16 本を公開してアカウント制限は起きて
 * いない。定常運用の投稿頻度 (1〜2 本/日) ではなく「積み残しを流しきるまでの上限」として置く。
 */
export const MAX_PER_ACCOUNT_PER_DAY = 15;

/** JST の「今日」の 0 時を UTC の Date で返す (公開本数の日次カウント用)。 */
export function startOfJstDay(now: Date): Date {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - 9 * 60 * 60 * 1000,
  );
}

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
      where: { note_account_id: string; status: string; publish_status: string };
      select: { id: true };
      orderBy: { updated_at: 'asc' };
    }): Promise<{ id: string } | null>;
    count(args: {
      where: {
        note_account_id: string;
        publish_status: string;
        published_at: { gte: Date };
      };
    }): Promise<number>;
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
  now?: () => Date;
}

export interface NotePublishDispatcherResult {
  enabled: boolean;
  enqueued: number;
  articleIds: string[];
  /** 日次上限に達して見送ったアカウント数 (観測用)。 */
  cappedAccounts: number;
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
    return { enabled: false, enqueued: 0, articleIds: [], cappedAccounts: 0 };
  }

  const accounts = await db.noteAccount.findMany({
    where: { status: 'active' },
    select: { id: true, settings_json: true },
    orderBy: { created_at: 'asc' },
  });

  const dayStart = startOfJstDay((deps.now ?? (() => new Date()))());
  const articleIds: string[] = [];
  let cappedAccounts = 0;
  for (const account of accounts) {
    if (articleIds.length >= MAX_PER_TICK) break;
    // [F-ANP-17] アカウント別設定でグローバル既定値(=ここでは確定 true)を上書きできる
    // (未指定はグローバルに従う=true のまま)。グローバル OFF の間はこの関数自体が
    // 早期 return するため、有効化できるのは「特定アカウントだけ OFF にする」方向のみ。
    if (!resolveAutoPublishEnabled(account.settings_json, true)) continue;

    // 日次上限。公開済みの本数で数えるので、途中で失敗した記事は枠を食わない。
    const publishedToday = await db.noteArticle.count({
      where: {
        note_account_id: account.id,
        publish_status: 'published',
        published_at: { gte: dayStart },
      },
    });
    if (publishedToday >= MAX_PER_ACCOUNT_PER_DAY) {
      cappedAccounts += 1;
      continue;
    }

    const article = await db.noteArticle.findFirst({
      where: { note_account_id: account.id, status: 'ready', publish_status: 'draft' },
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
    { enqueued: articleIds.length, cappedAccounts, dryRun: settings.anp_publish_dry_run },
    'note.publish.dispatch enqueued',
  );
  return { enabled: true, enqueued: articleIds.length, articleIds, cappedAccounts };
}

export const notePublishDispatcherTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runNotePublishDispatcher({ addJob: helpers.addJob as unknown as AddJobLike });
};
