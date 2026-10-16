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

import {
  fetchEyecatchStyleByArticle,
  type EyecatchStyleHistoryPrisma,
} from './lib/eyecatch-style-history.js';

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

/** 1 アカウントの失敗。運営者が原因に辿り着けるよう Job 行へ残す。 */
export interface NoteAccountResearchFailure {
  note_account_id: string;
  display_name: string;
  error: string;
}

export interface NoteAccountResearchRunResult {
  /** 対象アカウント数。 */
  accounts: number;
  /** 保存まで成功した件数。 */
  updated: number;
  /** 失敗した件数 (他アカウントは続行する)。 */
  failed: number;
  /**
   * 失敗したアカウントと理由。成功時は空配列。
   *
   * 2026-10-14: 競馬アカウントのまとめ段が出力上限で切れて失敗したとき、
   * Job 行に残ったのは「全 1 アカウントのリサーチが失敗しました」だけで、
   * 真因 (`出力が上限で切れた`) は Railway ログにしか無かった。運営者は
   * ANP ホームの「直近の失敗」を見て原因が分からず問い合わせることになった。
   * **一部失敗のときも** ここに残す (Job 自体は done になるので他に痕跡が無い)。
   */
  errors: NoteAccountResearchFailure[];
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
  let jobId = parsed.success ? parsed.data.job_id : undefined;
  // 自分で作った Job 行なら running への遷移は不要 (作成時点で running にする)。
  let ownsJob = false;

  // 週次 cron (`note-account-research-weekly`) は payload を持たないので `job_id` が無く、
  // 内部 Job 行が 1 行も作られていなかった。ANP ホームの「実行中」「直近の失敗」は
  // どちらも `jobs` を見るので、**毎週月曜の実行は成功も失敗も UI に一切出ない**
  // 状態だった (運営者が週次自動化として依頼した機能なので、黙って失敗するのは困る)。
  if (!jobId) {
    try {
      const created = await prisma.job.create({
        data: {
          kind: NOTE_ACCOUNT_RESEARCH_TASK_NAME,
          status: 'running',
          started_at: now(),
          payload_json: { ...(only ? { note_account_id: only } : {}), trigger: 'cron' },
        },
        select: { id: true },
      });
      jobId = created.id;
      ownsJob = true;
    } catch (err) {
      // 観測用の行が作れないだけでリサーチ本体を止めない。
      log.warn({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME, err }, '観測用の内部 Job 行を作れなかった');
    }
  }

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
  if (jobId && !ownsJob) {
    await prisma.job
      .update({ where: { id: jobId }, data: { status: 'running', started_at: now() } })
      .catch((err: unknown) => {
        log.warn({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME, jobId, err }, '内部 Job を running にできなかった');
      });
  }

  if (accounts.length === 0) {
    log.info({ task: NOTE_ACCOUNT_RESEARCH_TASK_NAME }, 'リサーチ対象の note アカウントが無い');
    const empty = { accounts: 0, updated: 0, failed: 0, errors: [] };
    await finishJob(prisma, log, jobId, now, empty);
    return empty;
  }

  let updated = 0;
  let failed = 0;
  const errors: NoteAccountResearchFailure[] = [];
  for (const account of accounts) {
    try {
      const recentArticles = await fetchRecentArticles(prisma, account.id, log);
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

      const { research: result, items, rivalShots } = await research(input);
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
          // F-ANP-57: 画作りの根拠として**実際に見た**競合サムネの枚数。
          // 0 なら art_direction は空のはず (空でないなら推測が混ざっている)。
          rivalShots,
          artDirection: validated.art_direction.length > 0,
          policySuggestion: validated.editorial_policy_suggestion.length > 0,
        },
        '週次リサーチを保存した',
      );
    } catch (err) {
      failed += 1;
      // 1 アカウントの失敗で週次リサーチ全体を落とさない。
      // 理由はログだけでなく Job 行にも残す (ログは運営者が見られない)。
      errors.push({
        note_account_id: account.id,
        display_name: account.display_name,
        error: err instanceof Error ? err.message : String(err),
      });
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

  const result = { accounts: accounts.length, updated, failed, errors };
  await finishJob(prisma, log, jobId, now, result);
  return result;
}

/**
 * 失敗理由を運営者向けの 1 行にする。
 *
 * ANP ホームの「直近の失敗」は `Job.error` をそのまま出すだけなので、
 * ここが「全 N アカウントのリサーチが失敗しました」だと原因に辿り着けない。
 * **どのアカウントが何で落ちたか**を必ず入れる。
 */
function describeFailures(result: NoteAccountResearchRunResult): string {
  if (result.errors.length === 0) {
    return `全 ${result.accounts} アカウントのリサーチが失敗しました`;
  }
  const detail = result.errors.map((e) => `${e.display_name}: ${e.error}`).join(' / ');
  return `全 ${result.accounts} アカウントのリサーチが失敗しました — ${detail}`;
}

/**
 * 観測用の内部 Job 行を done にする。
 * アカウント単位の失敗は result_json の failed 件数で表すので、
 * **全滅でなければ Job 自体は done** とする (週次 cron を赤くし続けない)。
 * ただし一部失敗の理由は `result_json.errors` に残す — done にしてしまうと
 * 他にどこにも痕跡が残らないため。
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
        // Prisma の InputJsonValue は interface をそのまま受けないので構造だけ渡す。
        result_json: { ...result } as unknown as object,
        ...(allFailed ? { error: describeFailures(result) } : { error: null }),
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
  log: Logger,
): Promise<NoteAccountResearchInput['recentArticles']> {
  const rows = await prisma.noteArticle.findMany({
    where: { note_account_id: noteAccountId, publish_status: 'published' },
    orderBy: { published_at: 'desc' },
    take: RECENT_ARTICLES,
    select: {
      id: true,
      title: true,
      paid: true,
      sales: { select: { views: true, likes: true, revenue_jpy: true } },
    },
  });
  // F-ANP-57: 記事ごとの画風キー。記録 (`jobs.result_json.style_key`) はしていたのに
  // リサーチへ渡していなかったので、「どのサムネで閲覧が付いたか」が一度も学習に
  // 入らず、画風の選択は記事 ID のハッシュによる実績と無関係なくじ引きのままだった
  // (2026-10-16 実測: 公開 140 本のうち 121 本に style_key が記録済み / 使用 0 本)。
  const styles = await fetchEyecatchStyleByArticle(
    prisma as unknown as EyecatchStyleHistoryPrisma,
    rows.map((r) => r.id),
    log,
  );
  return rows.map((r) => {
    const views = r.sales.reduce((a, s) => a + s.views, 0);
    const likes = r.sales.reduce((a, s) => a + s.likes, 0);
    const revenue = r.sales.reduce((a, s) => a + s.revenue_jpy, 0);
    const style = styles.get(r.id);
    return {
      title: r.title.slice(0, 300),
      ...(r.sales.length > 0 ? { views, likes } : {}),
      ...(revenue > 0 ? { sales_jpy: revenue } : {}),
      is_paid: r.paid,
      ...(style ? { eyecatch_style: style } : {}),
    };
  });
}

/** graphile-worker 用エクスポート。`buildTaskList()` から登録される。 */
export const noteAccountResearchTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteAccountResearch(payload);
};
