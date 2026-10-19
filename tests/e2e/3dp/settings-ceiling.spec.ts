/**
 * 設定の天井 (docs/12 §17.13 Playwright「設定の天井」、§9.6)。
 *
 * R-1 (BOOTH の月間出品上限) に 13 を入れると、サーバーが拒否して文面を返し、DB の値は変わらない。
 * 12 は保存される。加えて T-3DP-02-02 から持ち越した検証 (Vitest では取れない):
 *   - 空欄で保存したとき、数値化された値 (0 など) がサーバーに届いて保存されないこと
 *   - 拒否時の文面が画面に出ること (掴む先は tdp-limit-error。成功時は tdp-limit-success)
 *
 * 文言は apps/3dp/lib/messages.ts から引く。ただし「13 は保存されていません」「最大 12」「現在の値」は
 * 要件 (T-3DP-02-02 / -11) の文字列そのものなので直書きする。
 */
import { expect, test } from '@playwright/test';

import { messages } from '../../../apps/3dp/lib/messages';
import { readTdpLimits, resetTdpState, type TdpLimits } from '../fixtures/tdp-db';
import { gotoSettled } from '../fixtures/tdp-page';

const MAX = 12;

test.describe('設定の天井 (R-1 月間出品上限)', () => {
  // 基準値 = リセット直後の DB の値 (列の DEFAULT)。各テストの前に取り直す。
  let baseline: TdpLimits;

  test.beforeEach(async () => {
    baseline = await resetTdpState();
  });

  test('天井の注記と入力欄の現在値が出る', async ({ page }) => {
    await gotoSettled(page, '/settings');
    await expect(page.getByTestId('tdp-limit-form')).toBeVisible();
    await expect(page.getByTestId('tdp-limit-ceiling')).toHaveText(messages.settings.limitCeilingNote(MAX));
    await expect(page.getByTestId('tdp-limit-input')).toHaveValue(String(baseline.booth));
    await expect(page.getByTestId('tdp-limit-input')).toHaveAttribute('max', String(MAX));
    await expect(page.getByTestId('tdp-badge-tdp_monthly_publish_limit')).toHaveAttribute('data-state', 'proposed');
  });

  test('13 は拒否され、拒否文面が出て、DB の値は変わらない', async ({ page }) => {
    await gotoSettled(page, '/settings');
    await page.getByTestId('tdp-limit-input').fill('13');
    await page.getByTestId('tdp-limit-save').click();

    const error = page.getByTestId('tdp-limit-error');
    await expect(error).toBeVisible();
    await expect(page.getByTestId('tdp-limit-success')).toHaveCount(0);
    // 3 つの文字列は独立に見る。落ちたときにどれが無いかを報告へ残すため soft にする。
    await expect.soft(error).toContainText('13 は保存されていません');
    await expect.soft(error).toContainText(`最大 ${MAX}`);
    await expect.soft(error).toContainText('現在の値');

    // 画面ではなく DB を正とする。拒否されたのに値が変わっていないこと。
    expect(await readTdpLimits()).toEqual(baseline);
  });

  test('空欄で保存しても 0 として受けず、DB の値は変わらない', async ({ page }) => {
    await gotoSettled(page, '/settings');
    await page.getByTestId('tdp-limit-input').fill('');
    await page.getByTestId('tdp-limit-save').click();

    // 0 は有効な値 (出品停止) なので、空欄が 0 に化けて受理されると DB が 0 に変わる。
    // 画面の表示ではなく DB で確かめる。
    await expect(page.getByTestId('tdp-limit-error')).toBeVisible();
    await expect(page.getByTestId('tdp-limit-success')).toHaveCount(0);
    expect(await readTdpLimits()).toEqual(baseline);
  });

  test('12 は保存される', async ({ page }) => {
    await gotoSettled(page, '/settings');
    await page.getByTestId('tdp-limit-input').fill(String(MAX));
    await page.getByTestId('tdp-limit-save').click();

    await expect(page.getByTestId('tdp-limit-success')).toBeVisible();
    await expect(page.getByTestId('tdp-limit-error')).toHaveCount(0);
    expect((await readTdpLimits()).booth).toBe(MAX);
  });
});
