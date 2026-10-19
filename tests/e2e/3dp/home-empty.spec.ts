/**
 * 空状態のホーム (docs/12 §17.13 Playwright「空状態」、§9.6、F-3DP-12 / F-3DP-35)。
 *
 * 商品 0 件のとき、ホームは「立ち上げチェック」を見せ、売上が無い間のヒーローは「0 円」ではなく
 * 「—」と理由を出す。運営者向けでない開発の文言 (Inc-N) は出さない (UR-8)。
 * 文言は messages から引き、Inc- は本文全体に対して確かめる。
 */
import { expect, test } from '@playwright/test';

import { messages } from '../../../apps/3dp/lib/messages';
import { resetTdpState } from '../fixtures/tdp-db';

const m = messages.home;

test.describe('空状態のホーム (商品 0 件)', () => {
  test.beforeEach(async () => {
    await resetTdpState();
  });

  test('立ち上げチェックが見え、0 円を出さず、— と理由を出す', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByTestId('tdp-launch-check')).toBeVisible();
    await expect(page.getByRole('heading', { name: m.launch.title })).toBeVisible();
    await expect(page.getByTestId('tdp-launch-confirm_proposals')).toHaveAttribute('data-state', 'todo');

    await expect(page.getByTestId('tdp-hero-net-profit')).toHaveText(m.hero.none);
    await expect(page.getByTestId('tdp-hero-net-profit-reason')).toHaveText(m.hero.notStarted);
    await expect(page.getByTestId('tdp-hero-sales-per-product')).toHaveText(m.hero.none);
    await expect(page.getByTestId('tdp-hero-sales-per-product-reason')).toHaveText(m.hero.notStarted);

    await expect(page.getByTestId('tdp-total-count')).toHaveText('0');
    await expect(page.getByText(m.empty)).toBeVisible();
  });

  test('画面本文に 0 円 も Inc- も出ない', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('tdp-hero')).toBeVisible();

    const text = await page.locator('body').innerText();
    expect(text).not.toContain('0 円');
    expect(text).not.toMatch(/Inc-/);
  });
});
