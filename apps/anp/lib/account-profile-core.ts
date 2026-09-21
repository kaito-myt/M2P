/**
 * note アカウントのプロフィール素材 (F-ANP-05) — 読み取り側の共通ロジック。
 * server component (`/accounts/[id]`) とポーリング用 Server Action (`getAccountProfileState`) の両方から使う。
 * 'use server' ファイルに置くと認証無しの公開エンドポイントになるため通常モジュールに分離。
 */
import { prisma } from '@a2p/db';
import { getSignedDownloadUrl } from '@a2p/storage/operations';

export const NOTE_ACCOUNT_PROFILE_TASK_NAME = 'note.account.profile';
/** 署名 URL の有効期限 (秒)。ポーリングで更新されるので短めでよい。 */
const SIGNED_URL_TTL_SEC = 900;

export interface AccountProfileJobProgress {
  /** worker `note.account.profile` の段階: prompt | avatar | header | upload。 */
  stage: string;
  /** 0〜100。 */
  pct: number;
  at: string;
}

export interface AccountProfileJobView {
  id: string;
  status: string;
  targets: string[];
  error: string | null;
  bio_alternatives: string[];
  /** 実行中に worker が書く進捗 (Job.result_json.progress)。無ければ null。 */
  progress: AccountProfileJobProgress | null;
  created_at: string;
  started_at: string | null;
}

export interface AccountProfileState {
  bio: string | null;
  /** F-ANP-07: 記事の方針・トンマナ (アカウント詳細の EditorialPanel が編集/AI 生成)。 */
  niche: string;
  target_reader: string | null;
  tone: string | null;
  editorial_policy: string | null;
  avatar_url: string | null;
  header_url: string | null;
  profile_generated_at: string | null;
  /** 直近の生成ジョブ (無ければ null)。 */
  job: AccountProfileJobView | null;
  /** queued/running のジョブがあるか。 */
  generating: boolean;
}

/**
 * 署名 URL を作る。R2 未設定 (ConfigError) や一時的な失敗でページ全体を落とさず null にする
 * (2026-09-21 本番で ANP サービスに R2 env が無くアカウント詳細が 500 になった事故の再発防止)。
 */
async function signedUrlOrNull(key: string | null, filename: string): Promise<string | null> {
  if (!key) return null;
  try {
    return await getSignedDownloadUrl(key, SIGNED_URL_TTL_SEC, {}, filename);
  } catch (err) {
    console.error('[anp] signed url failed', { key, err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function loadAccountProfileState(noteAccountId: string): Promise<AccountProfileState | null> {
  const account = await prisma.noteAccount.findUnique({
    where: { id: noteAccountId },
    select: { bio: true, avatar_r2_key: true, header_r2_key: true, profile_generated_at: true, niche: true, target_reader: true, tone: true, editorial_policy: true },
  });
  if (!account) return null;

  const job = await prisma.job.findFirst({
    where: { kind: NOTE_ACCOUNT_PROFILE_TASK_NAME, payload_json: { path: ['note_account_id'], equals: noteAccountId } },
    orderBy: { created_at: 'desc' },
    select: { id: true, status: true, error: true, payload_json: true, result_json: true, created_at: true, started_at: true },
  });

  const [avatarUrl, headerUrl] = await Promise.all([
    signedUrlOrNull(account.avatar_r2_key, 'avatar.png'),
    signedUrlOrNull(account.header_r2_key, 'header.jpg'),
  ]);

  let jobView: AccountProfileJobView | null = null;
  if (job) {
    const payload = (job.payload_json ?? {}) as { targets?: unknown };
    const result = (job.result_json ?? {}) as { bio_alternatives?: unknown; progress?: unknown };
    const p = result.progress as { stage?: unknown; pct?: unknown; at?: unknown } | undefined;
    const progress: AccountProfileJobProgress | null =
      p && typeof p.stage === 'string' && typeof p.pct === 'number'
        ? { stage: p.stage, pct: Math.max(0, Math.min(100, p.pct)), at: typeof p.at === 'string' ? p.at : '' }
        : null;
    jobView = {
      id: job.id,
      status: job.status,
      targets: Array.isArray(payload.targets) ? payload.targets.filter((t): t is string => typeof t === 'string') : [],
      error: job.error,
      bio_alternatives: Array.isArray(result.bio_alternatives)
        ? result.bio_alternatives.filter((b): b is string => typeof b === 'string')
        : [],
      progress,
      created_at: job.created_at.toISOString(),
      started_at: job.started_at ? job.started_at.toISOString() : null,
    };
  }

  return {
    bio: account.bio,
    niche: account.niche,
    target_reader: account.target_reader,
    tone: account.tone,
    editorial_policy: account.editorial_policy,
    avatar_url: avatarUrl,
    header_url: headerUrl,
    profile_generated_at: account.profile_generated_at ? account.profile_generated_at.toISOString() : null,
    job: jobView,
    generating: jobView !== null && (jobView.status === 'queued' || jobView.status === 'running'),
  };
}
