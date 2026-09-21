'use server';

/**
 * NoteAccount Server Actions (docs/11-anp-design.md §6, F-ANP-01)。
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@a2p/db';
import { NoteAccountProfileTargetSchema, NoteAccountSettingsSchema } from '@a2p/contracts/agents/anp';
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
  const { note_account_id: accountId, handle } = parsed.data;

  try {
    await prisma.noteAccount.update({
      where: { id: accountId },
      data: { handle: handle.length > 0 ? handle : null },
    });
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

const LinkSessionSchema = z.object({
  note_account_id: z.string().min(1),
  /** Cookie ヘッダ / DevTools テーブル / トークン単体 のいずれか (lib/note-session-link.ts `parseNoteCookies`)。 */
  cookies_text: z.string().trim().min(1, messages.accounts.link.errors.cookiesRequired).max(20_000),
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
  const { note_account_id: noteAccountId, cookies_text: cookiesText } = parsed.data;
  const lm = messages.accounts.link;

  try {
    const account = await prisma.noteAccount.findUnique({
      where: { id: noteAccountId },
      select: { id: true, status: true, handle: true },
    });
    if (!account) return { ok: false, error: messages.accounts.errors.notFound };

    const cookies = parseNoteCookies(cookiesText);
    if (!cookies[NOTE_AUTH_COOKIE]) return { ok: false, error: lm.errors.authCookieMissing };

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
  const { note_account_id: noteAccountId, targets, instruction } = parsed.data;
  const pm = messages.accounts.profile;

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
        payload_json: { note_account_id: noteAccountId, targets, ...(instruction ? { instruction } : {}) },
      },
    });
    await enqueueJob(
      NOTE_ACCOUNT_PROFILE_TASK_NAME,
      { note_account_id: noteAccountId, job_id: job.id, targets, ...(instruction ? { instruction } : {}) },
      { maxAttempts: 2 },
    );
    revalidatePath(`/accounts/${noteAccountId}`);
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
