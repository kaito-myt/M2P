/**
 * 3DP の画面を開き、クライアント側の初期化が終わるまで待つ (T-3DP-02-11)。
 *
 * 設定の入力欄は SSR で描画されるが、LimitForm はマウント直後の useEffect で入力値を
 * 初期値へ戻す。hydration の前に fill すると、その入力は effect に消されて保存ボタンが非活性に戻る
 * (2026-10-19 実測の競合)。その競合を避けるため、ネットワークが静まるまで待つ。
 */
import type { Page } from '@playwright/test';

export async function gotoSettled(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}
