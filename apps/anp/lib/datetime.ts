/**
 * 日時表示ヘルパ (F-ANP-52)。
 *
 * サーバ (Railway コンテナ = UTC) でもクライアント (ブラウザの TZ) でも、**必ず JST 固定**で
 * 整形する。`toLocaleString('ja-JP')` は**ロケールを決めるだけでタイムゾーンは実行環境依存**
 * なので、サーバーコンポーネントで使うと UTC のまま「ja-JP 書式」で出てしまい 9 時間ずれる
 * (運営者指摘 2026-09-29「記事一覧の公開日時って JST になってる？」)。
 *
 * A2P 側の `apps/web/lib/datetime.ts` と同じ方針・同じ書式に揃えてある。
 */
const JST = 'Asia/Tokyo';

const DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DATE_ONLY = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const SHORT_DATE_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(fmt: Intl.DateTimeFormat, d: Date): Record<string, string> {
  return Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
}

/** "YYYY-MM-DD HH:mm" (JST)。null/不正は "-"。 */
export function formatJstDateTime(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  const p = parts(DATE_TIME, d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DD" (JST)。null/不正は "-"。 */
export function formatJstDate(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  const p = parts(DATE_ONLY, d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "MM-DD HH:mm" (JST)。一覧など横幅が狭いところ用。null/不正は "-"。 */
export function formatJstShort(input: Date | string | number | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  const p = parts(SHORT_DATE_TIME, d);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
