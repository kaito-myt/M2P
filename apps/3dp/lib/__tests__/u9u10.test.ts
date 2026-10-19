import { describe, expect, it } from 'vitest';

import { messages } from '../messages';
import { validateU9U10 } from '../settings-groups-core';
import { formatRefusals, refusalMessage } from '../settings-tabs-core';
import { loadTdpSettings, parseU10, parseU9, settingsFromRow, u9u10Status } from '../tdp-settings';
import { buildU9U10Input, draftFromAnswers } from '../u9u10-core';

const NOW = new Date('2026-10-19T03:00:00.000Z');
const NL = String.fromCharCode(10);
const empty = settingsFromRow(null);
const answered = settingsFromRow({
  tdp_u9_json: { answered_at: '2026-10-01T00:00:00.000Z', shares_pixiv_account: true, note: '旧メモ' },
  tdp_u10_json: { answered_at: '2026-10-01T00:00:00.000Z', booth_share_pct: 30 },
});

describe('validateU9U10', () => {
  it('範囲外 (101 / 負 / NaN / 文字列) は拒否', () => {
    for (const bad of [101, -1, Number.NaN, '50', null, 100.0001]) {
      const r = validateU9U10({ u10: { booth_share_pct: bad } }, empty, NOW);
      expect(r.ok).toBe(false);
    }
  });

  it('0 と 100 と小数は有効な回答で、answered_at が入る', () => {
    for (const ok of [0, 100, 12.5]) {
      const r = validateU9U10({ u10: { booth_share_pct: ok } }, empty, NOW);
      expect(r).toEqual({
        ok: true,
        columns: { tdp_u10_json: { answered_at: NOW.toISOString(), booth_share_pct: ok } },
      });
    }
  });

  it('メモは 500 字まで、501 字は拒否 (前後の空白は数えない)', () => {
    const base = { shares_pixiv_account: false };
    expect(validateU9U10({ u9: { ...base, note: 'あ'.repeat(500) } }, empty, NOW).ok).toBe(true);
    expect(validateU9U10({ u9: { ...base, note: ` ${'あ'.repeat(500)} ` } }, empty, NOW).ok).toBe(true);
    expect(validateU9U10({ u9: { ...base, note: 'あ'.repeat(501) } }, empty, NOW).ok).toBe(false);
  });

  it('はい/いいえが無い・真偽値でない回答は拒否 (メモだけでは回答にならない)', () => {
    expect(validateU9U10({ u9: { note: 'x' } }, empty, NOW).ok).toBe(false);
    expect(validateU9U10({ u9: { shares_pixiv_account: 'yes' } }, empty, NOW).ok).toBe(false);
  });

  it('1 件でも拒否があれば、正しい側も保存対象にしない (all-or-nothing)', () => {
    const r = validateU9U10(
      { u9: { shares_pixiv_account: true, note: 'ok' }, u10: { booth_share_pct: 101 } },
      empty,
      NOW,
    );
    expect(r.ok).toBe(false);
    expect('columns' in r).toBe(false);
  });

  it('未知のキーと空の入力は拒否', () => {
    expect(validateU9U10({}, empty, NOW).ok).toBe(false);
    expect(validateU9U10({ u11: {} }, empty, NOW).ok).toBe(false);
    expect(validateU9U10({ u10: { booth_share_pct: 5, extra: 1 } }, empty, NOW).ok).toBe(false);
  });

  it('再回答は上書き、送らなかった側は columns に出ない', () => {
    const r = validateU9U10({ u10: { booth_share_pct: 10 } }, answered, NOW);
    expect(r).toEqual({
      ok: true,
      columns: { tdp_u10_json: { answered_at: NOW.toISOString(), booth_share_pct: 10 } },
    });
  });

  it('メモは trim して保存し、空でも回答になる', () => {
    const r = validateU9U10({ u9: { shares_pixiv_account: false, note: '  ' } }, empty, NOW);
    expect(r).toEqual({
      ok: true,
      columns: { tdp_u9_json: { answered_at: NOW.toISOString(), shares_pixiv_account: false, note: '' } },
    });
  });
});

describe('拒否文', () => {
  it('列名でなく表示名と、未設定の区別、all-or-nothing の先頭行を出す', () => {
    const r = validateU9U10({ u10: { booth_share_pct: 101 } }, empty, NOW);
    if (r.ok) throw new Error('unreachable');
    const text = refusalMessage(r.refusals, 'fallback');
    expect(text.split(NL)[0]).toContain('何も保存していません');
    expect(text).toContain('U-10 BOOTH 書籍売上の割合');
    expect(text).not.toContain('booth_share_pct');
    expect(text).toContain('101');
    expect(text).toContain('現在の値: 未設定');
    expect(text).toContain('0〜100');
  });

  it('空欄は「空欄」、現在値 0 は「0」(未設定と区別)', () => {
    const zero = settingsFromRow({ tdp_u10_json: { answered_at: '2026-10-01T00:00:00.000Z', booth_share_pct: 0 } });
    const r = validateU9U10({ u10: { booth_share_pct: '' } }, zero, NOW);
    if (r.ok) throw new Error('unreachable');
    const [line] = formatRefusals(r.refusals);
    expect(line).toContain('空欄');
    expect(line).toContain('現在の値: 0');
  });

  it('メモ超過は長文を載せず文字数で出し、はい/いいえは日本語で出す', () => {
    const r = validateU9U10({ u9: { shares_pixiv_account: 'x', note: 'あ'.repeat(501) } }, answered, NOW);
    if (r.ok) throw new Error('unreachable');
    const text = formatRefusals(r.refusals).join(NL);
    expect(text).toContain('501 文字');
    expect(text).not.toContain('あああ');
    expect(text).toContain('現在の値: はい');
  });
});

describe('回答状態の読み出し', () => {
  it('未回答 / 一部 / 回答済 を loadTdpSettings から読める', async () => {
    const load = async (row: Record<string, unknown>) =>
      u9u10Status((await loadTdpSettings({ appSettings: { findUnique: async () => row } })).settings);
    expect(await load({})).toEqual({ state: 'unanswered', u9Answered: false, u10Answered: false });
    expect(await load({ tdp_u10_json: { answered_at: NOW.toISOString(), booth_share_pct: 0 } })).toEqual({
      state: 'unanswered',
      u9Answered: false,
      u10Answered: true,
    });
    expect(
      await load({
        tdp_u9_json: { answered_at: NOW.toISOString(), shares_pixiv_account: false, note: '' },
        tdp_u10_json: { answered_at: NOW.toISOString(), booth_share_pct: 0 },
      }),
    ).toMatchObject({ state: 'answered' });
  });

  it('U-10 の 0 は回答済み、壊れた値は未回答', () => {
    expect(parseU10({ answered_at: NOW.toISOString(), booth_share_pct: 0 })?.booth_share_pct).toBe(0);
    expect(parseU10({ answered_at: NOW.toISOString(), booth_share_pct: 101 })).toBeNull();
    expect(parseU10({ booth_share_pct: 5 })).toBeNull();
    expect(parseU9({ answered_at: NOW.toISOString(), shares_pixiv_account: 'yes' })).toBeNull();
    expect(parseU9([])).toBeNull();
  });

  it('degraded (読めない) では未回答に倒れる', async () => {
    const r = await loadTdpSettings({ appSettings: { findUnique: async () => null } });
    expect(r.degraded).toBe(true);
    expect(u9u10Status(r.settings).state).toBe('unanswered');
  });
});

describe('buildU9U10Input', () => {
  const saved = draftFromAnswers(answered.u9, answered.u10);
  it('変えていなければ送らない', () => {
    expect(buildU9U10Input(saved, saved)).toBeNull();
  });
  it('変えた側だけ送る。空欄は 0 にせず文字列のまま送る', () => {
    expect(buildU9U10Input({ ...saved, pct: '' }, saved)).toEqual({ u10: { booth_share_pct: '' } });
    expect(buildU9U10Input({ ...saved, pct: '0' }, saved)).toEqual({ u10: { booth_share_pct: 0 } });
    expect(buildU9U10Input({ ...saved, note: '新' }, saved)).toEqual({
      u9: { shares_pixiv_account: true, note: '新' },
    });
  });
  it('回答済みの 0 は空欄と別物', () => {
    expect(draftFromAnswers(null, { answered_at: NOW.toISOString(), booth_share_pct: 0 }).pct).toBe('0');
    expect(draftFromAnswers(null, null).pct).toBe('');
  });
});

describe('文言', () => {
  it('U-9/U-10 まわりの文言に「上げ」「増や」を含まない', () => {
    const texts: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') texts.push(v);
      else if (typeof v === 'function') texts.push(String((v as (...a: unknown[]) => unknown)(1, 2, 3)));
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(messages.settings.u9u10);
    expect(texts.length).toBeGreaterThan(10);
    for (const t of texts) {
      expect(t).not.toContain('上げ');
      expect(t).not.toContain('増や');
    }
  });

  it('必須の文言と「下げる」提案がある', () => {
    expect(messages.settings.u9u10.required).toContain('初回の出品の前に必須です');
    expect(messages.settings.u9u10.advice).toContain('R-1');
    expect(messages.settings.u9u10.advice).toContain('下げる');
  });
});
