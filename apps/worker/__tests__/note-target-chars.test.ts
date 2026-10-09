/**
 * `lib/note-target-chars.ts` — note 記事の目標文字数 (2026-10-09)。
 *
 * もとは無料/有料で同じ 4,000 字を使っていて、有料記事がアカウント方針の下限 (4,000 字) を
 * 割っていた。無料記事は長くしても品質スコアが上がらないことが実測で分かっているので、
 * **有料だけを引き上げる**のがこのモジュールの要点。それが崩れないよう固定する。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TARGET_CHARS_FREE,
  DEFAULT_TARGET_CHARS_PAID,
  resolveTargetChars,
} from '../src/tasks/lib/note-target-chars.js';

describe('resolveTargetChars', () => {
  it('有料記事の既定は無料記事より長い (方針帯 4,000〜7,000 字に入る)', () => {
    expect(DEFAULT_TARGET_CHARS_PAID).toBeGreaterThan(DEFAULT_TARGET_CHARS_FREE);
    expect(DEFAULT_TARGET_CHARS_PAID).toBeGreaterThanOrEqual(4000);
    expect(DEFAULT_TARGET_CHARS_PAID).toBeLessThanOrEqual(7000);
  });

  it('無料記事の既定は方針帯 2,500〜4,000 字に入る', () => {
    expect(DEFAULT_TARGET_CHARS_FREE).toBeGreaterThanOrEqual(2500);
    expect(DEFAULT_TARGET_CHARS_FREE).toBeLessThanOrEqual(4000);
  });

  it('上書きが無ければ課金種別ごとの既定を返す', () => {
    expect(resolveTargetChars(null, false)).toBe(DEFAULT_TARGET_CHARS_FREE);
    expect(resolveTargetChars(null, true)).toBe(DEFAULT_TARGET_CHARS_PAID);
    expect(resolveTargetChars({ free_ratio: 0.3 }, true)).toBe(DEFAULT_TARGET_CHARS_PAID);
  });

  it('アカウントごとの上書きを使う (コードを触らず DB で調整できる)', () => {
    expect(resolveTargetChars({ target_chars_free: 3000 }, false)).toBe(3000);
    expect(resolveTargetChars({ target_chars_paid: 7000 }, true)).toBe(7000);
    // 種別違いの上書きは拾わない。
    expect(resolveTargetChars({ target_chars_paid: 7000 }, false)).toBe(DEFAULT_TARGET_CHARS_FREE);
  });

  it('壊れた上書き (型違い・範囲外・NaN) は無視して既定に倒す', () => {
    for (const bad of [
      { target_chars_paid: '7000' },
      { target_chars_paid: 0 },
      { target_chars_paid: -1 },
      { target_chars_paid: 100 },
      { target_chars_paid: 999999 },
      { target_chars_paid: Number.NaN },
      'not-an-object',
      undefined,
    ]) {
      expect(resolveTargetChars(bad, true)).toBe(DEFAULT_TARGET_CHARS_PAID);
    }
  });
});
