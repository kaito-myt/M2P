/**
 * KDP 入稿キューの「入稿予定時刻」推定 (F-041)。
 *
 * サーバー側の自動入稿は `kdp.submit.dispatch` cron（既定 30 分間隔）が
 * `AppSettings.kdp_auto_submit_enabled=true` のときだけ動き、**1 tick につき 1 冊**
 * （`updated_at` 昇順・クールダウン(`kdp_submit_cooldown_until`)を過ぎた本のうち先頭）を
 * `kdp.submit` へ投入する。したがって各書籍の入稿予定は
 *   「自動入稿が有効か」×「キュー内の順番」×「クールダウン」×「cron 間隔」
 * で決まる。ここではその挙動をそのままシミュレートして予定時刻を出す（純関数・テスト可能）。
 *
 * cron はサーバー時刻（Railway=UTC）で評価される前提で UTC フィールドを突き合わせる。
 * 返す時刻は実インスタンス（ISO）で、表示側で JST に整形する。
 */

export interface QueuedBookInput {
  id: string;
  /** キュー順（dispatcher は updated_at 昇順で先頭から処理）。 */
  updatedAt: Date;
  /** これを過ぎるまで dispatcher に選ばれない（作成上限/下書き不在等のクールダウン）。null=なし。 */
  cooldownUntil: Date | null;
}

export type SubmitEtaReason = 'auto_off' | 'scheduled' | 'cooldown_far';

export interface SubmitEta {
  /** 予定時刻（ISO）。auto_off や算出不能なら null。 */
  etaIso: string | null;
  reason: SubmitEtaReason;
}

/* ── cron マッチャ（標準5フィールド: 分 時 日 月 曜） ───────────────── */

/** 1フィールドを「その数値が該当するか」の述語へ。ワイルドカード・単値・範囲(a-b)・
 *  ステップ(範囲/nや全体ステップ)・リスト(a,b)に対応。 */
function parseCronField(expr: string, min: number, max: number): (n: number) => boolean {
  const preds = expr.split(',').map((partRaw) => {
    const part = partRaw.trim();
    let step = 1;
    let body = part;
    const slash = part.split('/');
    if (slash.length === 2) {
      step = Math.max(1, Number(slash[1]) || 1);
      body = slash[0]!;
    }
    let lo = min;
    let hi = max;
    if (body === '*' || body === '') {
      // 全域
    } else if (body.includes('-')) {
      const [a, b] = body.split('-').map((x) => Number(x));
      lo = Number.isFinite(a) ? (a as number) : min;
      hi = Number.isFinite(b) ? (b as number) : max;
    } else {
      const v = Number(body);
      lo = hi = Number.isFinite(v) ? v : min;
    }
    return (n: number): boolean => n >= lo && n <= hi && (n - lo) % step === 0;
  });
  return (n: number) => preds.some((p) => p(n));
}

interface CronMatcher {
  minute: (n: number) => boolean;
  hour: (n: number) => boolean;
  dom: (n: number) => boolean;
  month: (n: number) => boolean;
  dow: (n: number) => boolean;
  domRestricted: boolean;
  dowRestricted: boolean;
}

/** cron 文字列を matcher に。パース不能なら null（呼び出し側で既定に倒す）。 */
export function parseCron(cron: string): CronMatcher | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  try {
    return {
      minute: parseCronField(f[0]!, 0, 59),
      hour: parseCronField(f[1]!, 0, 23),
      dom: parseCronField(f[2]!, 1, 31),
      month: parseCronField(f[3]!, 1, 12),
      dow: parseCronField(f[4]!, 0, 7),
      domRestricted: f[2]!.trim() !== '*',
      dowRestricted: f[4]!.trim() !== '*',
    };
  } catch {
    return null;
  }
}

function matchesCron(m: CronMatcher, d: Date): boolean {
  if (!m.minute(d.getUTCMinutes())) return false;
  if (!m.hour(d.getUTCHours())) return false;
  if (!m.month(d.getUTCMonth() + 1)) return false;
  const domOk = m.dom(d.getUTCDate());
  const dowRaw = d.getUTCDay(); // 0=Sun
  const dowOk = m.dow(dowRaw) || m.dow(dowRaw === 0 ? 7 : dowRaw); // 0 と 7 は日曜
  // 標準 cron: 日と曜の両方が制限されている場合は OR、片方だけなら制限側を適用。
  if (m.domRestricted && m.dowRestricted) return domOk || dowOk;
  if (m.domRestricted) return domOk;
  if (m.dowRestricted) return dowOk;
  return true;
}

const DEFAULT_CRON = '*/30 * * * *';
const MINUTE_MS = 60_000;

/**
 * `from` より後の cron 一致時刻を最大 `count` 個返す（分刻みで走査）。
 * `maxWindowMs` を超えたら打ち切り（無限ループ防止）。
 */
export function nextCronRuns(
  cron: string,
  from: Date,
  count: number,
  maxWindowMs = 30 * 24 * 60 * MINUTE_MS,
): Date[] {
  const matcher = parseCron(cron) ?? parseCron(DEFAULT_CRON)!;
  const runs: Date[] = [];
  // 次の分境界から開始（現在の分は過ぎた扱い）。
  let t = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const end = from.getTime() + maxWindowMs;
  while (runs.length < count && t <= end) {
    const d = new Date(t);
    if (matchesCron(matcher, d)) runs.push(d);
    t += MINUTE_MS;
  }
  return runs;
}

/**
 * 入稿キューの各書籍の入稿予定を推定する。
 * dispatcher の「1 tick 1 冊・updated_at 昇順・クールダウン考慮」をそのまま再現。
 */
export function computeSubmitSchedule(args: {
  now: Date;
  cron: string;
  enabled: boolean;
  books: QueuedBookInput[];
}): Map<string, SubmitEta> {
  const { now, cron, enabled, books } = args;
  const out = new Map<string, SubmitEta>();
  if (!enabled) {
    for (const b of books) out.set(b.id, { etaIso: null, reason: 'auto_off' });
    return out;
  }
  const sorted = [...books].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
  // 冊数ぶん＋クールダウン待ちの余裕を見て cron 実行時刻を用意。
  const runs = nextCronRuns(cron, now, sorted.length + 300);
  const assigned = new Set<string>();
  for (const run of runs) {
    if (assigned.size === sorted.length) break;
    const pick = sorted.find(
      (b) => !assigned.has(b.id) && (!b.cooldownUntil || b.cooldownUntil.getTime() <= run.getTime()),
    );
    if (pick) {
      assigned.add(pick.id);
      out.set(pick.id, { etaIso: run.toISOString(), reason: 'scheduled' });
    }
  }
  // 走査窓内に枠が来なかった本（クールダウンが遠い等）。
  for (const b of sorted) {
    if (!assigned.has(b.id)) {
      out.set(b.id, { etaIso: b.cooldownUntil?.toISOString() ?? null, reason: 'cooldown_far' });
    }
  }
  return out;
}

/** 予定時刻を JST の「M/D HH:mm」に整形。 */
export function formatEtaJst(etaIso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(etaIso));
}

/** 表示用ラベル（例: 「入稿予定 8/27 15:30 頃」/「自動入稿OFF」/「入稿予定 未定」）。 */
export function submitEtaLabel(eta: SubmitEta): string {
  if (eta.reason === 'auto_off') return '自動入稿OFF';
  if (!eta.etaIso) return '入稿予定 未定';
  const jst = formatEtaJst(eta.etaIso);
  return eta.reason === 'cooldown_far' ? `入稿予定 ${jst} 以降` : `入稿予定 ${jst} 頃`;
}
