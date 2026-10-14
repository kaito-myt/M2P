import { describe, expect, it } from 'vitest';

import {
  CREATION_LIMIT_BACKOFF_MS,
  creationLimitPauseUntil,
  nextJstMidnightUtc,
  nextWeeklyCreationResetUtc,
} from '../src/tasks/kdp-submit.js';

describe('creationLimitPauseUntil (2026-09-25 の 0 冊問題の修正)', () => {
  it('作成数制限に当たったら 6 時間後に再挑戦する (以前は翌 JST 0 時まで止めていた)', () => {
    // JST 0:07 = 15:07 UTC。以前はここで「翌 JST 0 時 = 24h 後」まで止めていたため
    // 1 日 1 回しか試せず、5 日連続 0 冊になっていた。
    const now = new Date('2026-09-25T15:07:00.000Z');
    const until = creationLimitPauseUntil(now);
    expect(until.getTime() - now.getTime()).toBe(CREATION_LIMIT_BACKOFF_MS);
    expect(CREATION_LIMIT_BACKOFF_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('次の JST 0 時が 6 時間より近いならそちらを使う (枠のリセット境界を逃さない)', () => {
    // 13:00 UTC → JST 0 時 (15:00 UTC) まで 2 時間。6 時間待つより早く試す。
    const now = new Date('2026-09-25T13:00:00.000Z');
    const until = creationLimitPauseUntil(now);
    expect(until.toISOString()).toBe(nextJstMidnightUtc(now).toISOString());
    expect(until.getTime() - now.getTime()).toBeLessThan(CREATION_LIMIT_BACKOFF_MS);
  });

  it('常に未来を返す', () => {
    for (const iso of ['2026-09-25T00:00:00.000Z', '2026-09-25T14:59:00.000Z', '2026-09-25T23:30:00.000Z']) {
      const now = new Date(iso);
      expect(creationLimitPauseUntil(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('nextWeeklyCreationResetUtc (2026-10-14 実測: 作成上限は週次)', () => {
  // Amazon のモーダル:「このフォーマットの週間タイトル作成数が上限に達しました。
  // 制限は日曜日の午前 0 時 (UTC/協定世界時) にリセットされます」
  it('週の途中なら次の日曜 0:00 UTC を返す', () => {
    const now = new Date('2026-10-14T05:56:00.000Z'); // 水曜
    const until = nextWeeklyCreationResetUtc(now);
    expect(until.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(until.getUTCDay()).toBe(0);
  });

  it('日曜 0:00 ちょうどを過ぎていたら翌週の日曜を返す (常に未来)', () => {
    const now = new Date('2026-10-18T00:00:00.000Z');
    expect(nextWeeklyCreationResetUtc(now).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('日曜の日中なら同じ週ではなく翌日曜 (枠は既にリセット済みのため)', () => {
    const now = new Date('2026-10-18T10:00:00.000Z');
    expect(nextWeeklyCreationResetUtc(now).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });

  it('週次リセットが 6 時間より近いならクールダウンはそこで明ける', () => {
    // 土曜 21:00 UTC → 日曜 0:00 UTC まで 3 時間。
    const now = new Date('2026-10-17T21:00:00.000Z');
    const until = creationLimitPauseUntil(now);
    expect(until.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(until.getTime() - now.getTime()).toBeLessThan(CREATION_LIMIT_BACKOFF_MS);
  });
});
