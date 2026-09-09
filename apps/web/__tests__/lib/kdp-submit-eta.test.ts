import { describe, expect, it } from 'vitest';

import {
  computeSubmitSchedule,
  nextCronRuns,
  parseCron,
  submitEtaLabel,
} from '@/lib/kdp-submit-eta';

describe('parseCron / nextCronRuns', () => {
  it('*/30 は毎時00分と30分に一致する', () => {
    // 2026-08-27T10:05:00Z から次の3回 → 10:30, 11:00, 11:30 (UTC)
    const runs = nextCronRuns('*/30 * * * *', new Date('2026-08-27T10:05:00Z'), 3);
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-08-27T10:30:00.000Z',
      '2026-08-27T11:00:00.000Z',
      '2026-08-27T11:30:00.000Z',
    ]);
  });

  it('分境界ちょうどの現在時刻は「過ぎた」扱いで次の枠を返す', () => {
    const runs = nextCronRuns('*/30 * * * *', new Date('2026-08-27T10:30:00Z'), 1);
    expect(runs[0]!.toISOString()).toBe('2026-08-27T11:00:00.000Z');
  });

  it('特定時刻 cron (0 23 * * *) を解釈できる', () => {
    const runs = nextCronRuns('0 23 * * *', new Date('2026-08-27T10:00:00Z'), 2);
    expect(runs.map((d) => d.toISOString())).toEqual([
      '2026-08-27T23:00:00.000Z',
      '2026-08-28T23:00:00.000Z',
    ]);
  });

  it('不正な cron は null（呼び出し側で既定に倒す）', () => {
    expect(parseCron('not a cron')).toBeNull();
    expect(parseCron('*/30 * * *')).toBeNull(); // 4フィールド
  });
});

describe('computeSubmitSchedule', () => {
  const now = new Date('2026-08-27T10:05:00Z');
  const cron = '*/30 * * * *';

  it('自動入稿OFFなら全書籍が auto_off', () => {
    const sched = computeSubmitSchedule({
      now,
      cron,
      enabled: false,
      books: [{ id: 'a', updatedAt: new Date('2026-08-27T09:00:00Z'), cooldownUntil: null }],
    });
    expect(sched.get('a')).toEqual({ etaIso: null, reason: 'auto_off' });
  });

  it('1 tick 1 冊: updated_at 昇順に 30 分ずつずれて予定が入る', () => {
    const sched = computeSubmitSchedule({
      now,
      cron,
      enabled: true,
      books: [
        { id: 'newer', updatedAt: new Date('2026-08-27T09:30:00Z'), cooldownUntil: null },
        { id: 'older', updatedAt: new Date('2026-08-27T09:00:00Z'), cooldownUntil: null },
      ],
    });
    // older(先) → 10:30、newer(後) → 11:00
    expect(sched.get('older')).toEqual({ etaIso: '2026-08-27T10:30:00.000Z', reason: 'scheduled' });
    expect(sched.get('newer')).toEqual({ etaIso: '2026-08-27T11:00:00.000Z', reason: 'scheduled' });
  });

  it('クールダウン中の本はその時刻以降の枠まで飛ばされ、後続が先に処理される', () => {
    const sched = computeSubmitSchedule({
      now,
      cron,
      enabled: true,
      books: [
        // 先頭だが 12:10 までクールダウン → 12:30 枠へ
        { id: 'cooldown', updatedAt: new Date('2026-08-27T09:00:00Z'), cooldownUntil: new Date('2026-08-27T12:10:00Z') },
        // 後だがクールダウン無し → 先に 10:30
        { id: 'free', updatedAt: new Date('2026-08-27T09:30:00Z'), cooldownUntil: null },
      ],
    });
    expect(sched.get('free')!.etaIso).toBe('2026-08-27T10:30:00.000Z');
    expect(sched.get('cooldown')!.etaIso).toBe('2026-08-27T12:30:00.000Z');
    expect(sched.get('cooldown')!.reason).toBe('scheduled');
  });

  it('submitEtaLabel の表示', () => {
    expect(submitEtaLabel({ etaIso: null, reason: 'auto_off' })).toBe('自動入稿OFF');
    expect(submitEtaLabel({ etaIso: '2026-08-27T06:30:00.000Z', reason: 'scheduled' })).toBe('入稿予定 8/27 15:30 頃');
    expect(submitEtaLabel({ etaIso: '2026-08-27T06:30:00.000Z', reason: 'cooldown_far' })).toBe('入稿予定 8/27 15:30 以降');
  });
});
