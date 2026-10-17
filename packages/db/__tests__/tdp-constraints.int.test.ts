import { PRODUCT_STATUSES } from '@a2p/contracts/tdp/status';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { assertTrustworthy, pgAvailability, withTestDb, type TestDb } from '../src/testing/pg.js';

const pgc = await pgAvailability();

const CHECK_VIOLATION = '23514';
const FK_VIOLATION = '23503';

const NEEDS_APPROVAL = ['approved', 'listed', 'withdrawn'];

async function sqlstate(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? 'no-code';
  }
  return undefined;
}

type Q = Pick<pg.Pool, 'query'>;

let seq = 0;
const nextId = () => `p-${++seq}`;

function insertProduct(db: Q, status: string, approved: boolean, id = nextId()) {
  return db.query(
    `INSERT INTO tdp_products (id, kind, title, concept, status, cost_jpy_total, created_at, updated_at, approved_at)
     VALUES ($1, 'prop', 't', 'c', $2, 0, now(), now(), CASE WHEN $3::boolean THEN now() ELSE NULL END)`,
    [id, status, approved],
  );
}

async function seedSettings(db: TestDb) {
  await db.pool.query(
    `INSERT INTO app_settings (notification_email_to, notification_kinds_json, ai_disclosure_text, updated_at)
     VALUES ('a@example.com', '[]', '', now())`,
  );
}

describe.skipIf(!pgc.ok)('3DP の DB 制約 (実 PG)', () => {
  it('承認を経ない approved / listed / withdrawn は INSERT / UPDATE とも 23514、approved_at ありなら成功', async () => {
    await withTestDb(async (db) => {
      assertTrustworthy(db, ['tdp_products', 'app_settings', 'jobs']);
      for (const status of NEEDS_APPROVAL) {
        expect(await sqlstate(insertProduct(db.pool, status, false)), `INSERT ${status}`).toBe(CHECK_VIOLATION);
        await insertProduct(db.pool, status, true);

        const id = nextId();
        await insertProduct(db.pool, 'review', false, id);
        expect(
          await sqlstate(db.pool.query(`UPDATE tdp_products SET status = $2 WHERE id = $1`, [id, status])),
          `UPDATE ${status}`,
        ).toBe(CHECK_VIOLATION);
        await db.pool.query(`UPDATE tdp_products SET status = $2, approved_at = now() WHERE id = $1`, [id, status]);
        const r = await db.pool.query(`SELECT status FROM tdp_products WHERE id = $1`, [id]);
        expect(r.rows[0].status).toBe(status);
      }
    });
  });

  it('未知の status は拒否され、PRODUCT_STATUSES の全値が受理される', async () => {
    await withTestDb(async (db) => {
      assertTrustworthy(db, ['tdp_products']);
      expect(PRODUCT_STATUSES.length).toBe(11);
      expect(await sqlstate(insertProduct(db.pool, 'bogus', true))).toBe(CHECK_VIOLATION);
      for (const status of PRODUCT_STATUSES) {
        await insertProduct(db.pool, status, NEEDS_APPROVAL.includes(status));
      }
      const r = await db.pool.query(`SELECT count(*)::int AS n FROM tdp_products`);
      expect(r.rows[0].n).toBe(PRODUCT_STATUSES.length);
    });
  });

  it.each(['tdp_monthly_publish_limit', 'tdp_jinxxy_monthly_limit'])('%s は 0..12 のみ (13 / -1 は 23514)', async (col) => {
    await withTestDb(async (db) => {
      assertTrustworthy(db, ['app_settings']);
      await seedSettings(db);
      for (const bad of [13, -1]) {
        expect(await sqlstate(db.pool.query(`UPDATE app_settings SET ${col} = $1`, [bad])), `${col}=${bad}`).toBe(
          CHECK_VIOLATION,
        );
      }
      for (const ok of [12, 0]) {
        await db.pool.query(`UPDATE app_settings SET ${col} = $1`, [ok]);
        const r = await db.pool.query(`SELECT ${col} AS v FROM app_settings`);
        expect(r.rows[0].v).toBe(ok);
      }
    });
  });

  it('jobs.tdp_product_id は FK (23503)。商品 DELETE で NULL になり jobs 行は残る', async () => {
    await withTestDb(async (db) => {
      assertTrustworthy(db, ['tdp_products', 'jobs']);
      const insertJob = (id: string, productId: string | null) =>
        db.pool.query(
          `INSERT INTO jobs (id, kind, payload_json, tdp_product_id) VALUES ($1, 'tdp.test', '{}', $2)`,
          [id, productId],
        );
      expect(await sqlstate(insertJob('j-bad', 'no-such-product'))).toBe(FK_VIOLATION);

      await insertProduct(db.pool, 'planned', false, 'p-fk');
      await insertJob('j-ok', 'p-fk');
      await db.pool.query(`DELETE FROM tdp_products WHERE id = 'p-fk'`);
      const r = await db.pool.query(`SELECT id, tdp_product_id FROM jobs WHERE id = 'j-ok'`);
      expect(r.rows).toEqual([{ id: 'j-ok', tdp_product_id: null }]);
    });
  });
});
