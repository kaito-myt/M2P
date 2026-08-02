import { describe, it, expect } from 'vitest';

import {
  scheduleToCron,
  cronToSchedule,
  describeScheduleJst,
  parseHhmm,
  type Schedule,
} from '@/lib/schedule-builder';

describe('scheduleToCron (JST → UTC cron)', () => {
  it('毎日 02:00 JST → 0 17 * * * (UTC)', () => {
    expect(scheduleToCron({ mode: 'daily', hour: 2, minute: 0 })).toBe('0 17 * * *');
  });
  it('毎日 10:30 JST → 30 1 * * *', () => {
    expect(scheduleToCron({ mode: 'daily', hour: 10, minute: 30 })).toBe('30 1 * * *');
  });
  it('毎週月 09:00 JST → 0 0 * * 1', () => {
    expect(scheduleToCron({ mode: 'weekly', weekday: 1, hour: 9, minute: 0 })).toBe('0 0 * * 1');
  });
  it('毎週月 08:00 JST → 0 23 * * 0 (前日にずれる)', () => {
    expect(scheduleToCron({ mode: 'weekly', weekday: 1, hour: 8, minute: 0 })).toBe('0 23 * * 0');
  });
  it('毎時0分', () => {
    expect(scheduleToCron({ mode: 'hourly', everyHours: 1, minute: 0 })).toBe('0 * * * *');
  });
  it('6時間ごと', () => {
    expect(scheduleToCron({ mode: 'hourly', everyHours: 6, minute: 15 })).toBe('15 */6 * * *');
  });
  it('custom はそのまま', () => {
    expect(scheduleToCron({ mode: 'custom', cron: '5 4 * * 2' })).toBe('5 4 * * 2');
  });
});

describe('cronToSchedule (UTC cron → JST Schedule)', () => {
  it('0 17 * * * → 毎日 02:00 JST', () => {
    expect(cronToSchedule('0 17 * * *')).toEqual({ mode: 'daily', hour: 2, minute: 0 });
  });
  it('0 0 * * 1 → 毎週月 09:00 JST', () => {
    expect(cronToSchedule('0 0 * * 1')).toEqual({ mode: 'weekly', weekday: 1, hour: 9, minute: 0 });
  });
  it('0 23 * * 0 → 毎週月 08:00 JST (翌日にずれる)', () => {
    expect(cronToSchedule('0 23 * * 0')).toEqual({ mode: 'weekly', weekday: 1, hour: 8, minute: 0 });
  });
  it('0 */6 * * * → 6時間ごと', () => {
    expect(cronToSchedule('0 */6 * * *')).toEqual({ mode: 'hourly', everyHours: 6, minute: 0 });
  });
  it('0 * * * * → 毎時', () => {
    expect(cronToSchedule('0 * * * *')).toEqual({ mode: 'hourly', everyHours: 1, minute: 0 });
  });
  it('複雑な式は custom', () => {
    expect(cronToSchedule('0 0 1 * *')).toEqual({ mode: 'custom', cron: '0 0 1 * *' });
    expect(cronToSchedule('bad')).toEqual({ mode: 'custom', cron: 'bad' });
  });
});

describe('round-trip (JST → cron → JST)', () => {
  const cases: Schedule[] = [
    { mode: 'daily', hour: 0, minute: 0 },
    { mode: 'daily', hour: 6, minute: 45 },
    { mode: 'daily', hour: 23, minute: 59 },
    { mode: 'weekly', weekday: 0, hour: 3, minute: 0 },
    { mode: 'weekly', weekday: 6, hour: 8, minute: 30 },
    { mode: 'weekly', weekday: 3, hour: 12, minute: 0 },
    { mode: 'hourly', everyHours: 4, minute: 10 },
  ];
  for (const s of cases) {
    it(`${describeScheduleJst(s)} が保持される`, () => {
      expect(cronToSchedule(scheduleToCron(s))).toEqual(s);
    });
  }
});

describe('parseHhmm', () => {
  it('正常', () => {
    expect(parseHhmm('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(parseHhmm('23:59')).toEqual({ hour: 23, minute: 59 });
  });
  it('不正は null', () => {
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('abc')).toBeNull();
    expect(parseHhmm('9')).toBeNull();
  });
});
