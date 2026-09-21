import type { JobHelpers, Task } from 'graphile-worker';

import { generateNoteThemes as defaultGenerateNoteThemes } from '@a2p/agents/anp/theme';
import type { NoteThemeInput, NoteThemeOutput } from '@a2p/contracts/agents/anp';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { readAnpAutopass, type AnpAutopassPrisma } from './lib/anp-autopass.js';
import { resolveThemeAutoSettings } from './lib/note-account-settings.js';
import { NOTE_THEME_GENERATE_TASK_NAME } from './note-theme-generate.js';
import { PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME } from './pipeline-note-writer-outline.js';

/**
 * `note.theme.auto` タスク (docs/11-anp-design.md §7 Phase4, F-ANP-17 日次自動運転)。
 *
 * cron (既定 `AppSettings.anp_theme_cron`) で起動し、`anp_auto_theme_enabled=true` のとき
 * `note_accounts.status='active'` の各アカウントについて 1 日 `anp_themes_per_day` 件の
 * テーマを自動生成する。`anp_autopass_enabled=true` の間はさらに生成した全テーマを自動採用し、
 * `pipeline.note.writer.outline` (→ body → editor → eyecatch → judge が自動連結) を起動する
 * (UI の「テーマ生成」ボタン→「承認」ボタンと同じ経路を worker から直接踏む)。
 *
 * A2P `pipeline.theme.auto` と同型の設計判断:
 *   - 内部 `Job` (kind=note.theme.generate) を観測用に 1 件作るが、graphile-worker のキューには
 *     載せない (直接呼出で二重生成を避ける)。
 *   - アカウント単位で try/catch し、1 アカウントの失敗が他アカウントの処理を止めない
 *     (note.sales.fetch.dispatch と同じ方針)。
 *   - NoteTheme は `createMany` ではなく 1 件ずつ `create` する — 自動採用フェーズで
 *     「今回生成した ID」を確実に特定するため (NoteTheme に theme_session_id 列が無いため)。
 */

export const NOTE_THEME_AUTO_TASK_NAME = 'note.theme.auto';

const EXCLUDE_LOOKBACK_DAYS = 90;
const EXCLUDE_TITLES_HARD_LIMIT = 200;

interface NoteAccountRow {
  id: string;
  niche: string;
  target_reader: string | null;
  tone: string | null;
  /** [F-ANP-07] 記事の方針・トンマナ。未選択/旧テストでは undefined。 */
  editorial_policy?: string | null;
  /** [F-ANP-17] アカウント別設定 (`NoteAccountSettingsSchema`)。未選択/旧テストでは undefined。 */
  settings_json?: unknown;
}

interface CreatedTheme {
  id: string;
  note_account_id: string;
  title: string;
  recommend_paid: boolean;
  suggested_price: number | null;
}

export interface NoteThemeAutoPrisma extends AnpAutopassPrisma {
  noteAccount: {
    findMany: (args: {
      where: { status: string };
      select: { id: true; niche: true; target_reader: true; tone: true; settings_json?: true; editorial_policy?: true };
      orderBy: { created_at: 'asc' };
    }) => Promise<NoteAccountRow[]>;
  };
  noteTheme: {
    findMany: (args: {
      where: { note_account_id: string; status: string; created_at: { gte: Date } };
      select: { title: true };
      take?: number;
    }) => Promise<Array<{ title: string }>>;
    create: (args: {
      data: {
        note_account_id: string;
        title: string;
        hook: string;
        target_reader: string | null;
        recommend_paid: boolean;
        suggested_price: number | null;
        competitors_json: unknown;
        genre: string;
        status: string;
      };
      select: {
        id: true;
        note_account_id: true;
        title: true;
        recommend_paid: true;
        suggested_price: true;
      };
    }) => Promise<CreatedTheme>;
    updateMany: (args: {
      where: { id: string; status: string };
      data: { status: string };
    }) => Promise<{ count: number }>;
  };
  noteArticle: {
    create: (args: {
      data: {
        note_account_id: string;
        theme_id: string;
        title: string;
        paid: boolean;
        price_jpy: number | null;
        status: string;
      };
      select: { id: true };
    }) => Promise<{ id: string }>;
  };
  job: {
    create: (args: {
      data: {
        kind: string;
        status: string;
        started_at?: Date;
        payload_json?: unknown;
      };
    }) => Promise<{ id: string }>;
    update: (args: {
      where: { id: string };
      data: { status?: string; finished_at?: Date; error?: string | null; result_json?: unknown };
    }) => Promise<unknown>;
  };
}

export type AddJobLike = (
  identifier: string,
  payload: unknown,
  spec?: Record<string, unknown>,
) => Promise<unknown>;

export interface NoteThemeAutoDeps {
  prisma?: NoteThemeAutoPrisma;
  logger?: Logger;
  addJob?: AddJobLike;
  now?: () => Date;
  generateThemes?: (input: NoteThemeInput) => Promise<NoteThemeOutput>;
}

export interface NoteThemeAutoAccountResult {
  note_account_id: string;
  generated: number;
  accepted: number;
  error?: string;
}

export interface NoteThemeAutoResult {
  enabled: boolean;
  accounts_processed: number;
  themes_generated: number;
  articles_created: number;
  accounts: NoteThemeAutoAccountResult[];
}

export async function runNoteThemeAuto(deps: NoteThemeAutoDeps = {}): Promise<NoteThemeAutoResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_THEME_AUTO_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteThemeAutoPrisma);
  const now = deps.now ?? (() => new Date());
  const generateThemes = deps.generateThemes ?? defaultGenerateNoteThemes;
  const addJob = deps.addJob;

  const settings = await readAnpAutopass(prisma);
  if (!settings.anp_auto_theme_enabled) {
    log.info({ task: NOTE_THEME_AUTO_TASK_NAME }, 'anp auto theme disabled — skip');
    return { enabled: false, accounts_processed: 0, themes_generated: 0, articles_created: 0, accounts: [] };
  }

  if (settings.anp_autopass_enabled && !addJob) {
    throw new Error(`${NOTE_THEME_AUTO_TASK_NAME}: addJob must be provided when anp_autopass_enabled=true`);
  }

  const accounts = await prisma.noteAccount.findMany({
    where: { status: 'active' },
    select: { id: true, niche: true, target_reader: true, tone: true, settings_json: true, editorial_policy: true },
    orderBy: { created_at: 'asc' },
  });

  let themesGenerated = 0;
  let articlesCreated = 0;
  const accountResults: NoteThemeAutoAccountResult[] = [];

  for (const account of accounts) {
    // [F-ANP-17] アカウント別設定でグローバル既定値を上書き (未指定キーはグローバルに従う)。
    // グローバル anp_auto_theme_enabled=false の間はこの関数自体が早期 return するため
    // (上記)、ここで有効化できるのは「グローバル ON の中で特定アカウントだけ OFF にする」
    // 方向のみ (docs/11-anp-design.md §7 申し送り参照)。
    const effective = resolveThemeAutoSettings(account.settings_json, settings);
    if (!effective.auto_theme_enabled) {
      log.info({ task: NOTE_THEME_AUTO_TASK_NAME, noteAccountId: account.id }, 'account-level auto_theme disabled — skip');
      accountResults.push({ note_account_id: account.id, generated: 0, accepted: 0 });
      continue;
    }

    try {
      const since = new Date(now().getTime() - EXCLUDE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
      const recentAccepted = await prisma.noteTheme.findMany({
        where: { note_account_id: account.id, status: 'accepted', created_at: { gte: since } },
        select: { title: true },
        take: EXCLUDE_TITLES_HARD_LIMIT,
      });

      const genJob = await prisma.job.create({
        data: {
          kind: NOTE_THEME_GENERATE_TASK_NAME,
          status: 'running',
          started_at: now(),
          payload_json: {
            note_account_id: account.id,
            count: effective.themes_per_day,
            trigger: 'autopass',
          },
        },
      });

      const input: NoteThemeInput = {
        note_account_id: account.id,
        job_id: genJob.id,
        account: { niche: account.niche, target_reader: account.target_reader, tone: account.tone, editorial_policy: account.editorial_policy ?? null },
        count: effective.themes_per_day,
        exclude_titles_recent: recentAccepted.map((r) => r.title),
      };

      let result: NoteThemeOutput;
      try {
        result = await generateThemes(input);
      } catch (err) {
        await prisma.job.update({
          where: { id: genJob.id },
          data: { status: 'failed', finished_at: now(), error: serializeError(err) },
        });
        throw err;
      }

      const createdThemes: CreatedTheme[] = [];
      for (const c of result.candidates) {
        const row = await prisma.noteTheme.create({
          data: {
            note_account_id: account.id,
            title: c.title,
            hook: c.hook,
            target_reader: c.target_reader ?? null,
            recommend_paid: c.recommend_paid,
            suggested_price: c.suggested_price ?? null,
            competitors_json: c.competitors ?? [],
            genre: c.genre,
            status: 'pending',
          },
          select: { id: true, note_account_id: true, title: true, recommend_paid: true, suggested_price: true },
        });
        createdThemes.push(row);
      }
      themesGenerated += createdThemes.length;

      await prisma.job.update({
        where: { id: genJob.id },
        data: {
          status: 'done',
          finished_at: now(),
          error: null,
          result_json: { note_account_id: account.id, candidate_count: createdThemes.length, trigger: 'autopass' },
        },
      });

      let accepted = 0;
      if (effective.autopass_enabled && addJob) {
        for (const theme of createdThemes) {
          try {
            const guard = await prisma.noteTheme.updateMany({
              where: { id: theme.id, status: 'pending' },
              data: { status: 'accepted' },
            });
            if (guard.count === 0) continue;

            const article = await prisma.noteArticle.create({
              data: {
                note_account_id: account.id,
                theme_id: theme.id,
                title: theme.title,
                paid: theme.recommend_paid,
                price_jpy: theme.suggested_price ?? null,
                status: 'queued',
              },
              select: { id: true },
            });

            const outlineJob = await prisma.job.create({
              data: {
                kind: PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
                status: 'queued',
                payload_json: { note_article_id: article.id },
              },
            });
            await addJob(
              PIPELINE_NOTE_WRITER_OUTLINE_TASK_NAME,
              { note_article_id: article.id, job_id: outlineJob.id },
              { maxAttempts: 3 },
            );

            accepted += 1;
            articlesCreated += 1;
          } catch (acceptErr) {
            log.warn(
              { task: NOTE_THEME_AUTO_TASK_NAME, noteAccountId: account.id, themeId: theme.id, err: acceptErr },
              'auto-accept theme failed — continuing with next theme',
            );
          }
        }
      }

      accountResults.push({ note_account_id: account.id, generated: createdThemes.length, accepted });
    } catch (err) {
      log.warn(
        { task: NOTE_THEME_AUTO_TASK_NAME, noteAccountId: account.id, err },
        'note.theme.auto failed for account — continuing with next account',
      );
      accountResults.push({ note_account_id: account.id, generated: 0, accepted: 0, error: serializeError(err) });
    }
  }

  log.info(
    { task: NOTE_THEME_AUTO_TASK_NAME, accounts: accounts.length, themesGenerated, articlesCreated },
    'note.theme.auto tick done',
  );

  return {
    enabled: true,
    accounts_processed: accounts.length,
    themes_generated: themesGenerated,
    articles_created: articlesCreated,
    accounts: accountResults,
  };
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export const noteThemeAutoTask: Task = async (_payload: unknown, helpers: JobHelpers) => {
  await runNoteThemeAuto({ addJob: helpers.addJob as unknown as AddJobLike });
};
