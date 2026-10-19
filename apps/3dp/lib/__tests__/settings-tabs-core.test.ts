import { describe, expect, it } from 'vitest';

import { messages } from '../messages';
import { SETTINGS_GROUPS, groupKeys, proposalState, buildConfirmed } from '../settings-groups-core';
import {
  SETTINGS_TABS,
  buildFieldViews,
  confirmedAt,
  fieldInputText,
  formatRefusals,
  refusalMessage,
  parseFieldInput,
  resolveTab,
} from '../settings-tabs-core';
import { settingsFromRow } from '../tdp-settings';

const settings = settingsFromRow(null);

describe('resolveTab', () => {
  it('未指定・未知・空は safety', () => {
    expect(resolveTab(undefined)).toBe('safety');
    expect(resolveTab('bogus')).toBe('safety');
    expect(resolveTab('')).toBe('safety');
    expect(resolveTab('media')).toBe('safety');
    expect(resolveTab(['gates', 'x'])).toBe('gates');
  });
  it('4 タブすべてを解決する', () => {
    for (const t of SETTINGS_TABS) expect(resolveTab(t)).toBe(t);
  });
});

describe('タブ構成', () => {
  it('Inc-1 のタブは 4 つで、無い group は media だけ (§7.3a)', () => {
    expect(SETTINGS_TABS).toHaveLength(4);
    expect(SETTINGS_GROUPS.filter((g) => !(SETTINGS_TABS as readonly string[]).includes(g))).toEqual(['media']);
  });
  it('各タブの名称と説明がある', () => {
    for (const t of SETTINGS_TABS) {
      expect(messages.settings.tabs[t]).toBeTruthy();
      expect(messages.settings.tabDescriptions[t]).toBeTruthy();
    }
  });
  it('タブの group の全キーに表示名がある (キー一覧は GROUP_KEYS が正本)', () => {
    for (const t of SETTINGS_TABS) {
      for (const key of groupKeys(t)) expect(messages.settings.fields[key], key).toBeDefined();
    }
  });
  it('表示名は 4 タブの項目だけ (写し間違い・取り残しを検出)', () => {
    const all = new Set(SETTINGS_TABS.flatMap((t) => groupKeys(t)));
    for (const key of Object.keys(messages.settings.fields)) expect(all.has(key), key).toBe(true);
  });
});

describe('buildFieldViews', () => {
  it('除外キーを外し、構成比は weights、null を許す項目だけ nullable', () => {
    const safety = buildFieldViews('safety', settings, ['tdp_monthly_publish_limit', 'tdp_jinxxy_monthly_limit']);
    expect(safety.map((f) => f.key)).not.toContain('tdp_monthly_publish_limit');
    const plan = buildFieldViews('plan_price', settings);
    expect(plan.find((f) => f.key === 'tdp_kind_weights_json')?.kind).toBe('weights');
    const gen = buildFieldViews('generation', settings);
    expect(gen.find((f) => f.key === 'meshy_poll_interval_sec')?.nullable).toBe(true);
    expect(gen.find((f) => f.key === 'credit_cap_per_product')?.nullable).toBe(false);
  });
  it('確認前は全項目が proposed、確認後に値を変えた項目だけ changed', () => {
    expect(buildFieldViews('gates', settings).every((f) => f.state === 'proposed')).toBe(true);
    const confirmed = { ...settings, tdp_settings_confirmed_json: buildConfirmed('gates', settings, new Date()) };
    expect(buildFieldViews('gates', confirmed).every((f) => f.state === 'confirmed')).toBe(true);
    const changed = { ...confirmed, tdp_gate_b_min_sales: 9 };
    const states = Object.fromEntries(buildFieldViews('gates', changed).map((f) => [f.key, f.state]));
    expect(states.tdp_gate_b_min_sales).toBe('changed');
    expect(states.tdp_gate_b_window_days).toBe('confirmed');
    expect(proposalState('gates', 'tdp_gate_b_min_sales', changed)).toBe('changed');
  });
});

describe('バッジ文言', () => {
  it('3 状態は別々の文言 (色だけで区別しない)', () => {
    const labels = new Set(['proposed', 'confirmed', 'changed'].map((s) => messages.settings.badge[s]));
    expect(labels.size).toBe(3);
    expect(messages.settings.badge.proposed).toBe('提案値 (未承認)');
    expect(messages.settings.badge.confirmed).toBe('確認済');
    expect(messages.settings.badge.changed).toBe('変更済 (未確認)');
  });
});

describe('parseFieldInput', () => {
  it('空欄を 0 にしない', () => {
    expect(parseFieldInput('', false)).toBe('');
    expect(parseFieldInput('  ', true)).toBeNull();
  });
  it('数にならないものは文字列のまま (サーバーに拒否させる)', () => {
    expect(parseFieldInput('abc', false)).toBe('abc');
    expect(parseFieldInput(' 12 ', false)).toBe(12);
    expect(parseFieldInput('2.5', false)).toBe(2.5);
  });
  it('fieldInputText は null を空欄に', () => {
    expect(fieldInputText(null)).toBe('');
    expect(fieldInputText(20)).toBe('20');
  });
});

describe('confirmedAt', () => {
  it('未確認は null、確認済みは JST 表記', () => {
    expect(confirmedAt('gates', settings)).toBeNull();
    const s = {
      ...settings,
      tdp_settings_confirmed_json: { gates: { confirmed_at: '2026-10-19T00:30:00.000Z', values: {} } },
    };
    expect(confirmedAt('gates', s)).toContain('09:30');
    expect(confirmedAt('safety', s)).toBeNull();
  });
});

describe('文言の規約', () => {
  it('設定画面の文言に内部呼称 (Inc-) を出さない', () => {
    expect(JSON.stringify(messages.settings)).not.toMatch(/Inc-?\d/);
  });
});

describe('formatRefusals', () => {
  it('媒体ごとに表示名で言い、両方の拒否が残る', () => {
    const lines = formatRefusals([
      { field: 'tdp_monthly_publish_limit', refused: 13, current: 8, reason: 'range' },
      { field: 'tdp_jinxxy_monthly_limit', refused: -1, current: 0, reason: 'range' },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('BOOTH');
    expect(lines[0]).toContain('現在の値: 8');
    expect(lines[1]).toContain('Jinxxy');
    expect(lines.join('')).not.toContain('tdp_');
  });
  it('R-1 の拒否文に「最大 12」と現在値・拒否値が出る (天井がコード側の固定値だと読める)', () => {
    const [l] = formatRefusals([{ field: 'tdp_monthly_publish_limit', refused: 13, current: 8, reason: 'range' }]);
    expect(l).toContain('13 は保存されていません');
    expect(l).toContain('最大 12');
    expect(l).toContain('現在の値: 8');
    expect(l).toContain('コード側の固定値');
    const msg = refusalMessage([{ field: 'tdp_monthly_publish_limit', refused: 13, current: 8, reason: 'range' }], 'x');
    expect(msg).toContain('何も保存していません');
    expect(msg).toContain('最大 12');
  });
  it('DB 列名ではなく表示名を使う', () => {
    const [l] = formatRefusals([{ field: 'tdp_min_price_jpy', refused: 300, current: 500, reason: 'range' }]);
    expect(l).toContain(messages.settings.fields.tdp_min_price_jpy!.label);
    expect(l).not.toContain('tdp_min_price_jpy');
  });
  it('合計の拒否は BOOTH と Jinxxy を明記する', () => {
    const [l] = formatRefusals([{ field: 'total', refused: 13, current: 8, reason: 'total' }]);
    expect(l).toContain('BOOTH と Jinxxy');
  });
});

describe('refusalMessage', () => {
  it('1 行目に「何も保存していません」を出し、拒否を全件続ける', () => {
    const msg = refusalMessage(
      [
        { field: 'tdp_min_price_jpy', refused: 300, current: 500, reason: 'range' },
        { field: 'tdp_gate_b_min_sales', refused: 0, current: 5, reason: 'range' },
      ],
      'x',
    );
    const lines = msg.split(String.fromCharCode(10));
    expect(lines[0]).toContain('2 件');
    expect(lines[0]).toContain('何も保存していません');
    expect(lines).toHaveLength(3);
  });
  it('拒否が無ければ Action のメッセージ', () => {
    expect(refusalMessage(undefined, 'fallback')).toBe('fallback');
  });
  it('空文字は「空欄」、null は「未設定」、現在値が読めない合計は「不明」', () => {
    const [a] = formatRefusals([{ field: 'tdp_monthly_publish_limit', refused: '', current: 8, reason: 'range' }]);
    expect(a).toContain('空欄');
    const [b] = formatRefusals([{ field: 'tdp_min_price_jpy', refused: 1, current: null, reason: 'range' }]);
    expect(b).toContain('未設定');
    const [c] = formatRefusals([{ field: 'total', refused: 13, current: null, reason: 'total' }]);
    expect(c).toContain('現在の合計: 不明');
  });
});
