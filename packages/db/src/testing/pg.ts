/**
 * 実 PG の統合テスト基盤 (docs/12 §16.5.1 罠2 / §17.13)。直列性・CAS・部分 UNIQUE は PG の性質で、モックでは証明できない。
 *
 * 接続先 (OP-04 の A/B/C をすべて実装):
 *   1. TDP_TEST_DATABASE_URL があればそれ (= B。CI もこの経路)
 *   2. 無ければ Docker で @testcontainers/postgresql を起動 (= A。postgres:16-alpine)
 *   3. どちらも駄目なら pgAvailability() が ok:false + 目立つ警告 → テスト側が skip (= C)
 *   TDP_REQUIRE_PG=1 のときは 3 を許さず、到達できなければ throw (skip ではなく赤にする)。
 *
 * migration の再生 (T-3DP-02-04 が要求する記録) — 「全 migration を昇順に再生」を採用した。ただし実測で
 * 空 DB への素直な 60 本再生は 11 本が失敗する (2026-10-16 実測、PG16):
 *   20260916000000_anp_promo_sales / 20260919000000_anp_account_design / 20260921000000_anp_account_consult /
 *   20260921010000_anp_account_settings_authrelay / 20260921020000_anp_session_link /
 *   20260921030000_anp_account_profile / 20260921040000_anp_editorial_policy /
 *   20260921050000_anp_promotion_policy_agent_roles / 20260922000000_anp_promotion_account_link /
 *   20260924000000_model_effort_and_note_seo / 20261014000000_note_account_research
 * 理由: ANP の note_accounts / note_articles / note_account_designs 等のベーステーブルを CREATE する
 * migration がリポジトリに存在しない (db push 由来のドリフト)。いずれも `relation "note_*" does not exist`
 * (SQLSTATE 42P01)。3DP が使う app_settings / jobs / token_usage / tdp_* には触れない。
 * ただし migration.sql は 1 本の simple query (= 暗黙トランザクション) で流すため、スキップは「そのファイルの全文を失う」。
 * 副作用 (2026-10-18 実測): model_assignments.reasoning_effort / promotion_posts.note_article_id /
 * promotion_accounts.note_account_id が欠け、anp_agent_roles が存在しない。
 * 文単位に分割する案は DO $$ 等の誤分割リスクがあるため採らず、代わりに影響表を TestDb.untrustedTables として公開し、
 * createTestDb が 1 回 WARN、assertTrustworthy(db, [表...]) で「信用できない表に依存するテストは緑になれない」を保証する。
 * よって「42P01 かつ note_ 関係の欠落」で落ちた migration だけを許容してスキップし (skippedMigrations に記録)、
 * それ以外の失敗は即 throw する。最小テーブル手書き方式より、新しい migration (app_settings への列追加など) に自動追従する。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const PG_IMAGE = 'postgres:16-alpine';

export interface PgAvailability {
  ok: boolean;
  reason: string;
  /** 'url' = TDP_TEST_DATABASE_URL, 'testcontainers' = Docker */
  source?: 'url' | 'testcontainers';
}

export interface TestDb {
  pool: pg.Pool;
  schema: string;
  /** 管理用のベース URL (search_path 無し) */
  baseUrl: string;
  /** 再生をスキップした migration (ANP ドリフト)。3DP 関連に触れないことをテストで検証する */
  skippedMigrations: string[];
  /** スキップした migration が触れる非 note_* の表。これらのスキーマは本番と食い違う (assertTrustworthy で守る) */
  untrustedTables: string[];
}

export class PgUnavailableError extends Error {}

const requirePg = () => process.env.TDP_REQUIRE_PG === '1';

async function canConnect(url: string): Promise<string | null> {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await c.connect();
    await c.query('select 1');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message || String(e) : String(e);
  } finally {
    await c.end().catch(() => undefined);
  }
}

let container: { stop: () => Promise<unknown> } | null = null;
let resolved: Promise<PgAvailability & { url?: string }> | null = null;

async function startContainer(): Promise<string> {
  const mod = await import('@testcontainers/postgresql');
  const started = await new mod.PostgreSqlContainer(PG_IMAGE).start();
  // Ryuk には頼らない (実測でリークした)。vitest の globalSetup teardown から stopTestContainer() を呼ぶこと
  container = started;
  return started.getConnectionUri();
}

function resolveTarget(): Promise<PgAvailability & { url?: string }> {
  resolved ??= (async () => {
    const envUrl = process.env.TDP_TEST_DATABASE_URL;
    if (envUrl) {
      const err = await canConnect(envUrl);
      if (!err) return { ok: true, reason: 'TDP_TEST_DATABASE_URL', source: 'url' as const, url: envUrl };
      // REQUIRE のときは Docker に逃げない (CI が別の DB を黙って使うのを防ぐ)
      if (requirePg()) return { ok: false, reason: `TDP_TEST_DATABASE_URL に接続できません: ${err}` };
    }
    try {
      const url = await startContainer();
      return { ok: true, reason: 'testcontainers', source: 'testcontainers' as const, url };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        reason: `${envUrl ? 'TDP_TEST_DATABASE_URL 不達かつ ' : 'TDP_TEST_DATABASE_URL 未設定かつ '}Docker/testcontainers も使えません: ${msg.split('\n')[0]}`,
      };
    }
  })();
  return resolved;
}

/**
 * テストファイルの先頭で `const pgc = await pgAvailability()` し `describe.skipIf(!pgc.ok)` で囲む。
 * TDP_REQUIRE_PG=1 で到達不能なら throw (= そのテストファイルが失敗する)。
 */
export async function pgAvailability(): Promise<PgAvailability> {
  const r = await resolveTarget();
  if (!r.ok) {
    if (requirePg()) throw new PgUnavailableError(`[TDP_REQUIRE_PG=1] 実 PG に到達できません: ${r.reason}`);
    const bar = '!'.repeat(72);
    console.warn(
      `\n${bar}\n!! 実 PG の統合テストを SKIP します (TDP_REQUIRE_PG 未設定): ${r.reason}\n!! SKIP は「通った」ではありません。CI では TDP_REQUIRE_PG=1 で必須です。\n${bar}\n`,
    );
  }
  return { ok: r.ok, reason: r.reason, source: r.source };
}

/** 起動した testcontainers を停止する (globalSetup の teardown 用)。 */
export async function stopTestContainer(): Promise<void> {
  const c = container;
  container = null;
  resolved = null;
  await c?.stop();
}

/** globalSetup 用: 解決済みの接続 URL (到達不能なら null) */
export async function resolvedBaseUrl(): Promise<string | null> {
  const r = await resolveTarget();
  return r.ok && r.url ? r.url : null;
}

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
    .sort();
}

/** migration SQL が変更する非 note_* の表名 (コメント除去後、引用符付き識別子のみ)。 */
export function affectedNonNoteTables(sql: string): string[] {
  const body = sql.replace(/--[^\n]*/g, '');
  const re = /(?:ALTER\s+TABLE(?:\s+ONLY)?(?:\s+IF\s+EXISTS)?|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|INSERT\s+INTO|DELETE\s+FROM|UPDATE|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+"[^"]+"\s+ON)\s+"([a-z_0-9]+)"/gi;
  const out = new Set<string>();
  for (const m of body.matchAll(re)) if (!m[1]!.startsWith('note_')) out.add(m[1]!);
  return [...out].sort();
}

/** untrustedTables と交差する表に依存するテストは、ここで落とす (黙って食い違うスキーマで緑になるのを防ぐ)。 */
export function assertTrustworthy(db: TestDb, tablesUnderTest: string[]): void {
  const bad = tablesUnderTest.filter((t) => db.untrustedTables.includes(t));
  if (bad.length > 0) {
    throw new Error(
      `テスト DB の表 [${bad.join(', ')}] は ANP ドリフトで skip された migration の影響を受け、本番と異なるスキーマです。` +
        `このテストは信用できません (docs/12 §17.13)。`,
    );
  }
}

let warnedUntrusted = false;

function isNoteDrift(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err.code === '42P01' && /"note_[a-z_]+"/.test(err.message ?? '');
}

/** 全 migration を昇順に適用する (冒頭コメント参照)。client の search_path は呼び出し側で設定済みであること。 */
export async function applyMigrations(client: pg.Client | pg.PoolClient): Promise<string[]> {
  const skipped: string[] = [];
  for (const name of listMigrations()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    try {
      await client.query(sql);
    } catch (e) {
      if (isNoteDrift(e)) {
        // 単一の simple query は暗黙トランザクションなので、失敗した migration は丸ごとロールバックされ続行できる
        skipped.push(name);
        continue;
      }
      throw new Error(`migration ${name} の適用に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return skipped;
}

export function untrustedFrom(skipped: string[]): string[] {
  const all = new Set<string>();
  for (const name of skipped) {
    for (const t of affectedNonNoteTables(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'))) all.add(t);
  }
  return [...all].sort();
}

export function uniqueSchemaName(): string {
  return `tdp_t_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** スキーマを作り migration を再生した TestDb を返す。後始末は dropTestDb。通常は withTestDb を使う。 */
export async function createTestDb(): Promise<TestDb> {
  const r = await resolveTarget();
  if (!r.ok || !r.url) throw new PgUnavailableError(`実 PG に到達できません: ${r.reason}`);
  const schema = uniqueSchemaName();
  const admin = new pg.Client({ connectionString: r.url });
  await admin.connect();
  let skipped: string[];
  let untrusted: string[] = [];
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    skipped = await applyMigrations(admin);
    untrusted = untrustedFrom(skipped);
  } catch (e) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    throw e;
  } finally {
    await admin.end().catch(() => undefined);
  }
  if (untrusted.length > 0 && !warnedUntrusted) {
    warnedUntrusted = true;
    const bar = '!'.repeat(72);
    console.warn(
      `
${bar}
!! テスト DB は ANP ドリフトで ${skipped.length} 本の migration を skip: 次の表は本番と食い違います: ${untrusted.join(', ')}
!! これらに依存するテストは assertTrustworthy(db, [...]) で守ること。
${bar}
`,
    );
  }
  const pool = new pg.Pool({ connectionString: r.url, options: `-c search_path=${schema}`, max: 8 });
  return { pool, schema, baseUrl: r.url, skippedMigrations: skipped, untrustedTables: untrusted };
}

export async function dropTestDb(db: TestDb): Promise<void> {
  await db.pool.end().catch(() => undefined);
  const admin = new pg.Client({ connectionString: db.baseUrl });
  try {
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${db.schema}" CASCADE`);
    await admin.query(`DROP SCHEMA IF EXISTS "gw_${db.schema}" CASCADE`);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/** ファイル専用の一意スキーマ + 全 migration 再生 → fn → スキーマ DROP。 */
export async function withTestDb<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const db = await createTestDb();
  try {
    return await fn(db);
  } finally {
    await dropTestDb(db);
  }
}

/** graphile-worker のスキーマ (`gw_<schema>`) を作る。キューの統合テスト (SP-3DP-03/04) 用。戻り値はそのスキーマ名。 */
export async function runGraphileMigrations(db: TestDb): Promise<string> {
  const { runMigrations } = await import('graphile-worker');
  const gwSchema = `gw_${db.schema}`;
  await runMigrations({ pgPool: db.pool, schema: gwSchema });
  return gwSchema;
}
