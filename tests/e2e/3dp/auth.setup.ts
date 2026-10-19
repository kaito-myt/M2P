/**
 * 3DP の認証セットアップ (T-3DP-02-11)。
 *
 * 1. 専用スキーマを作り直し、テストユーザーと設定の行を入れる (fixtures/tdp-db.ts)
 * 2. /login からフォーム経由でログインし、storageState を tests/e2e/.auth/3dp-user.json に保存する
 * 3. 設定が読めていること (ホームに degraded の警告が出ていないこと) を確かめる。
 *    読めていないまま後続の spec を走らせると、原因の遠い失敗が大量に出るため、ここで止める。
 *
 * 前提: playwright.config.ts (E2E_TARGET=3dp) が TDP_TEST_DATABASE_URL を検査し、
 * 3004 の apps/3dp を起動している。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test as setup } from '@playwright/test';

import { TDP_E2E_PASSWORD, TDP_E2E_USERNAME, resetTdpE2eDatabase } from '../fixtures/tdp-db';

const STORAGE_STATE_PATH = path.resolve('tests/e2e/.auth/3dp-user.json');

setup('3dp authenticate', async ({ page }) => {
  mkdirSync(path.dirname(STORAGE_STATE_PATH), { recursive: true });

  const { skippedMigrations } = await resetTdpE2eDatabase();
  if (skippedMigrations.length > 0) {
    console.warn(`[e2e/3dp] ANP ドリフトで skip した migration: ${skippedMigrations.join(', ')}`);
  }

  await page.goto('/login');
  await expect(page.getByTestId('login-submit')).toBeVisible();
  await page.getByTestId('login-username').fill(TDP_E2E_USERNAME);
  await page.getByTestId('login-password').fill(TDP_E2E_PASSWORD);
  await page.getByTestId('login-submit').click();

  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByTestId('tdp-hero')).toBeVisible();
  await expect(page.getByTestId('tdp-home-warning')).toHaveCount(0);
  await page.context().storageState({ path: STORAGE_STATE_PATH });
});
