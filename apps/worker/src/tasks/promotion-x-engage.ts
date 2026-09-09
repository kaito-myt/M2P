import type { JobHelpers, Task } from 'graphile-worker';
import { z } from 'zod';

import { buildXAuthHeader, decryptApiKey, parseXCredentials } from '@a2p/crypto';
import { createLogger, type Logger } from '@a2p/contracts/logger';
import { prisma as defaultPrisma } from '@a2p/db';

import { isLineRelayConfigured, pushLine } from './lib/line-auth-relay.js';

/**
 * `promotion.x.engage` タスク (F-076, 2026-08-17) — X の能動エンゲージメント自動化。
 *
 * 「投稿するだけ(虚空に発信)」ではフォロワーは増えない。本タスクが X 公式API(OAuth1)で
 * ニッチ(読書/本)の投稿を検索→**いいね＋著者フォロー**を能動実行し、発見・相互フォローを狙う。
 * 運営者の指示は「積極」。ただし新規小規模アカウントの急激な自動化は凍結リスクが最大のため、
 * **ランプアップ**(初日は控えめ→数日かけて上限へ)＋1回あたり少量＋ジッター＋重複防止＋
 * 429/403検知で即停止&LINE通知、というガードを入れる。マスタスイッチ `x_engage_enabled`(既定OFF)。
 */

export const PROMOTION_X_ENGAGE_TASK_NAME = 'promotion.x.engage';

const X_ME_URL = 'https://api.twitter.com/2/users/me';
const X_SEARCH_URL = 'https://api.twitter.com/2/tweets/search/recent';
const DEFAULT_QUERY = '(読書 OR 読了 OR 本好き OR 積読 OR 本のある暮らし) lang:ja -is:retweet -is:reply';
const PER_RUN_MAX = 6; // 1回の実行での最大アクション数(cronで1日数回に分散)
const MAX_FOLLOWERS = 30000; // これより大きいアカウントは反応が返りにくいのでフォロー対象外
const H = 3600_000;

export const PromotionXEngagePayloadSchema = z.object({
  job_id: z.string().min(1).optional(),
  /** テスト/手動: 当日上限を無視して最大 override 件だけ実行。 */
  override_cap: z.number().int().min(0).max(50).optional(),
});

/** ランプアップ: 稼働開始からの経過日数 → 当日フォロー/いいね上限(積極設定)。 */
export function dailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 8;
  if (daysSinceStart <= 4) return 15;
  if (daysSinceStart <= 9) return 22;
  return 30; // 積極の巡航上限
}

interface Candidate {
  tweetId: string;
  authorId: string;
  authorHandle: string;
  authorFollowers: number;
}

/** 検索結果(tweets + users) → エンゲージ候補。大手/自分/エンゲージ済みを除外。 */
export function pickCandidates(
  tweets: Array<{ id: string; author_id?: string }>,
  usersById: Map<string, { username: string; followers: number }>,
  myId: string,
  alreadyEngaged: Set<string>,
  maxFollowers = MAX_FOLLOWERS,
): Candidate[] {
  const out: Candidate[] = [];
  const seenAuthors = new Set<string>();
  for (const t of tweets) {
    const authorId = t.author_id;
    if (!authorId || authorId === myId) continue;
    if (seenAuthors.has(authorId)) continue; // 1著者1件
    const u = usersById.get(authorId);
    if (!u) continue;
    if (u.followers > maxFollowers) continue; // 大手は除外
    if (alreadyEngaged.has(`follow:${authorId}`) && alreadyEngaged.has(`like:${t.id}`)) continue;
    seenAuthors.add(authorId);
    out.push({ tweetId: t.id, authorId, authorHandle: u.username, authorFollowers: u.followers });
  }
  return out;
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface PromotionXEngagePrisma {
  appSettings: { findUnique: (args: unknown) => Promise<{ x_engage_enabled: boolean } | null> };
  promotionChannelSetting: {
    findUnique: (args: { where: { channel: string }; select: { token_enc: true } }) => Promise<{ token_enc: string | null } | null>;
  };
  promotionXEngagement: {
    findMany: (args: unknown) => Promise<Array<{ action_type: string; target_id: string }>>;
    count: (args: unknown) => Promise<number>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  job?: { update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown> };
}

export interface PromotionXEngageDeps {
  prisma?: PromotionXEngagePrisma;
  logger?: Logger;
  now?: () => Date;
  doFetch?: FetchLike;
  decryptToken?: (enc: string) => string;
  pushAlert?: (text: string) => Promise<boolean>;
  lineConfigured?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface PromotionXEngageResult {
  enabled: boolean;
  cap: number;
  already_today: number;
  followed: number;
  liked: number;
  skipped_reason?: string;
}

export async function runPromotionXEngage(
  payload: unknown,
  deps: PromotionXEngageDeps = {},
): Promise<PromotionXEngageResult> {
  const log = deps.logger ?? createLogger(`worker.${PROMOTION_X_ENGAGE_TASK_NAME}`);
  const prisma = deps.prisma ?? (defaultPrisma as unknown as PromotionXEngagePrisma);
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.doFetch ?? (globalThis.fetch as unknown as FetchLike);
  const decrypt = deps.decryptToken ?? ((enc: string) => decryptApiKey(enc));
  const pushAlert = deps.pushAlert ?? pushLine;
  const lineConfigured = deps.lineConfigured ?? isLineRelayConfigured;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const parsed = PromotionXEngagePayloadSchema.safeParse(payload);
  const jobId = parsed.success ? parsed.data.job_id : undefined;
  const overrideCap = parsed.success ? parsed.data.override_cap : undefined;

  const result: PromotionXEngageResult = { enabled: false, cap: 0, already_today: 0, followed: 0, liked: 0 };

  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { x_engage_enabled: true } });
    if (!settings?.x_engage_enabled && overrideCap === undefined) {
      result.skipped_reason = 'disabled';
      return await finalize(result);
    }

    // 資格情報。
    const setting = await prisma.promotionChannelSetting.findUnique({ where: { channel: 'x' }, select: { token_enc: true } });
    if (!setting?.token_enc) { result.skipped_reason = 'x_token_missing'; return await finalize(result); }
    let creds;
    try { creds = parseXCredentials(decrypt(setting.token_enc)); } catch { result.skipped_reason = 'x_token_decrypt_failed'; return await finalize(result); }
    if (!creds) { result.skipped_reason = 'x_creds_invalid'; return await finalize(result); }

    // 自分の user id。
    const meRes = await doFetch(X_ME_URL, { method: 'GET', headers: { Authorization: buildXAuthHeader('GET', X_ME_URL, creds) } });
    if (!meRes.ok) { result.skipped_reason = `me_${meRes.status}`; return await finalize(result); }
    const myId = ((await meRes.json()) as { data?: { id?: string } }).data?.id;
    if (!myId) { result.skipped_reason = 'no_my_id'; return await finalize(result); }

    // ランプアップ上限と当日消化。
    const nowTs = now();
    const firstRows = await prisma.promotionXEngagement.findMany({ orderBy: { created_at: 'asc' }, take: 1, select: { created_at: true } } as unknown);
    const firstAt = (firstRows[0] as unknown as { created_at?: Date })?.created_at;
    const daysSinceStart = firstAt ? Math.floor((nowTs.getTime() - new Date(firstAt).getTime()) / 86400_000) : 0;
    const cap = overrideCap ?? dailyCap(daysSinceStart);
    result.cap = cap;
    const dayStart = new Date(nowTs.getTime() - 24 * H); // 直近24hを「当日」とみなす
    const todayCount = await prisma.promotionXEngagement.count({ where: { created_at: { gte: dayStart } } });
    result.already_today = todayCount;
    const remaining = Math.min(PER_RUN_MAX, Math.max(0, cap - todayCount));
    if (remaining <= 0) { result.skipped_reason = 'cap_reached'; return await finalize(result); }

    // 検索でターゲット発見。
    const query = { query: DEFAULT_QUERY, max_results: '25', 'tweet.fields': 'author_id', expansions: 'author_id', 'user.fields': 'public_metrics,username' };
    const qs = new URLSearchParams(query).toString();
    const searchRes = await doFetch(`${X_SEARCH_URL}?${qs}`, { method: 'GET', headers: { Authorization: buildXAuthHeader('GET', X_SEARCH_URL, creds, { extraParams: query }) } });
    if (!searchRes.ok) {
      result.skipped_reason = `search_${searchRes.status}`;
      if (searchRes.status === 429 || searchRes.status === 403) await alert(`⚠️ X能動エンゲージ: 検索が ${searchRes.status} で停止。レート/権限を確認してください。`);
      return await finalize(result);
    }
    const sjson = (await searchRes.json()) as {
      data?: Array<{ id: string; author_id?: string }>;
      includes?: { users?: Array<{ id: string; username: string; public_metrics?: { followers_count?: number } }> };
    };
    const tweets = Array.isArray(sjson.data) ? sjson.data : [];
    const usersById = new Map<string, { username: string; followers: number }>();
    for (const u of sjson.includes?.users ?? []) usersById.set(u.id, { username: u.username, followers: u.public_metrics?.followers_count ?? 0 });

    // 既エンゲージを除外。
    const engagedRows = await prisma.promotionXEngagement.findMany({ select: { action_type: true, target_id: true }, take: 5000 } as unknown);
    const engaged = new Set(engagedRows.map((r) => `${r.action_type}:${r.target_id}`));
    const candidates = pickCandidates(tweets, usersById, myId, engaged).slice(0, remaining);
    if (candidates.length === 0) { result.skipped_reason = 'no_candidates'; return await finalize(result); }

    // いいね＋フォローを実行(ジッター付き)。429/403 で即停止。
    for (const cand of candidates) {
      if (!engaged.has(`like:${cand.tweetId}`)) {
        const r = await act('like', `https://api.twitter.com/2/users/${myId}/likes`, { tweet_id: cand.tweetId }, creds, cand.tweetId, cand.authorHandle);
        if (r === 'stop') break;
        if (r === 'ok') result.liked += 1;
      }
      await sleep(jitter());
      if (!engaged.has(`follow:${cand.authorId}`)) {
        const r = await act('follow', `https://api.twitter.com/2/users/${myId}/following`, { target_user_id: cand.authorId }, creds, cand.authorId, cand.authorHandle);
        if (r === 'stop') break;
        if (r === 'ok') result.followed += 1;
      }
      await sleep(jitter());
    }

    if (result.followed + result.liked > 0 && lineConfigured()) {
      await alert(`🤝 X能動エンゲージ実行: フォロー${result.followed}件 / いいね${result.liked}件（当日累計 ${todayCount + result.followed + result.liked}/${cap}）`);
    }
    log.info({ task: PROMOTION_X_ENGAGE_TASK_NAME, ...result }, 'promotion.x.engage done');
    return await finalize(result);
  } catch (err) {
    if (jobId && prisma.job) {
      try { await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', finished_at: now(), error: String(err) } }); } catch { /* noop */ }
    }
    log.warn({ task: PROMOTION_X_ENGAGE_TASK_NAME, err }, 'promotion.x.engage failed');
    throw err;
  }

  function jitter(): number {
    // 8〜20秒のランダム待機(人間的挙動)。テストでは sleep をモックするので実待機しない。
    return 8000 + Math.floor((now().getTime() % 12000));
  }

  async function alert(text: string): Promise<void> {
    if (lineConfigured()) await pushAlert(text).catch(() => false);
  }

  async function act(
    action: 'like' | 'follow',
    url: string,
    body: Record<string, string>,
    creds: NonNullable<ReturnType<typeof parseXCredentials>>,
    targetId: string,
    handle: string,
  ): Promise<'ok' | 'skip' | 'stop'> {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: buildXAuthHeader('POST', url, creds), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await prisma.promotionXEngagement.create({ data: { action_type: action, target_id: targetId, target_handle: handle, status: 'done' } }).catch(() => {});
      return 'ok';
    }
    if (res.status === 429 || res.status === 403) {
      const b = await res.text().catch(() => '');
      log.warn({ task: PROMOTION_X_ENGAGE_TASK_NAME, action, status: res.status, body: b.slice(0, 200) }, 'X engage 制限/権限エラー — 停止');
      await alert(`⚠️ X能動エンゲージ: ${action} が ${res.status} で停止（レート上限 or 権限）。本日は自動停止します。`);
      return 'stop';
    }
    await prisma.promotionXEngagement.create({ data: { action_type: action, target_id: targetId, target_handle: handle, status: 'failed', error: `http_${res.status}` } }).catch(() => {});
    return 'skip';
  }

  async function finalize(r: PromotionXEngageResult): Promise<PromotionXEngageResult> {
    if (jobId && prisma.job) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'done', finished_at: now(), error: null, result_json: r } });
    }
    return r;
  }
}

export const promotionXEngageTask: Task = async (payload: unknown, _helpers: JobHelpers) => {
  await runPromotionXEngage(payload);
};
