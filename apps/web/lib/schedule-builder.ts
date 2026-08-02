/**
 * schedule-builder.ts — JST ベースの「実行スケジュール」⇄ UTC cron 変換 (純関数)。
 *
 * 運営者は cron を直接書かず、毎日/毎週/毎時 + JST 時刻で指定する。
 * worker の crontab は UTC 解釈なので、保存する cron 式は UTC に変換する。
 * 日本標準時は UTC+9 固定 (サマータイム無し) なので分は不変・時のみ +9/-9 する。
 */

const JST_OFFSET_H = 9;
const MIN_PER_DAY = 24 * 60;

export type Schedule =
  | { mode: 'daily'; hour: number; minute: number } // JST
  | { mode: 'weekly'; weekday: number; hour: number; minute: number } // JST, weekday 0=日..6=土
  | { mode: 'hourly'; everyHours: number; minute: number }
  | { mode: 'custom'; cron: string }; // UTC cron をそのまま

export const WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** JST の「時:分」を UTC cron 用の {utcHour, minute} に変換 (分は不変)。 */
function jstToUtcHour(hour: number, minute: number): { utcHour: number; dayShift: number } {
  const total = hour * 60 + minute - JST_OFFSET_H * 60;
  const norm = ((total % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const utcHour = Math.floor(norm / 60);
  const dayShift = total < 0 ? -1 : total >= MIN_PER_DAY ? 1 : 0;
  return { utcHour, dayShift };
}

/** UTC の {hour, minute} を JST に変換。 */
function utcToJst(hour: number, minute: number): { hour: number; minute: number; dayShift: number } {
  const total = hour * 60 + minute + JST_OFFSET_H * 60;
  const norm = ((total % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return {
    hour: Math.floor(norm / 60),
    minute: norm % 60,
    dayShift: total >= MIN_PER_DAY ? 1 : total < 0 ? -1 : 0,
  };
}

/** Schedule → UTC cron 式。 */
export function scheduleToCron(s: Schedule): string {
  switch (s.mode) {
    case 'daily': {
      const { utcHour } = jstToUtcHour(s.hour, s.minute);
      return `${s.minute} ${utcHour} * * *`;
    }
    case 'weekly': {
      const { utcHour, dayShift } = jstToUtcHour(s.hour, s.minute);
      const utcDow = ((s.weekday + dayShift) % 7 + 7) % 7;
      return `${s.minute} ${utcHour} * * ${utcDow}`;
    }
    case 'hourly': {
      const n = Math.max(1, Math.min(23, Math.round(s.everyHours)));
      return n === 1 ? `${s.minute} * * * *` : `${s.minute} */${n} * * *`;
    }
    case 'custom':
      return s.cron.trim();
  }
}

/** UTC cron 式 → Schedule (可能なら daily/weekly/hourly、無理なら custom)。 */
export function cronToSchedule(cron: string): Schedule {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return { mode: 'custom', cron: cron.trim() };
  const [minF, hourF, dayF, monF, dowF] = f as [string, string, string, string, string];

  const isNum = (x: string) => /^\d+$/.test(x);
  const minute = isNum(minF) ? parseInt(minF, 10) : NaN;

  // hourly: 分固定 + 時が * または */N、日/月/曜が *
  if (isNum(minF) && dayF === '*' && monF === '*' && dowF === '*') {
    if (hourF === '*') return { mode: 'hourly', everyHours: 1, minute };
    const stp = /^\*\/(\d+)$/.exec(hourF);
    if (stp) return { mode: 'hourly', everyHours: parseInt(stp[1]!, 10), minute };
  }

  // daily: 分・時が数値、日/月/曜が *
  if (isNum(minF) && isNum(hourF) && dayF === '*' && monF === '*' && dowF === '*') {
    const j = utcToJst(parseInt(hourF, 10), minute);
    return { mode: 'daily', hour: j.hour, minute: j.minute };
  }

  // weekly: 分・時・曜が数値、日/月が *
  if (isNum(minF) && isNum(hourF) && dayF === '*' && monF === '*' && isNum(dowF)) {
    const j = utcToJst(parseInt(hourF, 10), minute);
    const jstDow = ((parseInt(dowF, 10) + j.dayShift) % 7 + 7) % 7;
    return { mode: 'weekly', weekday: jstDow, hour: j.hour, minute: j.minute };
  }

  return { mode: 'custom', cron: cron.trim() };
}

/** Schedule を人間可読の JST ラベルにする (プレビュー表示用)。 */
export function describeScheduleJst(s: Schedule): string {
  switch (s.mode) {
    case 'daily':
      return `毎日 ${pad2(s.hour)}:${pad2(s.minute)}（JST）`;
    case 'weekly':
      return `毎週${WEEKDAY_LABELS_JA[s.weekday]}曜 ${pad2(s.hour)}:${pad2(s.minute)}（JST）`;
    case 'hourly':
      return s.everyHours === 1
        ? `毎時 ${pad2(s.minute)}分`
        : `${s.everyHours}時間ごと（${pad2(s.minute)}分）`;
    case 'custom':
      return `カスタム: ${s.cron}（UTC）`;
  }
}

/** time input ("HH:MM") → {hour, minute}。不正なら null。 */
export function parseHhmm(v: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hour = parseInt(m[1]!, 10);
  const minute = parseInt(m[2]!, 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function toHhmm(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}
