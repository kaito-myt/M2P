import { describe, expect, it } from 'vitest';

import { buildAnpRoleRows, groupCatalog, setAnpModelAssignmentInput } from '../model-settings-core';

const catalog = [
  { provider: 'anthropic' as const, model: 'claude-opus-4-7', available: true, input_price_per_mtok_usd: 15, output_price_per_mtok_usd: 75 },
  { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', available: null, input_price_per_mtok_usd: 3, output_price_per_mtok_usd: 15 },
  { provider: 'google' as const, model: 'gemini-2.5-flash', available: false, input_price_per_mtok_usd: 0.3, output_price_per_mtok_usd: 2.5 },
];

describe('buildAnpRoleRows', () => {
  it('anp.* だけを seed 順に並べ、既定割当と呼出不可フラグを付ける', () => {
    const rows = buildAnpRoleRows(
      [{ role: 'anp.writer' }, { role: 'writer' }, { role: 'anp.theme' }],
      [
        { role: 'anp.theme', genre: null, provider: 'google', model: 'gemini-2.5-flash', activated_at: new Date('2026-09-01T00:00:00Z') },
        { role: 'anp.judge', genre: null, provider: 'anthropic', model: 'claude-sonnet-4-6', activated_at: new Date('2026-09-02T00:00:00Z') },
        { role: 'marketer', genre: null, provider: 'anthropic', model: 'claude-opus-4-7', activated_at: new Date('2026-09-03T00:00:00Z') },
      ],
      catalog,
    );
    expect(rows.map((r) => r.role)).toEqual(['anp.theme', 'anp.writer', 'anp.judge']);
    expect(rows[0]).toMatchObject({ label: 'テーマ企画', provider: 'google', unavailable: true });
    expect(rows[1]).toMatchObject({ provider: null, model: null });
  });
});

describe('groupCatalog / input schema', () => {
  it('available=false を外し provider 別に並べる', () => {
    const g = groupCatalog(catalog);
    expect(g.anthropic).toHaveLength(2);
    expect(g.google).toEqual([]);
  });
  it('anp.* 以外の役割は拒否する', () => {
    expect(setAnpModelAssignmentInput.safeParse({ role: 'writer', provider: 'anthropic', model: 'x' }).success).toBe(false);
    expect(setAnpModelAssignmentInput.safeParse({ role: 'anp.writer', provider: 'anthropic', model: 'x' }).success).toBe(true);
  });
});
