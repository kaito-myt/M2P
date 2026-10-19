import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { decryptKdpCredentials } from '@a2p/crypto';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import type { GrowthScoutOutput } from '@a2p/contracts/agents/growth-scout';
import { prisma as defaultPrisma } from '@a2p/db';
import { generateGrowthTodo as defaultGenerate } from '@a2p/agents';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';
import { notifyNoteSessionExpired, type NoteAuthRelayPrisma } from './lib/note-auth-relay.js';
import { resolveKdpProxy } from './sales-fetch/kdp-proxy.js';
import { createPlaywrightNoteEngagePort } from './note-engage/playwright-note-engage-port.js';
import {
  allocateRunQuotas,
  buildHarvestQueries,
  canRunScout,
  classifyBlock,
  engageDaysSinceStart,
  followDailyCap,
  harvestToTargets,
  likeDailyCap,
  pickNoteTargets,
  readEngageState,
  rotateAccounts,
  engageDay,
  engageUsageToday,
  type NoteEngageOutcome,
  type NoteEngagePort,
  type NoteEngageTarget,
} from './note-engage/note-engage-port.js';

/**
 * `note.engage` タスク (F-091) — note ブラウザ自動フォロー & スキ(いいね)。
 *
 * IG/TikTok の `promotion.sns.engage` (F-077) を忠実に踏襲。note もフォロー/スキの公式 API が
 * 無いため、運営者が一度取り込んだログイン済みセッション(NoteAccount.session_state_enc)を
 * Playwright で再利用し、growth_scout が web_search で特定した「note 上のフォロー/スキすべき
 * 実在アカウント/記事」を自動操作する。凍結リスクに配慮し:
 *   - マスタスイッチ `note_engage_enabled`(既定 ON、キルスイッチ)
 *   - ランプアップ(アカウントごと) + 1回少量(フォロー最大8・スキ最大12) + ジッター(人間的な間)
 *   - 対象は note.com 本体の検索から収穫(主系統)。収穫が使えないときだけ growth_scout にフォールバック
 *   - 冪等(promotion_sns_engagements で重複防止) + セッション切れ/ブロック検知で即停止&LINE通知
 * データセンターIP対策として住宅プロキシ(app_settings.kdp_proxy_*)が生きていれば経由する。
 *
 * 記録は既存 `promotion_sns_engagements` を流用: channel='note', action_type='follow'|'like'。
 */

export const NOTE_ENGAGE_TASK_NAME = 'note.engage';

/** promotion_sns_engagements 上の note 用チャンネル値。 */
const NOTE_CHANNEL = 'note';
/** 収穫するカード数の上限 (1アカウント・1回)。必要数に対し重複/既済の除外分の余裕を見る。 */
const HARVEST_LIMIT = 80;
const H = 3600_000;

export const NoteEngagePayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  /** 対象アカウント限定(省略時は active 全件)。 */
  note_account_id: z.string().min(1).optional(),
  /** テスト/手動: 当日上限を無視して override 件ずつ(follow/like 各)実行。 */
  override_cap: z.number().int().min(0).max(30).optional(),
});

export interface NoteEngagePrisma {
  appSettings: { findUnique: (args: unknown) => Promise<{ note_engage_enabled: boolean } | null> };
  noteAccount: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        niche: string;
        display_name: string;
        target_reader?: string | null;
        handle?: string | null;
        settings_json?: unknown;
        session_state_enc?: string | null;
      }>
    >;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  promotionSnsEngagement: {
    findMany: (args: unknown) => Promise<Array<{ channel: string; action_type: string; target_handle: string }>>;
    count: (args: unknown) => Promise<number>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  noteAuthRequest: NoteAuthRelayPrisma['noteAuthRequest'];
  job?: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    /** cron 起動 (payload なし) のとき観測用の行を自分で作る。 */
    create?: (args: { data: Record<string, unknown>; select: { id: true } }) => Promise<{ id: string }>;
  };
}

export interface NoteEngageDeps {
  prisma?: NoteEngagePrisma;
  logger?: Logger;
  now?: () => Date;
  port?: NoteEngagePort;
  decryptSession?: (enc: string) => string;
  generate?: (input: {
    concept?: string | null;
    target_audience?: string | null;
    daily_target?: number;
  }) => Promise<GrowthScoutOutput>;
  resolveProxy?: () => Promise<{ server: string; username?: string; password?: string } | null>;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
}

export interface NoteEngageResult {
  enabled: boolean;
  per_account: Record<
    string,
    {
      follow_cap: number;
      like_cap: number;
      /** この実行に割り当てられた枠 (日次キャップではなく、均等割り+1回上限後)。 */
      follow_quota: number;
      like_quota: number;
      followed: number;
      liked: number;
      already: number;
      failed: number;
      /**
       * 失敗理由ごとの件数 (`like_button_not_found` / `like_not_registered` / `follow_not_confirmed` など)。
       * 2026-10-19: 理由を捨てていたため「19 件失敗」しか分からず、スキが実装以来 1 件も
       * 成立していなかったことに気づけなかった。件数だけでなく理由を必ず残す。
       */
      failed_reasons?: Record<string, number>;
      blocked?: string;
    }
  >;
  skipped: string[];
}

export async function runNoteEngage(payload: unknown, deps: NoteEngageDeps = {}): Promise<NoteEngageResult> {
  const log = deps.logger ?? createLogger(`worker.${NOTE_ENGAGE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as NoteEngagePrisma);
  const now = deps.now ?? (() => new Date());
  const port = deps.port ?? createPlaywrightNoteEngagePort();
  // `note_accounts.session_state_enc` は ANP の連携画面が **KDP_CRED_KEY** で暗号化して書く
  // (`apps/anp/app/actions/accounts.ts` の `encryptKdpCredentials`)。
  // ここは 2026-10-15 まで `decryptApiKey` (API_CRED_KEY) を使っていたため、
  // **全アカウントが毎回 `session_decrypt_failed` でスキップ**= F-091 は一度も動いていなかった。
  // 同じ列を読む `pipeline.note.publish` は `decryptKdpCredentials` なので公開だけは動いていた。
  const decrypt = deps.decryptSession ?? ((enc: string) => decryptKdpCredentials(enc));
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const resolveProxy =
    deps.resolveProxy ?? (() => resolveKdpProxy(defaultPrisma as unknown as Parameters<typeof resolveKdpProxy>[0], now));
  const generate =
    deps.generate ??
    ((input: { concept?: string | null; target_audience?: string | null; daily_target?: number }) =>
      defaultGenerate(
        {
          channel: NOTE_CHANNEL,
          concept: input.concept ?? '',
          target_audience: input.target_audience ?? '',
          daily_target: input.daily_target ?? 15,
          recent_posts: [],
        },
        // docs/05 §3.3 — growth_scout は共有エージェント。このタスクは ANP (note 本体) の
        // 活動なので、コストは ANP に帰属させる。channel='note' だけでは判別できない
        // (A2P も書籍紹介 note 記事を販促チャンネルとして持つ) ので明示する。
        { tool: 'anp' },
      ));

  const parsed = NoteEngagePayloadSchema.safeParse(payload);
  const parsedJobId = parsed.success ? parsed.data.job_id : undefined;
  const onlyAccount = parsed.success ? parsed.data.note_account_id : undefined;
  const overrideCap = parsed.success ? parsed.data.override_cap : undefined;

  const result: NoteEngageResult = { enabled: false, per_account: {}, skipped: [] };

  // cron 起動 (`note-engage`) は payload を持たないので `job_id` が無く、内部 `Job` 行が
  // 1 行も作られていなかった = **定期実行の成功も失敗も UI (jobs) に一切出ない**。
  // 運営者が「フォロワーを増やす活動」として依頼した機能なので、黙って止まるのは困る
  // (2026-10-15 に `note.account.research` で同じ穴を直した。docs/05 F-ANP-56 / F-076)。
  let jobId = parsedJobId;
  if (!jobId && prisma.job?.create) {
    try {
      const created = await prisma.job.create({
        data: { kind: NOTE_ENGAGE_TASK_NAME, status: 'running', started_at: now(), payload_json: { trigger: 'cron' } },
        select: { id: true },
      });
      jobId = created.id;
    } catch (err) {
      // 観測用の行が作れないだけで本体は止めない。
      log.warn({ task: NOTE_ENGAGE_TASK_NAME, err }, '観測用の内部 Job 行を作れなかった');
    }
  }

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { note_engage_enabled: true },
    });
    // note_engage_enabled が明示的に false のときだけ停止(未設定/取得不可は既定 ON 扱い)。
    if (settings?.note_engage_enabled === false && overrideCap === undefined) {
      return await finalize(result);
    }
    result.enabled = true;

    const proxy = (await resolveProxy().catch(() => null)) ?? undefined;

    const accounts = await prisma.noteAccount.findMany({
      where: {
        status: 'active',
        session_state_enc: { not: null },
        ...(onlyAccount ? { id: onlyAccount } : {}),
      },
      select: {
        id: true,
        niche: true,
        display_name: true,
        target_reader: true,
        handle: true,
        settings_json: true,
        session_state_enc: true,
      },
      orderBy: { created_at: 'asc' },
      take: 50,
    } as unknown);

    if (accounts.length === 0) {
      result.skipped.push('no_active_account_with_session');
      return await finalize(result);
    }

    // 自分自身の除外は **status 無条件で全アカウント**から作る。active+session に絞ると、手動実行時や
    // このタスクが paused にした相方が外れ、ANP が今日公開した相方の記事 (sort=new の最前列) を
    // フォロー/スキしてしまう。
    const allHandleRows = await prisma.noteAccount.findMany({
      where: { handle: { not: null } },
      select: { id: true, handle: true },
      take: 200,
    } as unknown);
    const selfHandles = [...allHandleRows, ...accounts].map((a) => a.handle ?? '').filter(Boolean);
    const isSelf = (handle: string) =>
      selfHandles.some((sh) => sh.replace(/^@/, '').toLowerCase() === handle.replace(/^@/, '').toLowerCase());

    const dayStart = new Date(now().getTime() - 24 * H);

    // 24h の使用済みは note チャンネル全体の合算しか取れない (テーブルにアカウント列が無い)。
    // そのため残り予算を **先にアカウント数で均等割り**し、アカウントを日替わりで回す。
    // 以前は合算を各アカウントの枠として読んでいたため先頭の note-acc-1 が枠を食い切り、
    // 2 番目 (競馬) は常に 0 でフォローが一度も成立しなかった (2026-10-19 実測)。
    const followToday = await prisma.promotionSnsEngagement.count({
      where: { channel: NOTE_CHANNEL, action_type: 'follow', status: { in: ['done', 'already'] }, created_at: { gte: dayStart } },
    });
    const likeToday = await prisma.promotionSnsEngagement.count({
      where: { channel: NOTE_CHANNEL, action_type: 'like', status: { in: ['done', 'already'] }, created_at: { gte: dayStart } },
    });
    const ordered = rotateAccounts(accounts, now());
    // ランプアップはアカウント単位 (settings_json.engage_ramp_started_at)。チャンネル最古行起点だと
    // 全期間フォロー 0 件の競馬アカが初日から 20/30 に入り、段階を飛ばしてしまう。
    const states = ordered.map((a) => readEngageState(a.settings_json));
    const followCaps = states.map((s) => overrideCap ?? followDailyCap(engageDaysSinceStart(s, now())));
    const likeCaps = states.map((s) => overrideCap ?? likeDailyCap(engageDaysSinceStart(s, now())));
    const usages = states.map((st) => engageUsageToday(st, now()));
    const quotas = allocateRunQuotas({
      followCaps,
      likeCaps,
      followUsage: usages.map((u) => u.follow),
      likeUsage: usages.map((u) => u.like),
      followUsed: followToday,
      likeUsed: likeToday,
    });

    // 既エンゲージ集合は **ループの外で 1 回**。新レートでは数週間で 5000 行を超えるので、
    // orderBy なし + take 5000 だと任意の 5000 行になり重複防止が静かに崩れる。新しい順に十分な件数を取る。
    const ENGAGED_TAKE = 50_000;
    const engagedRows = await prisma.promotionSnsEngagement.findMany({
      where: { channel: NOTE_CHANNEL },
      select: { channel: true, action_type: true, target_handle: true },
      orderBy: { created_at: 'desc' },
      take: ENGAGED_TAKE,
    } as unknown);
    if (engagedRows.length >= ENGAGED_TAKE) result.skipped.push('engaged_set_truncated');
    const engaged = new Set(engagedRows.map((r) => `${r.action_type}:${r.target_handle.toLowerCase()}`));

    for (const [idx, account] of ordered.entries()) {
      if (!account.session_state_enc) {
        result.skipped.push(`${account.id}:no_session`);
        continue;
      }

      const remainingFollow = quotas[idx]?.follow ?? 0;
      const remainingLike = quotas[idx]?.like ?? 0;
      const state = states[idx] ?? {};
      const cell = {
        follow_cap: followCaps[idx] ?? 0,
        like_cap: likeCaps[idx] ?? 0,
        follow_quota: remainingFollow,
        like_quota: remainingLike,
        followed: 0,
        liked: 0,
        already: 0,
        failed: 0 as number,
        failed_reasons: {} as Record<string, number>,
        blocked: undefined as string | undefined,
      };
      result.per_account[account.id] = cell;
      if (remainingFollow <= 0 && remainingLike <= 0) {
        // 無言で continue しない: 運営者が jobs 画面で「なぜ 0 件か」を読めるようにする。
        result.skipped.push(`${account.id}:cap_exhausted`);
        continue;
      }

      // セッション復号は **収穫/growth_scout より前**に行う (2026-10-15)。
      // 復号できないアカウントのために ¥40/回 (web 検索つき) の偵察を払ってから捨てていた。
      // 実際 2026-10-13 までこの順序で **¥4,700/月を払いながらフォロー/スキは 0 件**だった
      // (原因は鍵違い — ANP は KDP_CRED_KEY で書くのにここは API_CRED_KEY で読んでいた)。
      let sessionState: string;
      try {
        sessionState = decrypt(account.session_state_enc);
      } catch {
        result.skipped.push(`${account.id}:session_decrypt_failed`);
        continue;
      }

      // 主系統: ログイン済みセッションで note.com 自体を見て実在の著者/記事を収穫し、そのまま操作する
      // (1 ブラウザセッション = スロット取得 1 回)。
      let outcomes: NoteEngageOutcome[] = [];
      let blocked: string | undefined;
      let pageOpened = true;
      let selected = 0;
      const queries = buildHarvestQueries(account.niche || account.display_name, account.target_reader);
      if (port.harvestAndEngage && queries.length > 0) {
        try {
          const r = await port.harvestAndEngage({
            sessionState,
            queries,
            limit: HARVEST_LIMIT,
            maxFollow: remainingFollow,
            maxLike: remainingLike,
            proxy,
            selectTargets: (cards) => harvestToTargets(cards, engaged, selfHandles, remainingFollow, remainingLike),
          });
          outcomes = r.outcomes;
          blocked = r.blocked;
          pageOpened = r.harvest.pageOpened;
          selected = r.harvest.selected;
        } catch (err) {
          // ブラウザ枠の競合 (BrowserSlotTimeoutError) 等。タスク全体を落とすと graphile の再試行で
          // 収穫/課金がやり直しになるので、このアカウントだけ飛ばす。scout にも回さない。
          log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId: account.id, err }, 'ブラウザセッション失敗 — このアカウントはスキップ');
          result.skipped.push(`${account.id}:browser_unavailable`);
          continue;
        }
      }

      // 補助: ページを開けて読めた上で使える収穫が 0 件のときだけ growth_scout (¥40/回, web 検索つき)。
      // 例外/ブロックで読めていないとき・1 アカウント 1 日 (JST) 1 回を超えるときは呼ばない
      // (cron 8 回 × 2 アカウント × ¥40 ≒ ¥19,200/月 の露出を作らない)。
      if (!blocked && selected === 0 && outcomes.length === 0) {
        if (!pageOpened) {
          result.skipped.push(`${account.id}:harvest_unreadable`);
          continue;
        }
        if (!canRunScout(state, now())) {
          result.skipped.push(`${account.id}:no_targets`, `${account.id}:scout_daily_limit`);
          continue;
        }
        // 失敗しても課金は発生しうるので、呼ぶ前に当日分を消費済みにする。
        await patchState(account.id, { engage_scout_date: engageDay(now()) });
        let targets: NoteEngageTarget[] = [];
        try {
          const out: GrowthScoutOutput = await generate({
            concept: account.niche || account.display_name,
            target_audience: account.target_reader ?? '',
            daily_target: 15,
          });
          targets = pickNoteTargets(out.actions, engaged, remainingFollow, remainingLike).filter((t) => !isSelf(t.handle));
        } catch (err) {
          log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId: account.id, err }, 'growth_scout 生成失敗 — スキップ');
          result.skipped.push(`${account.id}:scout_failed`);
          continue;
        }
        if (targets.length === 0) {
          result.skipped.push(`${account.id}:harvest_empty_fallback_empty`);
          continue;
        }
        try {
          const r = await port.engageAll({
            sessionState,
            targets,
            maxFollow: remainingFollow,
            maxLike: remainingLike,
            proxy,
          });
          outcomes = r.outcomes;
          blocked = r.blocked;
        } catch (err) {
          log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId: account.id, err }, 'ブラウザセッション失敗 — このアカウントはスキップ');
          result.skipped.push(`${account.id}:browser_unavailable`);
          continue;
        }
      }

      for (const o of outcomes) {
        if (o.status === 'done') {
          if (o.action === 'follow') cell.followed += 1;
          else cell.liked += 1;
        } else if (o.status === 'already') {
          cell.already += 1;
        } else {
          cell.failed += 1;
          // 理由を落とさない。エラー文は port 側の固定文字列か例外メッセージなので、
          // 無制限に増えないよう先頭 60 文字に切って集計する。
          const reason = `${o.action}:${(o.error ?? 'unknown').slice(0, 60)}`;
          cell.failed_reasons[reason] = (cell.failed_reasons[reason] ?? 0) + 1;
        }
        // 成功/既実行のみ記録(重複防止)。failed は再挑戦余地を残し記録しない。
        // (port 側は押下後に状態を読み直して done を返す — 実行していない行を残さない。)
        if (o.status === 'done' || o.status === 'already') {
          engaged.add(`${o.action}:${o.handle.toLowerCase()}`);
          await prisma.promotionSnsEngagement
            .upsert({
              where: {
                channel_action_type_target_handle: {
                  channel: NOTE_CHANNEL,
                  action_type: o.action,
                  target_handle: o.handle,
                },
              },
              create: { channel: NOTE_CHANNEL, action_type: o.action, target_handle: o.handle, target_url: o.url, status: o.status },
              update: { status: o.status, target_url: o.url },
            } as unknown)
            .catch(() => {});
        }
      }

      // 当日使用数 (アカウント別の日次キャップの根拠) と、初めて実際に成功したときのランプアップ起点を記録する。
      if (cell.followed + cell.liked > 0) {
        const u = usages[idx] ?? { follow: 0, like: 0 };
        await patchState(account.id, {
          engage_usage: { day: engageDay(now()), follow: u.follow + cell.followed, like: u.like + cell.liked },
          ...(state.engage_ramp_started_at ? {} : { engage_ramp_started_at: now().toISOString() }),
        });
      }

      if (blocked) {
        cell.blocked = blocked;
        const kind = classifyBlock(blocked);
        await handleBlocked(account, blocked);
        if (kind === 'technical') result.skipped.push(`${account.id}:${blocked}`);
        // レート制限なら他アカウントも今回は止める(同一IP/プロファイル影響回避)。
        // セッション切れ/環境要因はそのアカウント固有なので次のアカウントは続行する。
        if (kind === 'rate_limit') break;
      }
    }

    // 実行サマリ通知。
    const totals = Object.values(result.per_account).reduce(
      (s, c) => ({ followed: s.followed + c.followed, liked: s.liked + c.liked, already: s.already + c.already }),
      { followed: 0, liked: 0, already: 0 },
    );
    if ((totals.followed > 0 || totals.liked > 0) && lineConfigured()) {
      await alert(`🤝 note 自動エンゲージ実行: フォロー${totals.followed} / スキ${totals.liked} / 既${totals.already}`);
    }

    log.info({ task: NOTE_ENGAGE_TASK_NAME, ...result }, 'note.engage done');
    return await finalize(result);
  } catch (err) {
    if (jobId && prisma.job) {
      try {
        await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } });
      } catch {
        /* noop */
      }
    }
    log.warn({ task: NOTE_ENGAGE_TASK_NAME, err }, 'note.engage failed');
    throw err;
  }

  async function handleBlocked(account: { id: string; display_name: string }, blocked: string): Promise<void> {
    const kind = classifyBlock(blocked);
    if (kind === 'session') {
      // F-ANP-21 認証リレー: セッション失効はアカウントを一時停止し、再取込コマンド付きで通知する
      // (pipeline.note.publish/note.sales.fetch/note.publish.status.sync と同型)。
      await prisma.noteAccount.update({ where: { id: account.id }, data: { status: 'paused' } }).catch(() => {});
      await notifyNoteSessionExpired(prisma, account.id, account.display_name, pushAlert);
    } else if (kind === 'rate_limit') {
      await alert('note 自動フォロー/スキでレート制限らしき表示を検知したため、この回は中止しました(次回の実行で再開します)。');
    } else {
      // ブラウザ/環境の問題 (playwright_unavailable / context_error / session_check_failed 等)。
      // 凍結とは無関係なので LINE は送らず、log と result.skipped にだけ残す。
      log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId: account.id, blocked }, 'note.engage 環境要因で中断');
    }
  }

  /** settings_json のアカウント別エンゲージ状態を読み直してマージ保存する (他キーを壊さない)。 */
  async function patchState(accountId: string, patch: Record<string, unknown>): Promise<void> {
    try {
      const rows = await prisma.noteAccount.findMany({
        where: { id: accountId },
        select: { id: true, settings_json: true },
        take: 1,
      } as unknown);
      const cur = rows.find((r) => r.id === accountId)?.settings_json;
      const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};
      await prisma.noteAccount.update({ where: { id: accountId }, data: { settings_json: { ...base, ...patch } } });
    } catch (err) {
      log.warn({ task: NOTE_ENGAGE_TASK_NAME, accountId, err }, 'settings_json の更新に失敗');
    }
  }

  async function alert(text: string): Promise<void> {
    if (lineConfigured()) await pushAlert(text).catch(() => false);
  }

  async function finalize(r: NoteEngageResult): Promise<NoteEngageResult> {
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: r } });
    }
    return r;
  }
}

export const noteEngageTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runNoteEngage(payload);
};
