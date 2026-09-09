/**
 * IG/TikTok ブラウザ自動エンゲージの Port 境界 [F-077]。
 *
 * Playwright 実装(`playwright-engage-port.ts`)とオーケストレーション(`../promotion-sns-engage.ts`)
 * を疎結合にし、純ロジック(上限/対象選定)を副作用なしでテストできるようにする。
 */

/** フォロー対象(growth_scout が特定した実在アカウント)。 */
export interface EngageTarget {
  /** 表示用ハンドル(重複防止キー)。例: "@book_lover" */
  handle: string;
  /** プロフィールURL(直接開ける https)。 */
  url: string;
}

export interface EngageOutcome {
  handle: string;
  url: string;
  /** done=フォローした / already=既にフォロー済 / failed=失敗 */
  status: 'done' | 'already' | 'failed';
  error?: string;
}

export interface SnsEngageArgs {
  channel: 'instagram' | 'tiktok';
  /** 復号済み storageState(JSON 文字列)。 */
  sessionState: string;
  targets: EngageTarget[];
  /** 1回の実行で実際に行うフォローの最大数。 */
  maxActions: number;
  /** 住宅IPプロキシ(任意)。 */
  proxy?: { server: string; username?: string; password?: string };
}

export interface SnsEngagePortResult {
  outcomes: EngageOutcome[];
  /** アクションブロック/セッション切れ等で中断した場合の理由。 */
  blocked?: string;
}

export interface SnsEngagePort {
  followAll(args: SnsEngageArgs): Promise<SnsEngagePortResult>;
}

/**
 * ランプアップ上限(IG/TikTok は X より凍結リスクが高いので保守的)。
 * 稼働開始からの経過日数 → 当日フォロー上限。
 */
export function dailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 5;
  if (daysSinceStart <= 4) return 8;
  if (daysSinceStart <= 9) return 12;
  return 15; // 巡航上限
}

/**
 * growth_scout のアクション → フォロー対象リスト。
 * - action_type='follow' のみ / 直接開ける https URL がある / 重複(既エンゲージ)を除外 / 上限まで。
 */
export function pickFollowTargets(
  actions: Array<{ action_type: string; target_handle?: string; target_url?: string }>,
  resolveUrl: (a: { target_handle?: string; target_url?: string }) => string,
  alreadyEngaged: Set<string>,
  max: number,
): EngageTarget[] {
  const out: EngageTarget[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    if (a.action_type !== 'follow') continue;
    const handle = (a.target_handle ?? '').trim();
    if (!handle) continue;
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    if (alreadyEngaged.has(`follow:${key}`)) continue;
    const url = resolveUrl(a);
    if (!/^https?:\/\//i.test(url)) continue; // 直接開けない対象はブラウザ操作不可
    seen.add(key);
    out.push({ handle, url });
    if (out.length >= max) break;
  }
  return out;
}
