/**
 * Playwright E2E configuration (T-02-14 / T-3DP-02-11)
 *
 * 対象は環境変数 `E2E_TARGET` で切り替える:
 *   - 未指定 / `web` : apps/web (port 3001)。従来どおり。projects = setup / chromium / runtime。
 *   - `3dp`          : apps/3dp (port 3004)。projects = 3dp-setup / 3dp。testDir は tests/e2e/3dp のみ。
 *                      DB は TDP_TEST_DATABASE_URL の専用 DB (schema `e2e_3dp`) に固定する。
 *                      .env.local の DATABASE_URL (本番) は 3dp では一切使わない (下の tdpDatabaseUrl)。
 *
 * - workers: 1 (シングルユーザー前提、認証 storageState を共有するため並列不可)
 * - storageState 戦略:
 *     `setup` プロジェクトが global.setup.ts (3dp は auth.setup.ts) を 1 回実行 → cookie を
 *     tests/e2e/.auth/ 配下に保存。後続プロジェクトは dependencies で `setup` を待つ。
 * - webServer: web は `pnpm --filter @a2p/web dev`、3dp は `pnpm --filter @3dp/web dev` を起動。
 *     env-file は `--filter` が継承しないので、ここで dotenv を読み込んで
 *     Playwright プロセスの process.env に流し込み、子プロセス (Next dev) に継承させる。
 *     3dp は既存サーバーを再利用しない (別の DB を向いたままの可能性があるため)。
 */
import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync } from 'node:fs';

// .env.local をルート + apps/web の両方で参照可能にしておく。
// CI では env が GitHub Actions の env で渡される前提なのでファイル不存在は無視。
const envLocal = path.resolve(__dirname, '.env.local');
if (existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
}

const E2E_TARGET = process.env.E2E_TARGET ?? 'web';
if (E2E_TARGET !== 'web' && E2E_TARGET !== '3dp') {
  throw new Error(`[e2e] E2E_TARGET は web か 3dp を指定してください (受け取った値: "${E2E_TARGET}")`);
}
const isTdp = E2E_TARGET === '3dp';

// ---- web (apps/web) ----
const PORT = 3001;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// ---- 3dp (apps/3dp) ----
const TDP_PORT = 3004;
const TDP_BASE_URL = `http://localhost:${TDP_PORT}`;
/** 3dp の E2E 専用スキーマ。fixtures/tdp-db.ts が毎回 DROP → 再生する。 */
const TDP_E2E_SCHEMA = 'e2e_3dp';

/**
 * 3dp の DATABASE_URL を組み立てる。`TDP_TEST_DATABASE_URL` (使い捨ての PG。CI は
 * services: postgres、ローカルは testcontainers の URL) だけを元にする。
 * 本番 (Railway) や無関係なローカル DB に E2E の seed/DROP が届かないよう、ここで弾く。
 */
function tdpDatabaseUrl(): string {
  const raw = process.env.TDP_TEST_DATABASE_URL;
  if (!raw) {
    throw new Error(
      '[e2e/3dp] TDP_TEST_DATABASE_URL が未設定です。使い捨ての PG を指定してください。' +
        ' (.env.local の DATABASE_URL は 3dp の E2E では使いません。docs/12 §17.13)',
    );
  }
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && process.env.E2E_ALLOW_REMOTE_DB !== '1') {
    throw new Error(
      `[e2e/3dp] TDP_TEST_DATABASE_URL の接続先が ${url.hostname} です。E2E は使い捨てのローカル PG を前提にします。` +
        ' リモートの使い捨て DB を使う場合のみ E2E_ALLOW_REMOTE_DB=1 を明示してください。',
    );
  }
  if (local && url.port === '5432') {
    throw new Error(
      '[e2e/3dp] localhost:5432 は無関係なプロジェクトの DB に使われ得るため E2E では使いません。testcontainers か CI の PG を指定してください。',
    );
  }
  url.searchParams.set('schema', TDP_E2E_SCHEMA);
  return url.toString();
}

// 3dp モードでは .env.local の DATABASE_URL (本番) を必ず上書きする。
// dotenv は既存の process.env を上書きしないため、ここで代入して Playwright 本体・子プロセス双方に伝える。
if (isTdp) {
  process.env.DATABASE_URL = tdpDatabaseUrl();
}

const WEB_PROJECTS = [
  {
    name: 'setup',
    testMatch: /global\.setup\.ts$/,
  },
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'tests/e2e/.auth/user.json',
    },
    dependencies: ['setup'],
    // setup spec は chromium プロジェクトで再実行しない。3dp の spec は 3dp プロジェクトで走らせる。
    testIgnore: [/global\.setup\.ts$/, /[\\/]3dp[\\/]/],
  },
  {
    name: 'runtime',
    testMatch: /.*-runtime\.spec\.ts$/,
    // Runtime テストは setup 不要（DB ダイレクトテスト）
  },
];

const TDP_PROJECTS = [
  {
    name: '3dp-setup',
    testMatch: /tests[\\/]e2e[\\/]3dp[\\/]auth\.setup\.ts$/,
  },
  {
    name: '3dp',
    testMatch: /tests[\\/]e2e[\\/]3dp[\\/].*\.spec\.ts$/,
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'tests/e2e/.auth/3dp-user.json',
    },
    dependencies: ['3dp-setup'],
  },
];

export default defineConfig({
  // 3dp のときは tests/e2e/3dp だけを読み込む。web 用の spec は import 時に
  // apps/worker 経由で落ちるものがあり、3dp の実行をそれに巻き込まないため。
  testDir: isTdp ? './tests/e2e/3dp' : './tests/e2e',
  // Vitest spec が誤って拾われないよう拡張子を限定
  testMatch: /.*\.spec\.ts$|global\.setup\.ts$/,
  fullyParallel: false,
  workers: 1,
  // 3dp は flaky を隠さない方針 (test.retry を使わない)。web は従来どおり。
  retries: isTdp ? 0 : process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // 3dp は初回アクセスで Next dev がコンパイルするため待ち時間を広げる (各 expect は 30s 以内)。
  timeout: isTdp ? 60_000 : 30_000,
  expect: { timeout: isTdp ? 20_000 : 5_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: isTdp ? TDP_BASE_URL : BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: isTdp ? TDP_PROJECTS : WEB_PROJECTS,
  webServer: isTdp
    ? {
        command: 'pnpm --filter @3dp/web dev',
        url: `${TDP_BASE_URL}/login`,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // tdpDatabaseUrl() で上書き済みの DATABASE_URL を子プロセス (next dev) に継承。
        // AUTH_SECRET は使い捨てのテスト環境用の値 (本番のものではない)。未設定だと Auth.js が
        // MissingSecret で middleware を落とすため、E2E 実行時だけ既定を入れる。
        env: {
          ...process.env,
          PORT: String(TDP_PORT),
          AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-only-3dp-auth-secret-disposable-db',
        } as Record<string, string>,
      }
    : {
        // 既に外部で起動中なら再利用 (ローカル開発時の便利機能)。CI は常に新規起動。
        command: 'pnpm --filter @a2p/web dev',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
        // dotenv で読み込んだ env を子プロセス (next dev) に継承
        env: {
          ...process.env,
          PORT: String(PORT),
        } as Record<string, string>,
      },
});
