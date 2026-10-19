/**
 * 設定のタブ (docs/12 §9.8 S-3DP-06、§7.3a、T-3DP-02-08)。
 *
 * - `/settings` は「安全装置」を開く。`?tab=` で 4 タブ (安全装置 / 企画と価格 / 生成 / 判定値) が切り替わる。
 * - 未指定・未知の値・`media` (Inc-4 で入るタブ) はすべて安全装置に倒れる。
 * - 提案値の注意書きは全タブにある (UR-7)。R-1 の提案値バッジは「提案値 (未承認)」を色だけでなく文言で出す。
 */
import { expect, test } from '@playwright/test';

import { messages } from '../../../apps/3dp/lib/messages';
import { resetTdpState } from '../fixtures/tdp-db';

const m = messages.settings;

test.describe('設定のタブ (S-3DP-06)', () => {
  test.beforeEach(async () => {
    await resetTdpState();
  });

  test('/settings は安全装置を開き、タブをクリックすると ?tab= で切り替わる', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('tdp-tab-safety')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tdp-limit-form')).toBeVisible();

    await page.getByTestId('tdp-tab-generation').click();
    await expect(page).toHaveURL(/[?&]tab=generation(&|$)/);
    await expect(page.getByTestId('tdp-tab-generation')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tdp-tab-safety')).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('tdp-group-form-generation')).toBeVisible();
    await expect(page.getByTestId('tdp-limit-form')).toHaveCount(0);
  });

  test('?tab= を直接開くと該当タブが選ばれる (4 タブすべて)', async ({ page }) => {
    for (const tab of ['plan_price', 'generation', 'gates'] as const) {
      await page.goto(`/settings?tab=${tab}`);
      await expect(page.getByTestId(`tdp-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId(`tdp-tab-${tab}`)).toHaveText(m.tabs[tab]!);
    }
  });

  test('未知の値・未指定・media はすべて安全装置に倒れる', async ({ page }) => {
    for (const url of ['/settings?tab=bogus', '/settings?tab=media', '/settings']) {
      await page.goto(url);
      await expect(page.getByTestId('tdp-tab-safety')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('tdp-limit-form')).toBeVisible();
    }
  });

  test('4 タブのどれにも提案値の注意書きがある', async ({ page }) => {
    for (const url of ['/settings', '/settings?tab=plan_price', '/settings?tab=generation', '/settings?tab=gates']) {
      await page.goto(url);
      await expect(page.getByTestId('tdp-proposal-notice')).toHaveText(m.proposalNotice);
    }
  });

  test('提案値バッジは未確認の間「提案値 (未承認)」と出る', async ({ page }) => {
    await page.goto('/settings');
    const badge = page.getByTestId('tdp-badge-tdp_monthly_publish_limit');
    await expect(badge).toHaveAttribute('data-state', 'proposed');
    await expect(badge).toHaveText(m.badge.proposed!);
  });
});
