import { describe, expect, it } from 'vitest';
import { assertTrustworthy, pgAvailability, withTestDb, runGraphileMigrations } from '../src/testing/pg.js';

const pgc = await pgAvailability();

const insertProduct = (db: { pool: { query: (q: string, p?: unknown[]) => Promise<unknown> } }, id: string) =>
  db.pool.query(`INSERT INTO tdp_products (id, kind, title, concept, updated_at) VALUES ($1, 'prop', $1, 'c', now())`, [id]);

describe.skipIf(!pgc.ok)('withTestDb (実 PG)', () => {
  it('スキーマを作り tdp_products に 1 行 INSERT/SELECT できる', async () => {
    await withTestDb(async (db) => {
      await insertProduct(db, 'p-smoke');
      const r = await db.pool.query<{ id: string; status: string }>('SELECT id, status FROM tdp_products');
      expect(r.rows).toEqual([{ id: 'p-smoke', status: 'planned' }]);
    });
  });

  it('スキップで巻き込まれる非 note_* 表は許可リストと完全一致 (新しい migration が増やしたら落ちる)', async () => {
    // 理由: ANP ドリフトで skip された migration が、note_* 以外のこれらの表の変更も一緒に失う。
    //   model_assignments (reasoning_effort) / promotion_posts (note_article_id) /
    //   promotion_accounts (note_account_id) / anp_agent_roles (表ごと不在)
    const ALLOWED = ['anp_agent_roles', 'model_assignments', 'promotion_accounts', 'promotion_posts'];
    await withTestDb(async (db) => {
      expect(db.untrustedTables).toEqual(ALLOWED);
      expect(db.untrustedTables.some((t) => /^(app_settings|jobs|token_usage|tdp_)/.test(t))).toBe(false);
      // 実スキーマでも欠落を確認 (検知ロジックが現実と一致していること)
      const col = await db.pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'model_assignments' AND column_name = 'reasoning_effort'`,
      );
      expect(col.rowCount).toBe(0);
      const tbl = await db.pool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'anp_agent_roles'`,
      );
      expect(tbl.rowCount).toBe(0);
    });
  });

  it('assertTrustworthy: 信用できない表に依存するテストは throw、3DP の表は通る', async () => {
    await withTestDb(async (db) => {
      expect(() => assertTrustworthy(db, ['model_assignments'])).toThrow(/model_assignments/);
      expect(() => assertTrustworthy(db, ['tdp_products', 'app_settings', 'jobs', 'token_usage'])).not.toThrow();
    });
  });

  it('2 つの withTestDb を同時に走らせても互いのデータが見えない', async () => {
    const run = (id: string) =>
      withTestDb(async (db) => {
        await insertProduct(db, id);
        await new Promise((r) => setTimeout(r, 300));
        const r = await db.pool.query<{ id: string }>('SELECT id FROM tdp_products');
        return { schema: db.schema, ids: r.rows.map((x) => x.id) };
      });
    const [a, b] = await Promise.all([run('only-a'), run('only-b')]);
    expect(a.ids).toEqual(['only-a']);
    expect(b.ids).toEqual(['only-b']);
    expect(a.schema).not.toBe(b.schema);
  });

  it('テスト後にスキーマが DROP される', async () => {
    let schema = '';
    let baseUrl = '';
    await withTestDb(async (db) => {
      schema = db.schema;
      baseUrl = db.baseUrl;
    });
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: baseUrl });
    await c.connect();
    const r = await c.query('SELECT 1 FROM information_schema.schemata WHERE schema_name = $1', [schema]);
    await c.end();
    expect(r.rowCount).toBe(0);
  });

  it('graphile-worker の runMigrations を呼べる', async () => {
    await withTestDb(async (db) => {
      const gw = await runGraphileMigrations(db);
      const r = await db.pool.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = '_private_jobs'`, [gw]);
      expect(r.rowCount).toBe(1);
    });
  });
});
