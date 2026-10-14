/**
 * `note.account.research` タスク (docs/11-anp-design.md F-ANP-56)。
 *
 * 運営者指示 (2026-10-14):
 *   「週次リサーチは ANP にも入れてね。アカウントごとにジャンルが違うから
 *     アカウントごとに観点を決めてリサーチすべきやね」
 *   「サムネ画像生成のプロンプトはアカウントごとに変わってくるはずです。
 *     週次リサーチの後にプロンプトも必要に応じて改変するようにしてね」
 *
 * 週 1 回、active な note アカウントそれぞれについて `anp.research` を回し、成果を
 * `note_accounts.research_json` に保存する。保存値は各 ANP エージェントのプロンプトへ
 * **実行時注入**される (アイキャッチの画作り / コピー規則 / 狙う・避ける題材)。
 *
 * 「プロンプトの改変」は**アカウント単位の注入値**として実現する。役割プロンプト本文
 * (`prompts` テーブル) は全アカウント共有なので、アカウント固有の指示を焼き込むと他の
 * アカウントに漏れる。A2P では prompt_editor がジャンル固有の書式を本文へ書き戻し、
 * 小説 17 冊の本文に見出しが混入する事故になった (2026-10-14, F-100)。同じ失敗はしない。
 *
 * `editorial_policy` (記事の方針・トンマナ) は運営者が UI で編集する設定なので、
 * **自動では書き換えず提案だけ** を `research_json.editorial_policy_suggestion` に残す。
 * 1 アカウントの失敗で他アカウントを止めない (アカウント単位で catch する)。
 */
import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { researchNoteAccount as defaultResearch } from '@a2p/agents';
import {
  NoteAccountResearchSchema,
  parseNoteAccountResearch,
  type NoteAccountResearch,
  type NoteAccountResearchInput,
} from '@a2p/contracts/agents/anp';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

export const NOTE_ACCOUNT_RESEARCH_TASK_NAME = 'note.account.research';

export const NoteAccountResearchPayloadSchema = z.object({
  /** 指定時はそのアカウントだけ。未指定なら active な全アカウント。 */
  note_account_id: z.string().min(1).optional(),
  /** 観測用の内部 Job 行 id (手動投入時)。 */
  job_id: z.string().min(1).optional(),
});

/** 実績として渡す直近記事の件数。多すぎるとプロンプトが膨らむ。 */
const RECENT_ARTICLES = 20;

export interface NoteAccountResearchDeps {
  prisma?: typeof defaultPrisma;
  research?: typeof defaultResearch;
  logger?: Logger;
  now?: () => Date;
}

export interface NoteAccountResearchRunResult {
  /** 対象アカウント数。 */
  accounts: number;
  /** 保存まで成功した件数。 */
  updated: number;
  /** 失敗した件数 (他アカウントは続行する)。 */
  failed: number;
}

export async function runNoteAccountResearch(
  payload: unknown,
  deps: NoteAccountResearchDeps = {},
): Promise<NoteAccountResearchRunResult> {
  const prisma = deps.prisma ?? defaultPrisma;
  const research = deps.research ?? defaultResearch;
  const log = deps.logger ?? createLogger(`worker.${NOTE_ACCOUNT_RESEARCH_TASK_NAME}`);
  const now = deps.now ?? (() => new Date());

  const parsed = NoteAccountResearchPayloadSchema.safeParse(payload ?? {});
  const only = parsed.success ? parsed.data.note_account_id : undefined;
  const jobId = parsed.success ? parsed.data.job_id : undefined;

  const accounts = await prisma.noteAccount.findMany({
    where: only ? { id: only } : { status: 'active' },
    select: {
      id: true,
      niche: true,
      display_name: true,
      target_reader: true,
      tone: true,
      editorial_policy: true,
      research_json: true,
    },
    orderBy: { created_at: 'asc' },
  });

  // 観測用の内部 Job 行を running にする。
  // 2026-10-14 初回実行時にこの遷移が無く、UI の多重起動ガード
  // (queued/running を数える) が永久に「実行中」と判定して「今すぐリサーチ」が
  // 二度と押せない状態になっていた。
  if (jobId) {
    await prisma.job
      .update({ where: { id: jobId }, data: { status: 'running', started_at: now() } })
      .catch((err: unknown) => {
        log.warn({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME, jobId, err }, '内部 Job を running にできなかった');
      });
  }

  if (accounts.length === 0) {
    log.info({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME }, 'リサーチ対象の note アカウントが無い');
    await finishJob(prisma, log, jobId, now, { accounts: 0, updated: 0, failed: 0 });
    return { accounts: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;
  for (const account of accounts) {
    try {
      const recentArticles = await fetchRecentArticles(prisma, account.id);
      const input: NoteAccountResearchInput = {
        noteAccountId: account.id,
        ...(jobId ? { jobId } : {}),
        account: {
          niche: account.niche,
          target_reader: account.target_reader ?? null,
          tone: account.tone ?? null,
          editorial_policy: account.editorial_policy ?? null,
        },
        recentArticles,
        previous: parseNoteAccountResearch(account.research_json),
      };

      const { research: result, items } = await research(input);
      // 保存前に再検証 (エージェント側で検証済みだが、DB に入る値は必ず契約通りにする)。
      const validated: NoteAccountResearch = NoteAccountResearchSchema.parse(result);

      await prisma.noteAccount.update({
        where: { id: account.id },
        data: {
          research_json: validated as unknown as object,
          research_updated_at: now(),
        },
      });
      updated += 1;
      log.info(
        {
          task: NOTE_ACCOUNT_RESEARCH_TASK_NAME,
          noteAccountId: account.id,
          account: account.display_name,
          angles: validated.angles.length,
          findings: validated.findings.length,
          sources: items.length,
          artDirection: validated.art_direction.length > 0,
          policySuggestion: validated.editorial_policy_suggestion.length > 0,
        },
        '週次リサーチを保存した',
      );
    } catch (err) {
      failed += 1;
      // 1 アカウントの失敗で週次リサーチ全体を落とさない。
      log.warn(
        {
          task: NOTE_ACCOUNT_RESEARCH_TASK_NAME,
          noteAccountId: account.id,
          account: account.display_name,
          err,
        },
        '週次リサーチに失敗 — 次のアカウントへ進む',
      );
    }
  }

  const result = { accounts: accounts.length, updated, failed };
  await finishJob(prisma, log, jobId, now, result);
  return result;
}

/**
 * 観測用の内部 Job 行を done にする。
 * アカウント単位の失敗は result_json の failed 件数で表すので、
 * **全滅でなければ Job 自体は done** とする (週次 cron を赤くし続けない)。
 */
async function finishJob(
  prisma: typeof defaultPrisma,
  log: Logger,
  jobId: string | undefined,
  now: () => Date,
  result: NoteAccountResearchRunResult,
): Promise<void> {
  if (!jobId) return;
  const allFailed = result.accounts > 0 && result.updated === 0;
  await prisma.job
    .update({
      where: { id: jobId },
      data: {
        status: allFailed ? 'failed' : 'done',
        finished_at: now(),
        result_json: { ...result },
        ...(allFailed ? { error: `全 ${result.accounts} アカウントのリサーチが失敗しました` } : { error: null }),
      },
    })
    .catch((err: unknown) => {
      log.warn({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME, jobId, err }, '内部 Job を完了にできなかった');
    });
}

/**
 * 観点決定の材料になる直近記事の実績。
 * 公開済みのものだけを見る (下書きは読まれた実績が無く、観点の判断材料にならない)。
 *
 * 閲覧/スキ/売上は月次の `note_sales_records` 側にあるので合算する
 * (`note.sales.fetch` が月ごとに 1 行ずつ入れる)。まだ取得されていない記事は
 * タイトルだけ渡す — 「公開したが数字が無い」も立ち上げ期の情報として意味がある。
 */
async function fetchRecentArticles(
  prisma: typeof defaultPrisma,
  noteAccountId: string,
): Promise<NoteAccountResearchInput['recentArticles']> {
  const rows = await prisma.noteArticle.findMany({
    where: { note_account_id: noteAccountId, publish_status: 'published' },
    orderBy: { published_at: 'desc' },
    take: RECENT_ARTICLES,
    select: {
      title: true,
      paid: true,
      sales: { select: { views: true, likes: true, revenue_jpy: true } },
    },
  });
  return rows.map((r) => {
    const views = r.sales.reduce((a, s) => a + s.views, 0);
    const likes = r.sales.reduce((a, s) => a + s.likes, 0);
    const revenue = r.sales.reduce((a, s) => a + s.revenue_jpy, 0);
    return {
      title: r.title.slice(0, 300),
      ...(r.sales.length > 0 ? { views, likes } : {}),
      ...(revenue > 0 ? { sales_jpy: revenue } : {}),
      is_paid: r.paid,
    };
  });
}

/** graphile-worker 用エクスポート。`buildTaskList()` から登録される。 */
export const noteAccountResearchTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountResearch(payload);
};
