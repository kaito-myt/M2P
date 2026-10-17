import { describe, expect, it } from 'vitest';
import { pgAvailability, withTestDb } from '../src/testing/pg.js';

// pg-helper.int.test.ts と別ファイル (= 別ワーカー) で同時に走り、互いの行が見えないことを確かめる
const pgc = await pgAvailability();

describe.skipIf(!pgc.ok)('ファイル間のスキーマ分離 (実 PG)', () => {
  it('他ファイルの商品が見えない', async () => {
    await withTestDb(async (db) => {
      await db.pool.query(
        `INSERT INTO tdp_products (id, kind, title, concept, updated_at) VALUES ('file-b', 'prop', 'b', 'c', now())`,
      );
      await new Promise((r) => setTimeout(r, 500));
      const r = await db.pool.query<{ id: string }>('SELECT id FROM tdp_products');
      expect(r.rows.map((x) => x.id)).toEqual(['file-b']);
    });
  });
});
