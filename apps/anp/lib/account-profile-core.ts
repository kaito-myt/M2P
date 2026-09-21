/**
 * note アカウントのプロフィール素材 (F-ANP-05) — 読み取り側の共通ロジック。
 * server component (`/accounts/[id]`) とポーリング用 Server Action (`getAccountProfileState`) の両方から使う。
 * 'use server' ファイルに置くと認証無しの公開エンドポイントになるため通常モジュールに分離。
 */
import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage/operations';

const NOTE_ACCOUNT_PROFILE_TASK_NAME = 'note.account.profile';
/** 署名 URL の有効期限 (秒)。ポーリングで更新されるので短めでよい。 */
const SIGNED_URL_TTL_SEC = 900;

export interface AccountProfileJobView {
  id: string;
  status: string;
  targets: string[];
  error: string | null;
  bio_alternatives: string[];
  created_at: string;
}

export interface AccountProfileState {
  bio: string | null;
  avatar_url: string | null;
  header_url: string | null;
  profile_generated_at: string | null;
  /** 直近の生成ジョブ (無ければ null)。 */
  job: AccountProfileJobView | null;
  /** queued/running のジョブがあるか。 */
  generating: boolean;
}

export async function loadAccountProfileState(noteAccountId: string): Promise<AccountProfileState | null> {
  const account = await prisma.noteAccount.findUnique({
    where: { id: noteAccountId },
    select: { bio: true, avatar_r2_key: true, header_r2_key: true, profile_generated_at: true },
  });
  if (!account) return null;

  const job = await prisma.job.findFirst({
    where: { kind: NOTE_ACCOUNT_PROFILE_TASK_NAME, payload_json: { path: ['note_account_id'], equals: noteAccountId } },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, error: true, payload_json: true, result_json: true, created_at: true },
  });

  const [avatarUrl, headerUrl] = await Promise.all([
    account.avatar_r2_key ? getSignedDownloadUrl(account.avatar_r2_key, SIGNED_URL_TTL_SEC, {}, 'avatar.png') : null,
    account.header_r2_key ? getSignedDownloadUrl(account.header_r2_key, SIGNED_URL_TTL_SEC, {}, 'header.jpg') : null,
  ]);

  let jobView: AccountProfileJobView | null = null;
  if (job) {
    const payload = (job.payload_json ?? {}) as { targets?: unknown };
    const result = (job.result_json ?? {}) as { bio_alternatives?: unknown };
    jobView = {
      id: job.id,
      status: job.status,
      targets: Array.isArray(payload.targets) ? payload.targets.filter((t): t is string => typeof t === 'string') : [],
      error: job.error,
      bio_alternatives: Array.isArray(result.bio_alternatives)
        ? result.bio_alternatives.filter((b): b is string => typeof b === 'string')
        : [],
      created_at: job.created_at.toISOString(),
    };
  }

  return {
    bio: account.bio,
    avatar_url: avatarUrl,
    header_url: headerUrl,
    profile_generated_at: account.profile_generated_at ? account.profile_generated_at.toISOString() : null,
    job: jobView,
    generating: jobView !== null && (jobView.status === 'queued' || jobView.status === 'running'),
  };
}
