'use server';

/**
 * NoteAccount Server Actions (docs/11-anp-design.md §6, F-ANP-01)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';
import { NOTE_PROMOTION_CHANNELS, NoteAccountProfileTargetSchema, NoteAccountSettingsSchema, NoteMonetizationPolicySchema, parseNoteMonetizationPolicy } from '@a2p/contracts/agents/anp';
import { encryptKdpCredentials } from '@a2p/crypto';

import { auth } from '@/auth';
import { loadAccountProfileState, type AccountProfileState } from '@/lib/account-profile-core';
import { enqueueJob } from '@/lib/graphile-client';
import { messages } from '@/lib/messages';
import {
  buildNoteStorageState,
  NOTE_AUTH_COOKIE,
  parseNoteCookies,
  verifyNoteSession,
} from '@/lib/note-session-link';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CreateAccountSchema = z.object({
  niche: z.string().trim().min(1, messages.accounts.errors.nicheRequired).max(200),
  display_name: z.string().trim().min(1, messages.accounts.errors.displayNameRequired).max(100),
  target_reader: z.string().trim().max(300).optional(),
  tone: z.string().trim().max(200).optional(),
  free_ratio: z.coerce.number().min(0.05).max(0.95).default(0.3),
  price_min: z.coerce.number().int().min(0).max(50000).default(100),
  price_max: z.coerce.number().int().min(0).max(50000).default(1000),
  membership: z.coerce.boolean().default(false),
});

const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

const UpdateAccountHandleSchema = z.object({
  note_account_id: z.string().min(1),
  /** 表示名 (アカウント名)。運営者要望 2026-09-21「一度設定したらどこからも変えられない」→ ここで編集可能に。 */
  display_name: z.string().trim().min(1, messages.accounts.errors.displayNameRequired).max(100).optional(),
  // 空文字は「クリア(未設定に戻す)」として扱う。
  handle: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v.length === 0 || HANDLE_PATTERN.test(v), messages.accounts.errors.handleInvalid),
});

/**
 * `note_accounts.handle` の手動編集 (docs/11-anp-design.md §7 申し送り13)。
 * フォロワー数取得(`/<handle>/followers`)に必須なため、運営者が note 実ハンドルを設定できるようにする。
 */
export async function updateAccountHandle(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = UpdateAccountHandleSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? messages.accounts.errors.unknown };
  }
  const { note_account_id: accountId, handle, display_name: displayName } = parsed.data;

  try {
    await prisma.noteAccount.update({
      where: { id: accountId },
      data: { handle: handle.length > 0 ? handle : null, ...(displayName ? { display_name: displayName } : {}) },
    });
    revalidatePath('/accounts');
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accounts.errors.unknown,
    };
  }
}

/** フォームの tri-state ('global'=未指定/グローバル追従 | 'on' | 'off') を settings_json の boolean|undefined に変換。 */
const TriStateSchema = z.enum(['global', 'on', 'off']).transform((v) => (v === 'global' ? undefined : v === 'on'));

const UpdateAccountSettingsSchema = z.object({
  note_account_id: z.string().min(1),
  auto_theme_enabled: TriStateSchema,
  autopass_enabled: TriStateSchema,
  auto_publish_enabled: TriStateSchema,
  tiktok_enabled: TriStateSchema,
  // 空文字 = グローバルに従う (未指定)。
  themes_per_day: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? undefined : Number(v)))
    .pipe(z.number().int().min(1).max(20).optional()),
});

/**
 * F-ANP-17 (docs/11-anp-design.md §3.1/§7): アカウント別パイプライン自動パス設定。
 * `note_accounts.settings_json` を丸ごと置き換える (フォームは常に全項目を送るため部分更新は不要)。
 */
export async function updateAccountSettings(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = UpdateAccountSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: messages.accounts.errors.unknown };
  }
  const { note_account_id: accountId, ...rest } = parsed.data;

  const nextSettings = NoteAccountSettingsSchema.parse({
    ...(rest.auto_theme_enabled !== undefined ? { auto_theme_enabled: rest.auto_theme_enabled } : {}),
    ...(rest.themes_per_day !== undefined ? { themes_per_day: rest.themes_per_day } : {}),
    ...(rest.autopass_enabled !== undefined ? { autopass_enabled: rest.autopass_enabled } : {}),
    ...(rest.auto_publish_enabled !== undefined ? { auto_publish_enabled: rest.auto_publish_enabled } : {}),
    ...(rest.tiktok_enabled !== undefined ? { tiktok_enabled: rest.tiktok_enabled } : {}),
  });

  try {
    await prisma.noteAccount.update({ where: { id: accountId }, data: { settings_json: nextSettings } });
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accounts.errors.unknown,
    };
  }
}

const UpdateAccountMonetizationSchema = z
  .object({
    note_account_id: z.string().min(1),
    /** null = 未設定 (AI 任せ)。 */
    paid_ratio: z.number().min(0).max(1).nullable(),
    free_ratio: z.number().min(0.05).max(0.95),
    price_min: z.coerce.number().int().min(0).max(50000),
    price_max: z.coerce.number().int().min(0).max(50000),
    membership: z.boolean(),
  })
  .refine((v) => v.price_min <= v.price_max, { message: messages.accountDetail.monetization.errors.priceRange, path: ['price_max'] });

/**
 * F-ANP-08 (2026-09-21): アカウント詳細の収益化設定 (有料記事の比率 / 無料公開部分 / 価格帯 / メンバーシップ)。
 * `note_accounts.monetization_policy_json` を置き換える (既存の未知キーは保持)。
 */
export async function updateAccountMonetization(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }
  const parsed = UpdateAccountMonetizationSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? messages.accounts.errors.unknown };
  }
  const { note_account_id: accountId, paid_ratio, free_ratio, price_min, price_max, membership } = parsed.data;
  try {
    const current = await prisma.noteAccount.findUnique({ where: { id: accountId }, select: { monetization_policy_json: true } });
    if (!current) return { ok: false, error: messages.accounts.errors.unknown };
    const existing = current.monetization_policy_json && typeof current.monetization_policy_json === 'object' ? (current.monetization_policy_json as Record<string, unknown>) : {};
    const next = NoteMonetizationPolicySchema.parse({
      ...parseNoteMonetizationPolicy(existing),
      free_ratio,
      price_band: [price_min, price_max],
      membership,
      ...(paid_ratio === null ? {} : { paid_ratio }),
    });
    // 既存の未知キー (設計案由来の paid_line_strategy 等) は保持し、paid_ratio は null なら落とす (= AI 任せ)。
    const stored: Record<string, unknown> = { ...existing, free_ratio: next.free_ratio, price_band: next.price_band, membership: next.membership };
    if (paid_ratio === null) delete stored.paid_ratio;
    else stored.paid_ratio = paid_ratio;
    await prisma.noteAccount.update({ where: { id: accountId }, data: { monetization_policy_json: stored as object } });
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : messages.accounts.errors.unknown };
  }
}

export async function createAccount(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: messages.common.unauthorized };
  }

  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? messages.accounts.errors.unknown };
  }
  const v = parsed.data;

  try {
    const account = await prisma.noteAccount.create({
      data: {
        niche: v.niche,
        display_name: v.display_name,
        target_reader: v.target_reader || null,
        tone: v.tone || null,
        monetization_policy_json: {
          free_ratio: v.free_ratio,
          price_band: [v.price_min, v.price_max],
          membership: v.membership,
        },
        genre_policy_json: {},
        status: 'active',
      },
      select: { id: true },
    });
    revalidatePath('/accounts');
    return { ok: true, data: { id: account.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : messages.accounts.errors.unknown,
    };
  }
}

// ---------------------------------------------------------------------------
// linkNoteAccountSession — F-ANP-20: ANP 画面からの note セッション連携 (Cookie 貼り付け)
// ---------------------------------------------------------------------------

const LinkSessionSchema = z
  .object({
    note_account_id: z.string().min(1),
    /** `note_gql_auth_token` の値 (ログイン後に発行される本命の Cookie)。 */
    auth_token: z.string().trim().max(8_000).optional(),
    /** `_note_session_v5` の値 (Web セッション)。 */
    session_cookie: z.string().trim().max(8_000).optional(),
    /** 旧形式: Cookie ヘッダ / DevTools テーブル貼り付け (`parseNoteCookies`)。 */
    cookies_text: z.string().trim().max(20_000).optional(),
  })
  .refine((v) => (v.auth_token && v.auth_token.length > 0) || (v.session_cookie && v.session_cookie.length > 0) || (v.cookies_text && v.cookies_text.length > 0), {
    message: messages.accounts.link.errors.cookiesRequired,
  });

export interface LinkedNoteSessionInfo {
  handle: string;
  nickname: string;
  status: string;
}

/**
 * 運営者がブラウザで note にログインした状態の Cookie を貼り付けて、アカウントに紐付ける。
 * 1. Cookie をパース (`note_gql_auth_token` 必須)
 * 2. `GET note.com/api/v2/current_user` でログイン状態を検証し urlname/nickname を得る
 * 3. Playwright storageState に組み立て → `KDP_CRED_KEY` で暗号化 → `session_state_enc` 保存
 *    (ローカルスクリプト `scripts/anp/note-session-capture.mjs` と同じ保存形式)
 * 4. status: pending_session / paused → active。handle = urlname。未解決の session_expired
 *    認証リクエストを fulfilled にする (F-ANP-21)。
 */
export async function linkNoteAccountSession(input: unknown): Promise<ActionResult<LinkedNoteSessionInfo>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = LinkSessionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? messages.accounts.link.errors.linkFailed };
  }
  const { note_account_id: noteAccountId, auth_token: authToken, session_cookie: sessionCookie, cookies_text: cookiesText } = parsed.data;
  const lm = messages.accounts.link;

  try {
    const account = await prisma.noteAccount.findUnique({
      where: { id: noteAccountId },
      select: { id: true, status: true, handle: true },
    });
    if (!account) return { ok: false, error: messages.accounts.errors.notFound };

    // 個別入力 (推奨) と旧形式の貼り付けをマージする。値に "name=" が混ざっていても parseNoteCookies で拾えるよう、
    // 個別欄は「値だけ」が前提だが `name=value` 形式も許容する。
    const cookies = parseNoteCookies(cookiesText ?? '');
    const pick = (raw: string | undefined, name: string) => {
      const v = (raw ?? '').trim().replace(/^cookie:\s*/i, '');
      if (!v) return;
      const m = v.match(/^([A-Za-z0-9_.-]+)=(.+)$/);
      cookies[name] = (m && m[1] === name && m[2] ? m[2] : v).trim().replace(/;$/, '');
    };
    pick(authToken, NOTE_AUTH_COOKIE);
    pick(sessionCookie, '_note_session_v5');
    // note_gql_auth_token (ログイン後に発行) が本命だが、Web セッション _note_session_v5 だけでも
    // API 検証が通ることがあるので、どちらか一方があれば検証に進む (通らなければ notLoggedIn を返す)。
    if (!cookies[NOTE_AUTH_COOKIE] && !cookies._note_session_v5) return { ok: false, error: lm.errors.authCookieMissing };

    const verified = await verifyNoteSession(cookies);
    if (!verified.ok) {
      return {
        ok: false,
        error: verified.reason === 'unauthorized' ? lm.errors.notLoggedIn : `${lm.errors.verifyFailed} (${verified.message})`,
      };
    }

    // 別アカウントの Cookie を貼った事故を検出: 既に handle が入っていて urlname と食い違う場合は拒否。
    if (account.handle && account.handle !== verified.urlname) {
      return { ok: false, error: lm.errors.handleMismatch(account.handle, verified.urlname) };
    }

    const stateJson = JSON.stringify(buildNoteStorageState(cookies));
    const encrypted = encryptKdpCredentials(stateJson);

    const nextStatus =
      account.status === 'pending_session' || account.status === 'paused' ? 'active' : account.status;

    await prisma.$transaction([
      prisma.noteAccount.update({
        where: { id: noteAccountId },
        data: {
          session_state_enc: encrypted,
          session_linked_at: new Date(),
          session_source: 'cookie_import',
          handle: verified.urlname,
          status: nextStatus,
        },
      }),
      prisma.noteAuthRequest.updateMany({
        where: { note_account_id: noteAccountId, purpose: 'session_expired', status: 'pending' },
        data: { status: 'fulfilled', fulfilled_at: new Date() },
      }),
    ]);

    revalidatePath('/accounts');
    revalidatePath(`/accounts/${noteAccountId}`);
    revalidatePath('/');
    return { ok: true, data: { handle: verified.urlname, nickname: verified.nickname, status: nextStatus } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : lm.errors.linkFailed };
  }
}

// ---------------------------------------------------------------------------
// F-ANP-05: プロフィール素材 (自己紹介文 / アイコン / カバー) の生成・編集
// ---------------------------------------------------------------------------

const NOTE_ACCOUNT_PROFILE_TASK_NAME = 'note.account.profile';

const GenerateProfileSchema = z.object({
  note_account_id: z.string().min(1),
  targets: z.array(NoteAccountProfileTargetSchema).min(1),
  instruction: z.string().trim().max(1000).optional(),
  /** F-ANP-06: 添付した参考画像の R2 キー (anp/uploads/...)。LLM のビジョン入力として渡す。 */
  reference_image_keys: z.array(z.string().regex(/^anp\/uploads\/[A-Za-z0-9_.-]+$/)).max(4).optional(),
  /** F-ANP-32: targets=['promotion'] のときの対象媒体。 */
  channel: z.enum(NOTE_PROMOTION_CHANNELS).optional(),
});

/**
 * 「自己紹介文を生成」「アイコン/カバーを生成」→ worker `note.account.profile` を enqueue する。
 * 同じアカウントの生成ジョブが queued/running のときは二重起動しない。
 */
export async function generateAccountProfile(input: unknown): Promise<ActionResult<{ job_id: string }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = GenerateProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accounts.profile.errors.generateFailed };
  const { note_account_id: noteAccountId, targets, instruction, reference_image_keys: referenceImageKeys, channel } = parsed.data;
  const pm = messages.accounts.profile;
  if (targets.includes('promotion') && !channel) return { ok: false, error: pm.errors.generateFailed };
  const extra = {
    ...(instruction ? { instruction } : {}),
    ...(referenceImageKeys && referenceImageKeys.length > 0 ? { reference_image_keys: referenceImageKeys } : {}),
    ...(channel ? { channel } : {}),
  };

  try {
    const account = await prisma.noteAccount.findUnique({ where: { id: noteAccountId }, select: { id: true } });
    if (!account) return { ok: false, error: messages.accounts.errors.notFound };

    const inflight = await prisma.job.count({
      where: {
        kind: NOTE_ACCOUNT_PROFILE_TASK_NAME,
        status: { in: ['queued', 'running'] },
        payload_json: { path: ['note_account_id'], equals: noteAccountId },
      },
    });
    if (inflight > 0) return { ok: false, error: pm.errors.alreadyRunning };

    const job = await prisma.job.create({
      data: {
        kind: NOTE_ACCOUNT_PROFILE_TASK_NAME,
        status: 'queued',
        payload_json: { note_account_id: noteAccountId, targets, ...extra },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_PROFILE_TASK_NAME,
      { note_account_id: noteAccountId, job_id: job.id, targets, ...extra },
      { maxAttempts: 2 },
    );
    revalidatePath(`/accounts/${noteAccountId}`);
    revalidatePath('/promotion');
    return { ok: true, data: { job_id: job.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : pm.errors.generateFailed };
  }
}

const UpdateBioSchema = z.object({
  note_account_id: z.string().min(1),
  bio: z.string().trim().max(1000),
});

/** 自己紹介文の手直しを保存する (空文字はクリア)。 */
export async function updateAccountBio(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };

  const parsed = UpdateBioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accounts.profile.errors.saveFailed };
  const { note_account_id: noteAccountId, bio } = parsed.data;
  try {
    await prisma.noteAccount.update({
      where: { id: noteAccountId },
      data: { bio: bio.length > 0 ? bio : null },
    });
    revalidatePath(`/accounts/${noteAccountId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : messages.accounts.profile.errors.saveFailed };
  }
}

const ProfileStateSchema = z.object({ note_account_id: z.string().min(1) });

/** ポーリング用: 生成ジョブの状態と最新の素材 (署名 URL 付き)。 */
export async function getAccountProfileState(input: unknown): Promise<ActionResult<AccountProfileState>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const parsed = ProfileStateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messages.accounts.errors.notFound };
  const state = await loadAccountProfileState(parsed.data.note_account_id);
  if (!state) return { ok: false, error: messages.accounts.errors.notFound };
  return { ok: true, data: state };
}

// ---------------------------------------------------------------------------
// F-ANP-07: 記事の方針・トンマナ (手入力保存)
// ---------------------------------------------------------------------------

const UpdateEditorialSchema = z.object({
  note_account_id: z.string().min(1),
  niche: z.string().trim().min(1, messages.accounts.errors.nicheRequired).max(200),
  target_reader: z.string().trim().max(300),
  tone: z.string().trim().max(200),
  editorial_policy: z.string().trim().max(3000),
});

export async function updateAccountEditorial(input: unknown): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: messages.common.unauthorized };
  const parsed = UpdateEditorialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? messages.accounts.editorial.errors.saveFailed };
  const { note_account_id: noteAccountId, niche, target_reader, tone, editorial_policy } = parsed.data;
  try {
    await prisma.noteAccount.update({
      where: { id: noteAccountId },
      data: {
        niche,
        target_reader: target_reader.length > 0 ? target_reader : null,
        tone: tone.length > 0 ? tone : null,
        editorial_policy: editorial_policy.length > 0 ? editorial_policy : null,
      },
    });
    revalidatePath(`/accounts/${noteAccountId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : messages.accounts.editorial.errors.saveFailed };
  }
}
