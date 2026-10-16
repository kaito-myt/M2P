import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TDP_SETTINGS_DEFAULTS, TDP_MONTHLY_LIMIT_HARD_MAX } from '@a2p/contracts/tdp/settings';
import { PRODUCT_STATUSES } from '@a2p/contracts/tdp/status';

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, '..', 'migrations', '20261016010000_tdp_inc1_foundation', 'migration.sql'), 'utf8');
// コメント行 (先頭の確認 SQL など) は検査対象から外す
const sql = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

const addColumnLines = sql.split('\n').filter((l) => /ADD COLUMN/i.test(l));

function columnDefs(table: string): Map<string, string> {
  const m = new RegExp(`ALTER TABLE "${table}"\\s*\\n([\\s\\S]*?);`).exec(sql);
  if (!m?.[1]) throw new Error(`ALTER TABLE ${table} not found`);
  const out = new Map<string, string>();
  for (const line of m[1].split('\n')) {
    const c = /ADD COLUMN IF NOT EXISTS "(\w+)" (.*?),?$/.exec(line.trim());
    if (c?.[1] && c[2]) out.set(c[1], c[2]);
  }
  return out;
}

function sqlLiteral(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

describe('tdp inc1 migration (static)', () => {
  it('app_settings の DEFAULT が TDP_SETTINGS_DEFAULTS と一致する', () => {
    const defs = columnDefs('app_settings');
    expect([...defs.keys()].sort()).toEqual(Object.keys(TDP_SETTINGS_DEFAULTS).sort());
    for (const [col, value] of Object.entries(TDP_SETTINGS_DEFAULTS)) {
      const def = defs.get(col) ?? "";
      const dm = /DEFAULT (\S+)/i.exec(def);
      const expected = sqlLiteral(value);
      if (expected === null) {
        expect(dm, col).toBeNull();
        expect(def, col).not.toMatch(/NOT NULL/i);
      } else {
        expect(dm?.[1], col).toBe(expected);
      }
    }
  });

  it('tdp_products_status_valid の許可値が PRODUCT_STATUSES と集合一致する', () => {
    const m = /CONSTRAINT "tdp_products_status_valid"\s+CHECK \("status" IN \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const values = [...(m?.[1] ?? "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort()).toEqual([...PRODUCT_STATUSES].sort());
  });

  it('approval_required が approved / listed / withdrawn を approved_at に結びつける', () => {
    expect(sql).toMatch(
      /CONSTRAINT "tdp_products_approval_required"\s+CHECK \("status" NOT IN \('approved','listed','withdrawn'\) OR "approved_at" IS NOT NULL\)/,
    );
  });

  it('app_settings_tdp_limit_range の上限が TDP_MONTHLY_LIMIT_HARD_MAX と同値', () => {
    const m = /CONSTRAINT "app_settings_tdp_limit_range"\s+CHECK \(([^;]*)\);/.exec(sql);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? "";
    expect(body).toContain('"tdp_monthly_publish_limit" BETWEEN 0 AND');
    expect(body).toContain('"tdp_jinxxy_monthly_limit" BETWEEN 0 AND');
    const uppers = [...body.matchAll(/BETWEEN 0 AND (\d+)/g)].map((x) => Number(x[1]));
    expect(uppers).toHaveLength(2);
    for (const u of uppers) expect(u).toBe(TDP_MONTHLY_LIMIT_HARD_MAX);
  });

  it('jobs の FK は ON DELETE SET NULL で、索引が揃っている', () => {
    expect(sql).toMatch(/FOREIGN KEY \("tdp_product_id"\) REFERENCES "tdp_products" \("id"\) ON DELETE SET NULL/);
    for (const idx of ['jobs_tdp_product_kind_idx', 'jobs_kind_time_idx', 'tdp_products_stall_idx', 'tdp_products_origin_idx']) {
      expect(sql).toContain(`"${idx}"`);
    }
  });

  it('既存の列・索引を DROP / ALTER TYPE していない', () => {
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN[^;]*\bTYPE\b/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|CONSTRAINT)/i);
  });

  it('全ての ADD COLUMN が NULL 許容か DEFAULT 付き', () => {
    expect(addColumnLines.length).toBeGreaterThan(0);
    for (const line of addColumnLines) {
      const ok = /DEFAULT/i.test(line) || !/NOT NULL/i.test(line);
      expect(ok, line).toBe(true);
    }
  });
});
