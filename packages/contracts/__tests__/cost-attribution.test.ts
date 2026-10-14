import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOOL,
  TOOL_KEYS,
  TOOL_LABEL,
  TOOL_SHORT_LABEL,
  defaultToolForRole,
  isToolKey,
  jstMonthRange,
  jstYearMonth,
  normalizeToolKey,
} from '../src/cost-attribution';

describe('defaultToolForRole', () => {
  it('anp.* 名前空間は ANP', () => {
    for (const role of ['anp.theme', 'anp.writer', 'anp.judge', 'anp.eyecatch', 'anp.promo']) {
      expect(defaultToolForRole(role)).toBe('anp');
    }
  });

  it('書籍パイプラインは A2P', () => {
    for (const role of ['marketer', 'writer', 'editor', 'judge', 'thumbnail_image', 'seo_optimizer']) {
      expect(defaultToolForRole(role)).toBe('a2p');
    }
  });

  it('1 冊の本を見る組織ロールは A2P (入力が書籍に閉じている)', () => {
    for (const role of ['metadata_worker', 'sales_analyst', 'market_analyst']) {
      expect(defaultToolForRole(role)).toBe('a2p');
    }
  });

  it('事業全体を見る役は M2P', () => {
    for (const role of [
      'ceo',
      'ceo_chat',
      'prompt_editor',
      'editorial_mgr',
      'publish_mgr',
      'analytics_mgr',
      'promo_mgr',
      'ops_mgr',
      'finance_mgr',
      'cost_optimizer',
      'cost_accountant',
      'promo_analyst',
      'account_strategist',
    ]) {
      expect(defaultToolForRole(role)).toBe('m2p');
    }
  });

  it('共有エージェントは既定 A2P (ANP から呼ぶ側が明示的に上書きする)', () => {
    // growth_scout は note.engage(ANP) と promotion.growth.todo(A2P) の両方から
    // channel='note' で呼ばれるので、既定では判別できない。
    expect(defaultToolForRole('growth_scout')).toBe('a2p');
    expect(defaultToolForRole('promo_strategist')).toBe('a2p');
    expect(defaultToolForRole('content_creator')).toBe('a2p');
  });

  it('未知の role は既定へ倒す', () => {
    expect(defaultToolForRole('something_new')).toBe(DEFAULT_TOOL);
    expect(DEFAULT_TOOL).toBe('a2p');
  });

  it('接頭辞が似ているだけの role を ANP にしない', () => {
    expect(defaultToolForRole('anpanman')).toBe('a2p');
    expect(defaultToolForRole('my.anp.writer')).toBe('a2p');
  });
});

describe('isToolKey / normalizeToolKey', () => {
  it('値域を判定する', () => {
    expect(isToolKey('a2p')).toBe(true);
    expect(isToolKey('anp')).toBe(true);
    expect(isToolKey('m2p')).toBe(true);
    expect(isToolKey('A2P')).toBe(false);
    expect(isToolKey(null)).toBe(false);
    expect(isToolKey(undefined)).toBe(false);
    expect(isToolKey(1)).toBe(false);
  });

  it('DB から読んだ未知値/NULL は既定に寄せる', () => {
    expect(normalizeToolKey('anp')).toBe('anp');
    expect(normalizeToolKey(null)).toBe('a2p');
    expect(normalizeToolKey('legacy')).toBe('a2p');
  });
});

describe('ラベル', () => {
  it('全キーにラベルがある', () => {
    for (const t of TOOL_KEYS) {
      expect(TOOL_LABEL[t]).toBeTruthy();
      expect(TOOL_SHORT_LABEL[t]).toBeTruthy();
    }
  });

  it('キーは 4 つ (a2p / anp / 3dp / m2p)', () => {
    expect([...TOOL_KEYS]).toEqual(['a2p', 'anp', '3dp', 'm2p']);
  });

  it('tdp.* の role は 3dp に帰属する (docs/12 §7)', () => {
    expect(defaultToolForRole('tdp.research')).toBe('3dp');
    expect(defaultToolForRole('tdp.planner')).toBe('3dp');
    // 名前空間が違う役はこれまで通り
    expect(defaultToolForRole('anp.theme')).toBe('anp');
    expect(defaultToolForRole('writer')).toBe('a2p');
    expect(defaultToolForRole('ceo')).toBe('m2p');
  });
});

describe('jstMonthRange / jstYearMonth', () => {
  it('JST 月初は UTC 月初 -9h', () => {
    // 2026-10-13 10:28 JST
    const r = jstMonthRange(new Date('2026-10-13T01:28:00.000Z'));
    expect(r.prevMonthStart.toISOString()).toBe('2026-08-31T15:00:00.000Z'); // 9/1 00:00 JST
    expect(r.monthStart.toISOString()).toBe('2026-09-30T15:00:00.000Z'); // 10/1 00:00 JST
    expect(r.nextMonthStart.toISOString()).toBe('2026-10-31T15:00:00.000Z'); // 11/1 00:00 JST
  });

  it('UTC では前月末でも JST では当月として扱う', () => {
    // 2026-09-30 16:00 UTC = 2026-10-01 01:00 JST
    const t = new Date('2026-09-30T16:00:00.000Z');
    expect(jstYearMonth(t)).toBe('2026-10');
    expect(jstMonthRange(t).monthStart.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('UTC では当月でも JST 月初前なら前月として扱う', () => {
    // 2026-09-30 14:59 UTC = 2026-09-30 23:59 JST
    const t = new Date('2026-09-30T14:59:00.000Z');
    expect(jstYearMonth(t)).toBe('2026-09');
  });

  it('年をまたぐ', () => {
    const t = new Date('2026-01-05T00:00:00.000Z');
    expect(jstYearMonth(t)).toBe('2026-01');
    expect(jstMonthRange(t).prevMonthStart.toISOString()).toBe('2025-11-30T15:00:00.000Z');
    expect(jstMonthRange(t).monthStart.toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('12月の翌月初が翌年1月になる', () => {
    const t = new Date('2026-12-20T00:00:00.000Z');
    expect(jstMonthRange(t).nextMonthStart.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });
});
