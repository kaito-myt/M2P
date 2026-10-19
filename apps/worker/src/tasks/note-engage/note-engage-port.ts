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

export interface NoteSessionArgs {
  sessionState: string;
  queries: string[];
  limit: number;
  maxFollow: number;
  maxLike: number;
  proxy?: { server: string; username?: string; password?: string };
  /** 収穫カード → 対象 (純関数)。ブラウザを開いたまま同期で呼ばれる。 */
  selectTargets: (cards: NoteHarvestCard[]) => NoteEngageTarget[];
}

export interface NoteSessionResult {
  outcomes: NoteEngageOutcome[];
  blocked?: string;
  harvest: {
    /** 検索ページを実際に開けて読めたか (false = 例外/ブロックで読めていない → scout を呼ばない)。 */
    pageOpened: boolean;
    cards: number;
    selected: number;
  };
}

export interface NoteEngagePort {
  /** 与えられた対象を操作する (フォールバック用)。1 ブラウザセッション。 */
  engageAll(args: NoteEngageArgs): Promise<NoteEngagePortResult>;
  /**
   * 主系統: 1 ブラウザセッションで「ログイン確認 → note.com の検索を見て実在の著者・記事を収穫 →
   * 操作」まで行う (スロット取得をアカウントあたり 1 回にするため統合)。
   */
  harvestAndEngage?(args: NoteSessionArgs): Promise<NoteSessionResult>;
}

/**
 * フォロー/スキのランプアップ上限 = **アカウント1つあたり** の 24 時間キャップ。
 *
 * 2026-10-19 に巡航 10/15 → 50/80 へ引き上げ (docs/11 F-091)。実測で全期間のフォローが 9 件では
 * 199 本の記事を出しても 743 PV のままだった。note は IG/TikTok より制限が緩いが無制限ではない
 * ので、初日から全開にせず稼働日数で段階的に上げる (凍結回避)。巡航 50/日でも 1 回の実行は
 * 8 件・間隔 8〜25 秒・1 日 8 回に分散するので、人間が 1 日に触る量の範囲に収まる。
 */
export function followDailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 10;
  if (daysSinceStart <= 4) return 20;
  if (daysSinceStart <= 9) return 35;
  return 50; // 巡航上限
}

/** スキ(いいね)のランプアップ上限(アカウント1つあたり / 24時間)。フォローより多めに許容。 */
export function likeDailyCap(daysSinceStart: number): number {
  if (daysSinceStart <= 1) return 15;
  if (daysSinceStart <= 4) return 30;
  if (daysSinceStart <= 9) return 55;
  return 80; // 巡航上限
}

/** 1回の実行 (アカウントごと) の上限。cron 1日8回 × 8 = 64 ≥ 50、× 12 = 96 ≥ 80。 */
export const PER_RUN_FOLLOW = 8;
export const PER_RUN_LIKE = 12;

/**
 * 日替わりで先頭が入れ替わるようにアカウントを回す順序 (UTC の通算日 % 件数)。
 * 同じ日の複数回の実行は同じ順序になり、日をまたぐと先頭が変わる。
 */
export function rotateAccounts<T>(accounts: readonly T[], now: Date): T[] {
  if (accounts.length === 0) return [];
  const day = Math.floor(now.getTime() / 86400_000);
  const start = day % accounts.length;
  return [...accounts.slice(start), ...accounts.slice(0, start)];
}

export interface RunQuota {
  follow: number;
  like: number;
}

/**
 * 24h の全体予算 (= アカウント1つあたりキャップ × 件数) から使用済みを引き、**アカウント数で均等割り**する。
 *
 * `promotion_sns_engagements` にはアカウント列が無く (一意キー = channel,action,handle)、スキーマは
 * 変えられないので使用済みはアカウント別に出せない。そこで残りを先に等分してから各アカウントを
 * 回すことで、先頭のアカウントが枠を食い切って 2 番目が構造的に 0 になる事故 (2026-10-19 実測:
 * 競馬アカは一度もフォローしていない) を防ぐ。端数は rotated 順の先頭から 1 ずつ配る。
 * 戻り値は入力順 (= rotated 済みの順) と同じ並び。
 */
export function allocateRunQuotas(args: {
  /** アカウントごとの 1 日キャップ (ランプアップ起点がアカウントごとなので配列)。 */
  followCaps: number[];
  likeCaps: number[];
  /** アカウントごとの当日使用数 (`settings_json.engage_usage`)。省略 = 0。 */
  followUsage?: number[];
  likeUsage?: number[];
  /** チャンネル合算の直近 24h 使用数 (二次的な上限)。 */
  followUsed: number;
  likeUsed: number;
  perRunFollow?: number;
  perRunLike?: number;
}): RunQuota[] {
  const n = args.followCaps.length;
  if (n <= 0) return [];
  const one = (caps: number[], usage: number[] | undefined, channelUsed: number, perRun: number): number[] => {
    // 主: アカウント自身の当日残り (cap - usage)。他アカウントの消費では減らないので飢えない。
    // 以前は合算予算の均等割りだけだったため、caps=[50,10] で day-0 の競馬アカが 8×4=30/日 (自キャップの3倍) 走った。
    const q = caps.map((c, i) => Math.max(0, Math.min(perRun, c - (usage?.[i] ?? 0))));
    // 従: チャンネル合算予算を超えるなら、最大の枠から 1 ずつ削る (同値なら後ろ=ローテーション後ろ側から)。
    let over = q.reduce((x, y) => x + y, 0) - Math.max(0, caps.reduce((x, y) => x + y, 0) - channelUsed);
    while (over > 0) {
      let m = 0;
      for (let i = 1; i < n; i += 1) if ((q[i] ?? 0) >= (q[m] ?? 0)) m = i;
      if ((q[m] ?? 0) <= 0) break;
      q[m] = (q[m] ?? 0) - 1;
      over -= 1;
    }
    return q;
  };
  const f = one(args.followCaps, args.followUsage, args.followUsed, args.perRunFollow ?? PER_RUN_FOLLOW);
  const l = one(args.likeCaps, args.likeUsage, args.likeUsed, args.perRunLike ?? PER_RUN_LIKE);
  return f.map((follow, i) => ({ follow, like: l[i] ?? 0 }));
}

/** `note_accounts.settings_json` に置くアカウント別のエンゲージ状態 (migration 不要)。 */
export interface NoteEngageAccountState {
  /** ランプアップの起点 (ISO)。初回の成功実行で書く。 */
  engage_ramp_started_at?: string;
  /** growth_scout フォールバックを最後に呼んだ日 (`engageDay`, YYYY-MM-DD)。1アカウント1日1回まで。 */
  engage_scout_date?: string;
  /** 当日 (`engageDay`) の実行済み件数。日が変われば 0 扱い。 */
  engage_usage?: { day: string; follow: number; like: number };
}

export function readEngageState(settingsJson: unknown): NoteEngageAccountState {
  if (!settingsJson || typeof settingsJson !== 'object') return {};
  const o = settingsJson as Record<string, unknown>;
  const out: NoteEngageAccountState = {};
  if (typeof o.engage_ramp_started_at === 'string') out.engage_ramp_started_at = o.engage_ramp_started_at;
  if (typeof o.engage_scout_date === 'string') out.engage_scout_date = o.engage_scout_date;
  const u = o.engage_usage as { day?: unknown; follow?: unknown; like?: unknown } | undefined;
  if (u && typeof u.day === 'string' && typeof u.follow === 'number' && typeof u.like === 'number') {
    out.engage_usage = { day: u.day, follow: u.follow, like: u.like };
  }
  return out;
}

/** アカウント単位の稼働日数。起点が未記録 (= まだ一度も成功していない) なら 0 日目。 */
export function engageDaysSinceStart(state: NoteEngageAccountState, now: Date): number {
  if (!state.engage_ramp_started_at) return 0;
  const t = Date.parse(state.engage_ramp_started_at);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400_000));
}

/**
 * 「1 日」の区切り = JST 日付。cron が JST 8:17〜22:17 に並ぶので、UTC 日だと 09:00 JST で
 * 日が割れて同じ運用日に 2 回分の枠/scout が出てしまう。
 */
export const engageDay = (d: Date): string => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** 当日の実行済み件数 (日が違えば 0)。 */
export function engageUsageToday(state: NoteEngageAccountState, now: Date): { follow: number; like: number } {
  const u = state.engage_usage;
  return u && u.day === engageDay(now) ? { follow: u.follow, like: u.like } : { follow: 0, like: 0 };
}

/** growth_scout (¥40/回, web 検索つき) は 1 アカウント 1 日 (JST) に 1 回まで。 */
export function canRunScout(state: NoteEngageAccountState, now: Date): boolean {
  return state.engage_scout_date !== engageDay(now);
}

/**
 * ブロック理由の分類。
 * - session: セッション切れ → アカウント停止 + 再取込通知
 * - rate_limit: note のレート制限画面 → この回を中止 (次回 cron で再開)
 * - technical: ブラウザ/環境の問題 → 凍結とは無関係なので通知しない
 */
export function classifyBlock(reason: string): 'session' | 'rate_limit' | 'technical' {
  if (reason === 'session_expired') return 'session';
  if (reason === 'action_blocked') return 'rate_limit';
  return 'technical';
}

/**
 * ログイン済みの**肯定的**シグナル判定。ただし「JSON として読めて `data` が空」のときだけ未ログイン扱い
 * (`GET https://note.com/api/v2/current_user`)。
 * note の検索ページとプロフィールはログアウトでも 200 の公開ページで、/login へのリダイレクトでは
 * セッション切れを検出できない (2026-10-19 判明)。死んだセッションで「フォロー」を押しても
 * ログイン誘導が出るだけなので、これで確認してから操作する。
 */
export function judgeCurrentUser(status: number, body: unknown): 'ok' | 'expired' | 'unknown' {
  // 明示的な未ログインだけを expired にする。expired は「アカウントを paused + 認証リレー」で、
  // ANP の本線 (テーマ自動生成など) も止めてしまい、再取込でも直らない誤検知は大事故になる。
  if (status === 401 || status === 403) return 'expired';
  if (status !== 200) return 'unknown';
  // JSON として読めない (WAF/Cloudflare の 200 HTML 等) / `data` キーが無い (API の形変更) = 想定外 = unknown。
  if (!body || typeof body !== 'object' || !('data' in body)) return 'unknown';
  const data = (body as { data?: unknown }).data;
  if (data === null || data === undefined) return 'expired';
  if (typeof data === 'object') {
    const d = data as { id?: unknown; urlname?: unknown };
    if (d.id !== undefined && d.id !== null && d.id !== '') return 'ok';
    if (typeof d.urlname === 'string' && d.urlname) return 'ok';
    if (Object.keys(data).length === 0) return 'expired';
  }
  return 'unknown';
}

/** note.com 本体から収穫した記事カード (検索/新着ページの1枚)。 */
export interface NoteHarvestCard {
  /** note の urlname (@ 無し)。 */
  urlname: string;
  /** 記事 ID (`/n/<id>` の id)。 */
  articleId: string;
}

/**
 * アカウントの niche / target_reader から note 内検索語を作る (最大 max 個, 重複なし)。
 * 区切り文字で分割した語と、全体を 1 語としたものを使う。空なら空配列。
 */
export function buildHarvestQueries(niche: string, targetReader?: string | null, max = 4): string[] {
  const split = (t: string) =>
    t
      .split(/[\s,、，/／×・+＋&＆|｜]+/u)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 20);
  const whole = niche.trim();
  const out: string[] = [];
  const push = (q: string) => {
    if (q && !out.includes(q)) out.push(q);
  };
  if (whole.length >= 2 && whole.length <= 20) push(whole);
  for (const w of split(niche)) push(w);
  for (const w of split(targetReader ?? '')) push(w);
  return out.slice(0, max);
}

const normHandle = (h: string) => h.trim().replace(/^@/, '').toLowerCase();

/**
 * 収穫カード → エンゲージ対象。副作用なし。
 * - 自分自身 (selfHandles) のアカウントは follow も like もしない。
 * - 既エンゲージ (`${action}:${handle}`) と重複を除外。
 * - follow=著者プロフィール(1著者1回) / like=記事。action ごとに上限まで。
 * ハンドルは scout 由来と揃えて `@urlname`、like は記事単位で一意にするため `@urlname/n/<id>`。
 */
export function harvestToTargets(
  cards: NoteHarvestCard[],
  alreadyEngaged: Set<string>,
  selfHandles: Iterable<string>,
  maxFollow: number,
  maxLike: number,
): NoteEngageTarget[] {
  const self = new Set([...selfHandles].map(normHandle).filter(Boolean));
  const out: NoteEngageTarget[] = [];
  const seen = new Set<string>();
  let follows = 0;
  let likes = 0;
  const valid = (s: string) => /^[A-Za-z0-9_\-]+$/.test(s);
  for (const c of cards) {
    const urlname = c.urlname.trim();
    const id = c.articleId.trim();
    if (!valid(urlname) || !valid(id)) continue;
    if (self.has(urlname.toLowerCase())) continue;

    if (follows < maxFollow) {
      const handle = `@${urlname}`;
      const key = `follow:${handle.toLowerCase()}`;
      if (!seen.has(key) && !alreadyEngaged.has(key)) {
        seen.add(key);
        out.push({ action: 'follow', handle, url: `https://note.com/${urlname}` });
        follows += 1;
      }
    }
    if (likes < maxLike) {
      const handle = `@${urlname}/n/${id}`;
      const key = `like:${handle.toLowerCase()}`;
      if (!seen.has(key) && !alreadyEngaged.has(key)) {
        seen.add(key);
        out.push({ action: 'like', handle, url: `https://note.com/${urlname}/n/${id}` });
        likes += 1;
      }
    }
    if (follows >= maxFollow && likes >= maxLike) break;
  }
  return out;
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
