import { describe, expect, it } from 'vitest';

import { buildRoleRows, groupCatalog, providerTestRequest, roleGroup, roleLabel } from '../settings-core';

const catalog = [
  { provider: 'anthropic' as const, model: 'claude-opus-4-7', available: true, input_price_per_mtok_usd: 15, output_price_per_mtok_usd: 75 },
  { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', available: null, input_price_per_mtok_usd: 3, output_price_per_mtok_usd: 15 },
  { provider: 'google' as const, model: 'gemini-2.5-flash', available: false, input_price_per_mtok_usd: 0.3, output_price_per_mtok_usd: 2.5 },
  { provider: 'openai' as const, model: 'gpt-5', available: true, input_price_per_mtok_usd: 1.25, output_price_per_mtok_usd: 10 },
];

describe('roleGroup / roleLabel', () => {
  it('役割をツール別グループに分ける', () => {
    expect(roleGroup('anp.writer')).toBe('anp');
    expect(roleGroup('content_creator')).toBe('a2p_promo');
    expect(roleGroup('ceo_chat')).toBe('org');
    expect(roleGroup('writer')).toBe('a2p_book');
    expect(roleGroup('mystery_role')).toBe('other');
    expect(roleLabel('anp.consultant')).toContain('AI 相談');
    expect(roleLabel('unknown')).toBe('unknown');
  });
});

describe('buildRoleRows', () => {
  it('プロンプトと割当の和集合を、既定割当・上書き件数・呼出不可フラグ付きで返す', () => {
    const rows = buildRoleRows(
      [{ role: 'writer' }, { role: 'anp.writer' }],
      [
        { role: 'writer', genre: null, provider: 'anthropic', model: 'claude-opus-4-7', activated_at: new Date('2026-09-01T00:00:00Z') },
        { role: 'writer', genre: 'novel', provider: 'anthropic', model: 'claude-sonnet-4-6', activated_at: new Date('2026-09-02T00:00:00Z') },
        { role: 'editor', genre: null, provider: 'google', model: 'gemini-2.5-flash', activated_at: new Date('2026-09-03T00:00:00Z') },
      ],
      catalog,
    );
    const writer = rows.find((r) => r.role === 'writer')!;
    expect(writer).toMatchObject({ provider: 'anthropic', model: 'claude-opus-4-7', genre_override_count: 1, unavailable: false, group: 'a2p_book' });
    const editor = rows.find((r) => r.role === 'editor')!;
    expect(editor.unavailable).toBe(true);
    const anp = rows.find((r) => r.role === 'anp.writer')!;
    expect(anp).toMatchObject({ provider: null, model: null, group: 'anp' });
    // グループ順: a2p_book → anp
    expect(rows.map((r) => r.group)).toEqual(['a2p_book', 'a2p_book', 'anp']);
  });
});

describe('groupCatalog / providerTestRequest', () => {
  it('available=false のモデルを選択肢から外し provider 別に並べる', () => {
    const g = groupCatalog(catalog);
    expect(g.anthropic.map((c) => c.model)).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(g.google).toEqual([]);
    expect(g.openai).toHaveLength(1);
  });
  it('疎通テストのリクエストを組み立てる', () => {
    expect(providerTestRequest('anthropic', 'k').headers['x-api-key']).toBe('k');
    expect(providerTestRequest('google', 'k').url).toContain('key=k');
  });
});
