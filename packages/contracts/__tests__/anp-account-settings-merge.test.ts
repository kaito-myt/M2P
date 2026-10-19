import { describe, expect, it } from 'vitest';

import { mergeNoteAccountSettings, NoteAccountSettingsSchema } from '../src/agents/anp.js';

describe('mergeNoteAccountSettings', () => {
  it('worker が書く engage_* を保持し、本番の themes_per_day / paid_publish_enabled も生き残る', () => {
    const current = {
      themes_per_day: 3,
      paid_publish_enabled: true,
      engage_ramp_started_at: '2026-10-15T00:00:00.000Z',
      engage_scout_date: '2026-10-19',
      engage_usage: { day: '2026-10-19', follow: 12, like: 20 },
    };
    const next = NoteAccountSettingsSchema.parse({ themes_per_day: 3, paid_publish_enabled: true });
    expect(mergeNoteAccountSettings(current, next)).toEqual(current);
  });

  it('フォームで未指定にした既知キーは削除される (グローバルに従う)', () => {
    const merged = mergeNoteAccountSettings(
      { themes_per_day: 3, paid_publish_enabled: true, engage_usage: { day: 'x', follow: 1, like: 1 } },
      NoteAccountSettingsSchema.parse({ paid_publish_enabled: true }),
    );
    expect(merged).toEqual({ paid_publish_enabled: true, engage_usage: { day: 'x', follow: 1, like: 1 } });
  });

  it('現在値が null / 配列 / 文字列でも落ちない', () => {
    for (const cur of [null, undefined, [], 'x']) {
      expect(mergeNoteAccountSettings(cur, { themes_per_day: 2 })).toEqual({ themes_per_day: 2 });
    }
  });
});
