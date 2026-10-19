/**
 * 3DP の E2E 用 DB 準備 (T-3DP-02-11)。
 *
 * - 接続先は `TDP_TEST_DATABASE_URL` だけ。playwright.config.ts (E2E_TARGET=3dp) が
 *   web サーバーの DATABASE_URL も同じ URL から作るので、本番 (.env.local の DATABASE_URL) は読まない。
 *   このファイルは `@a2p/db` (Prisma) も `packages/db/src/testing/pg.ts` も import しない。
 *   後者は `import.meta` を使う ESM で、Playwright のローダ (CJS 変換) から読めないため (既知の制約)。
 * - スキーマ `e2e_3dp` を作り直し、全 migration を再生する。再生規則は pg.ts の `applyMigrations` と同じで、
 *   ANP ドリフトの `note_*` 欠落 (42P01) で落ちる migration だけ skip する (pg.ts 冒頭に一覧あり。3DP の表には触れない)。
 * - テスト用ユーザーと app_settings の singleton 行を入れる。
 * - 各 spec は `resetTdpState()` で商品と設定を既定へ戻す。スキーマは spec ごとに作り直さない
 *   (Next 側の Prisma 接続が古いスキーマの OID を持つため。DML だけで戻す)。
 *   既定値は列の DEFAULT に任せ、戻り値で読み直す (contracts の定数と DB の DEFAULT を二重に持たない)。
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// pg と bcryptjs は apps/3dp・packages/db の依存で、ルートの node_modules に無い (pnpm の厳格配置)。
// 実行時は依存元から解決し、型は同じ場所の @types/pg を参照する。
import type { Client as PgClient } from '../../../packages/db/node_modules/@types/pg';

const requireFromDb = createRequire(path.resolve('packages/db/package.json'));
const requireFrom3dp = createRequire(path.resolve('apps/3dp/package.json'));
const { Client } = requireFromDb('pg') as { Client: new (opts: { connectionString: string }) => PgClient };
const bcrypt = requireFrom3dp('bcryptjs') as { hashSync(plain: string, rounds: number): string };

export const TDP_E2E_SCHEMA = 'e2e_3dp';
export const TDP_E2E_USERNAME = 'e2e-3dp-operator';
/** 使い捨てのテスト DB にしか入らない固定値。本番の認証情報とは無関係。 */
export const TDP_E2E_PASSWORD = 'e2e-3dp-password';

export interface TdpLimits {
  booth: number;
  jinxxy: number;
}

const MIGRATIONS_DIR = path.resolve('packages/db/migrations');

function testDatabaseUrl(): string {
  const raw = process.env.TDP_TEST_DATABASE_URL;
  if (!raw) {
    throw new Error('[e2e/3dp] TDP_TEST_DATABASE_URL が未設定です (playwright.config.ts が検査済みのはず)');
  }
  return raw;
}

async function withClient<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * 全 migration を名前の昇順に再生する。client の search_path は呼び出し側で設定済みであること。
 * 規則は packages/db/src/testing/pg.ts の applyMigrations と同じ (note_* の 42P01 だけ skip)。
 */
async function applyAllMigrations(client: PgClient): Promise<string[]> {
  const names = readdirSync(MIGRATIONS_DIR)
    .filter((n) => statSync(path.join(MIGRATIONS_DIR, n)).isDirectory())
    .sort();
  const skipped: string[] = [];
  for (const name of names) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
    try {
      await client.query(sql);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === '42P01' && /"note_[a-z_]+"/.test(err.message ?? '')) {
        skipped.push(name); // 単一の simple query は暗黙トランザクションなので丸ごと巻き戻っている
        continue;
      }
      throw new Error(`migration ${name} の適用に失敗: ${err.message ?? String(e)}`);
    }
  }
  return skipped;
}

/**
 * schema.prisma にあるが migrations のどこにも無い app_settings の列 (2026-10-19 実測: 24 列)。
 * 本番の DB には db push 等で入っている前提で、migration の再生だけでは作られない。3DP の画面は
 * Prisma の findUnique で全列を読むため、欠けると設定が degraded (読めない) になる。
 * 定義は `prisma migrate diff --to-schema-datamodel` の CREATE TABLE 出力から取った。
 * ここに無い列が schema.prisma に増えた場合は、auth.setup.ts の「ホームに警告が出ていない」確認が落ちて知らせる。
 * 対応の正本は migration 側 (別タスクで解消する。T-3DP-02-04 の再生前提の穴として報告)。
 */
const APP_SETTINGS_PRISMA_ONLY_COLUMNS_SQL: readonly string[] = [
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "kdp_session_alert_at" TIMESTAMP(3)`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "x_engage_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "sns_engage_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_growth_loop_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "video_use_veo_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_daily_review_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "promo_review_cron" TEXT NOT NULL DEFAULT '0 23 * * *'`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "cost_auto_analyze_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "cost_analyze_cron" TEXT NOT NULL DEFAULT '0 20 * * 1'`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "book_cull_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "book_cull_cron" TEXT NOT NULL DEFAULT '0 21 * * 1'`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "book_cull_min_age_days" INTEGER NOT NULL DEFAULT 60`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "book_cull_max_kenp" INTEGER NOT NULL DEFAULT 300`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "book_cull_max_royalty_jpy" INTEGER NOT NULL DEFAULT 100`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "kdp_creation_paused_until" TIMESTAMP(3)`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "org_auto_approve_tasks" BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "autopass_theme_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "pipeline_themes_per_day" INTEGER NOT NULL DEFAULT 3`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "pipeline_theme_direction" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "pipeline_theme_cron" TEXT NOT NULL DEFAULT '0 22 * * *'`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "autopass_outline_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "autopass_content_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "autopass_cover_enabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "autopass_kdp_enabled" BOOLEAN NOT NULL DEFAULT false`,
];

/** app_settings の singleton 行を最小形で入れ直す。R-1 などの値は列の DEFAULT に任せる。 */
async function insertSingleton(client: PgClient): Promise<void> {
  await client.query(`DELETE FROM "app_settings"`);
  await client.query(
    `INSERT INTO "app_settings" ("id", "notification_email_to", "notification_kinds_json", "ai_disclosure_text", "updated_at")
     VALUES ('singleton', 'e2e@example.invalid', '{}'::jsonb, '', now())`,
  );
}

async function readLimitsOn(client: PgClient): Promise<TdpLimits> {
  const r = await client.query<{ booth: number; jinxxy: number }>(
    `SELECT "tdp_monthly_publish_limit" AS booth, "tdp_jinxxy_monthly_limit" AS jinxxy
       FROM "app_settings" WHERE "id" = 'singleton'`,
  );
  if (r.rowCount !== 1) throw new Error(`app_settings の singleton 行が ${r.rowCount} 件です`);
  return r.rows[0]!;
}

/**
 * スキーマを作り直して全 migration を再生し、テストユーザーと設定の行を入れる。
 * auth.setup.ts から 1 回だけ呼ぶ。戻り値の skippedMigrations は ANP ドリフトで skip した migration 名。
 */
export async function resetTdpE2eDatabase(): Promise<{ skippedMigrations: string[] }> {
  return withClient(async (client) => {
    await client.query(`DROP SCHEMA IF EXISTS "${TDP_E2E_SCHEMA}" CASCADE`);
    await client.query(`CREATE SCHEMA "${TDP_E2E_SCHEMA}"`);
    await client.query(`SET search_path TO "${TDP_E2E_SCHEMA}"`);
    const skippedMigrations = await applyAllMigrations(client);
    for (const sql of APP_SETTINGS_PRISMA_ONLY_COLUMNS_SQL) await client.query(sql);

    await client.query(
      `INSERT INTO "users" ("id", "username", "password_hash", "updated_at") VALUES ($1, $2, $3, now())`,
      [randomUUID(), TDP_E2E_USERNAME, bcrypt.hashSync(TDP_E2E_PASSWORD, 10)],
    );
    await insertSingleton(client);
    return { skippedMigrations };
  });
}

/**
 * 各 spec の前に呼ぶ。商品を 0 件にし、設定の行を DEFAULT へ戻す (スキーマは触らない)。
 * 戻り値は戻した後の R-1 の値 (= 基準値)。
 */
export async function resetTdpState(): Promise<TdpLimits> {
  return withClient(async (client) => {
    await client.query(`SET search_path TO "${TDP_E2E_SCHEMA}"`);
    await client.query(`TRUNCATE "tdp_products" CASCADE`);
    await insertSingleton(client);
    return readLimitsOn(client);
  });
}

/** DB に入っている R-1 の値。画面の表示ではなく DB を正とする。 */
export async function readTdpLimits(): Promise<TdpLimits> {
  return withClient(async (client) => {
    await client.query(`SET search_path TO "${TDP_E2E_SCHEMA}"`);
    return readLimitsOn(client);
  });
}
