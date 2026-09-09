/**
 * note ブラウザ自動エンゲージ(フォロー & スキ)の Port 境界 [F-091]。
 *
 * IG/TikTok の `promotion-sns-engage/engage-port.ts` を踏襲。Playwright 実装
 * (`playwright-note-engage-port.ts`)とオーケストレーション(`../note-engage.ts`)を疎結合にし、
 * 純ロジック(ランプアップ上限 / 対象選定)を副作用なしでテストできるようにする。
 *
 * note も公式のフォロー/スキ API が無いため、運営者が一度取り込んだログイン済みセッション
 * (NoteAccount.session_state_enc)を Playwright で再利用して操作する。
 */

/** エンゲージ種別。note では follow(フォロー) と like(スキ) を扱う。 */
export type NoteEngageAction = 'follow' | 'like';

/** エンゲージ対象(growth_scout が特定した note 上の実在アカウント/記事)。 */
export interface NoteEngageTarget {
  /** follow=プロフィール, like=記事 に対する操作。 */
  action: NoteEngageAction;
  /** 表示用ハンドル(重複防止キー)。例: "@book_lover"。 */
  handle: string;
  /** 直接開ける note.com の https URL(follow=プロフィール, like=記事)。 */
  url: string;
}

export interface NoteEngageOutcome {
  action: NoteEngageAction;
  handle: string;
  url: string;
  /** done=実行した / already=既に実行済 / failed=失敗 */
  status: 'done' | 'already' | 'failed';
  error?: string;
}

export interface NoteEngageArgs {
  /** 復号済み storageState(JSON 文字列)。 */
  sessionState: string;
  targets: NoteEngageTarget[];
  /** 1回の実行で実際に行うフォローの最大数。 */
  maxFollow: number;
  /** 1回の実行で実際に行うスキの最大数。 */
  maxLike: number;
  /** 住宅IPプロキシ(任意)。 */
  proxy?: { server: string; username?: string; password?: string };
}

export interface NoteEngagePortResult {
  outcomes: NoteEngageOutcome[];
  /** アクションブロック/セッション切れ等で中断した場合の理由。 */
  blocked?: string;
}

export interface NoteEngagePort {
  engageAll(args: NoteEngageArgs): Promise<NoteEngagePortResult>;
}

/**
 * フォローのランプアップ上限(24時間あたり)。note は IG/TikTok より制限が緩いが、ToS 配慮で
 * 稼働初期は保守的に。稼働開始からの経過日数 → 当日フォロー上限。
 */
export function followDailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 3;
  if (daysSinceStart <= 4) return 5;
  if (daysSinceStart <= 9) return 8;
  return 10; // 巡航上限
}

/** スキ(いいね)のランプアップ上限(24時間あたり)。フォローより多めに許容。 */
export function likeDailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 5;
  if (daysSinceStart <= 4) return 8;
  if (daysSinceStart <= 9) return 12;
  return 15; // 巡航上限
}

/** note.com の https URL か(直接ブラウザで開ける対象か)を判定。 */
function isNoteUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?note\.com\//i.test(url.trim());
}

/**
 * growth_scout のアクション → note エンゲージ対象リスト。
 * - follow / like のみ(comment は対象外)。
 * - 直接開ける note.com の https URL を持つもの。
 * - 重複(既エンゲージ: `${action}:${handle}`)を除外。
 * - action ごとに上限(maxFollow / maxLike)まで。
 */
export function pickNoteTargets(
  actions: Array<{ action_type: string; target_handle?: string; target_url?: string }>,
  alreadyEngaged: Set<string>,
  maxFollow: number,
  maxLike: number,
): NoteEngageTarget[] {
  const out: NoteEngageTarget[] = [];
  const seen = new Set<string>();
  let follows = 0;
  let likes = 0;
  for (const a of actions) {
    const action: NoteEngageAction | null =
      a.action_type === 'follow' ? 'follow' : a.action_type === 'like' ? 'like' : null;
    if (!action) continue;
    if (action === 'follow' && follows >= maxFollow) continue;
    if (action === 'like' && likes >= maxLike) continue;

    const handle = (a.target_handle ?? '').trim();
    const url = (a.target_url ?? '').trim();
    if (!handle || !isNoteUrl(url)) continue;

    const key = `${action}:${handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (alreadyEngaged.has(key)) continue;

    seen.add(key);
    out.push({ action, handle, url });
    if (action === 'follow') follows += 1;
    else likes += 1;
    if (follows >= maxFollow && likes >= maxLike) break;
  }
  return out;
}
