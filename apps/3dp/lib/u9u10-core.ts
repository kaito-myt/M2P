/**
 * U-9 / U-10 回答欄 (F-3DP-42) の画面用ロジック。検証は settings-groups-core の validateU9U10 が持つ。
 * ここは「入力欄 → 送る値」と表示用の整形だけ。入力を丸めない (範囲外はサーバーに拒否させる)。
 */
import { parseFieldInput } from './settings-tabs-core';
import type { U10Answer, U9Answer } from './tdp-settings';

export type SharesChoice = 'yes' | 'no' | '';

export interface U9U10Draft {
  shares: SharesChoice;
  note: string;
  pct: string;
}

export function draftFromAnswers(u9: U9Answer | null, u10: U10Answer | null): U9U10Draft {
  return {
    shares: u9 ? (u9.shares_pixiv_account ? 'yes' : 'no') : '',
    note: u9?.note ?? '',
    // 0 は回答。未回答 (null) だけを空欄にする。
    pct: u10 ? String(u10.booth_share_pct) : '',
  };
}

/** 変えた側だけを送る (変えていない側の answered_at を動かさない)。何も変えていなければ null。 */
export function buildU9U10Input(draft: U9U10Draft, saved: U9U10Draft): Record<string, unknown> | null {
  const input: Record<string, unknown> = {};
  if (draft.shares !== saved.shares || draft.note.trim() !== saved.note.trim()) {
    input.u9 = {
      shares_pixiv_account: draft.shares === 'yes' ? true : draft.shares === 'no' ? false : undefined,
      note: draft.note,
    };
  }
  if (draft.pct.trim() !== saved.pct.trim()) {
    input.u10 = { booth_share_pct: parseFieldInput(draft.pct, false) };
  }
  return Object.keys(input).length > 0 ? input : null;
}

/** 回答日時 (JST)。壊れた値は null。 */
export function formatAnsweredAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
