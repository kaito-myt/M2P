/**
 * 販促投稿の予約時刻計算 (JST 暦日ベース)。純関数 (DB 非依存) でユニットテスト可能。
 * `promotion-note-article.ts` / `promotion-note-article-video.ts` の両方から使う共通実装
 * (両者間の循環 import を避けるためここに切り出す)。
 */

/** JST 暦日 `now+dayOffset日` の 00:00〜24:00 を UTC Date の範囲として返す(頻度カウント用)。 */
export function jstDayBoundsUtc(now: Date, dayOffset: number): { start: Date; end: Date } {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  const start = new Date(Date.UTC(y, m, d + dayOffset, 0, 0, 0) - 9 * 3600_000);
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

/** JST 暦日 `now+dayOffset日` の `minuteOfDayJst` 分 (0-1439) を UTC Date で返す。 */
export function offpeakScheduledForUtc(now: Date, dayOffset: number, minuteOfDayJst: number): Date {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const d = jst.getUTCDate();
  const hh = Math.floor(minuteOfDayJst / 60);
  const mm = minuteOfDayJst % 60;
  return new Date(Date.UTC(y, m, d + dayOffset, hh, mm) - 9 * 3600_000);
}
