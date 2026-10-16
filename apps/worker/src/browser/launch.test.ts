/**
 * browser/launch.ts のテスト (F-098)。
 *
 * 守りたい性質:
 *  1. 同時に起動する Chromium は `WORKER_BROWSER_CONCURRENCY` 本まで (既定 1)
 *  2. `browser.close()` でスロットが返り、待っていた起動が進む
 *  3. EAGAIN / pthread_create は一過性なので再試行する
 *  4. 再試行しても駄目なら投げる。その際スロットは必ず返す
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  launchBrowser,
  isResourceExhaustion,
  resolveBrowserConcurrency,
  __resetBrowserSlots,
  __browserSlotStats,
  BrowserSlotTimeoutError,
} from './launch.js';

type FakeBrowser = { close(): Promise<void>; closed: boolean };

function fakeBrowser(): FakeBrowser {
  const b: FakeBrowser = { closed: false, close: async () => { b.closed = true; } };
  return b;
}

/** playwright の Browser として渡すためのキャスト (テスト専用)。 */
const asPw = (b: FakeBrowser) => b as unknown as import('playwright').Browser;

beforeEach(() => __resetBrowserSlots());

describe('resolveBrowserConcurrency', () => {
  it('既定は 1 本', () => {
    expect(resolveBrowserConcurrency({})).toBe(1);
  });
  it('env で増やせる', () => {
    expect(resolveBrowserConcurrency({ WORKER_BROWSER_CONCURRENCY: '3' })).toBe(3);
  });
  it('不正値は 1 本に落とす', () => {
    expect(resolveBrowserConcurrency({ WORKER_BROWSER_CONCURRENCY: '0' })).toBe(1);
    expect(resolveBrowserConcurrency({ WORKER_BROWSER_CONCURRENCY: 'abc' })).toBe(1);
  });
});

describe('isResourceExhaustion', () => {
  it('Railway で実際に出た文言を資源不足と判定する', () => {
    expect(isResourceExhaustion('spawn /ms-playwright/chrome-headless-shell EAGAIN')).toBe(true);
    expect(isResourceExhaustion('pthread_create: Resource temporarily unavailable (11)')).toBe(true);
    expect(isResourceExhaustion('net::ERR_CONNECTION_REFUSED')).toBe(false);
  });
});

describe('launchBrowser', () => {
  it('2 本目は 1 本目を閉じるまで待たされる', async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    let launched = 0;
    const launch = async () => {
      launched++;
      return asPw(launched === 1 ? first : second);
    };

    const b1 = await launchBrowser({ label: 'a' }, { launch, env: {} });
    expect(launched).toBe(1);

    let secondResolved = false;
    const p2 = launchBrowser({ label: 'b' }, { launch, env: {} }).then((b) => {
      secondResolved = true;
      return b;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondResolved).toBe(false);
    expect(__browserSlotStats()).toEqual({ inUse: 1, waiting: 1 });

    await b1.close();
    const b2 = await p2;
    expect(secondResolved).toBe(true);
    expect(launched).toBe(2);
    await b2.close();
    expect(__browserSlotStats()).toEqual({ inUse: 0, waiting: 0 });
  });

  it('close を二重に呼んでもスロットは 1 回しか返らない', async () => {
    const b = fakeBrowser();
    const browser = await launchBrowser({}, { launch: async () => asPw(b), env: {} });
    await browser.close();
    await browser.close();
    expect(__browserSlotStats()).toEqual({ inUse: 0, waiting: 0 });
  });

  it('WORKER_BROWSER_CONCURRENCY を上げれば同時に取れる', async () => {
    const launch = async () => asPw(fakeBrowser());
    const env = { WORKER_BROWSER_CONCURRENCY: '2' };
    const b1 = await launchBrowser({}, { launch, env });
    const b2 = await launchBrowser({}, { launch, env });
    expect(__browserSlotStats().inUse).toBe(2);
    await b1.close();
    await b2.close();
  });

  it('EAGAIN は再試行して成功させる', async () => {
    let calls = 0;
    const launch = async () => {
      calls++;
      if (calls < 3) throw new Error('spawn chrome-headless-shell EAGAIN');
      return asPw(fakeBrowser());
    };
    const browser = await launchBrowser({}, { launch, env: {}, backoffMs: [1, 1, 1] });
    expect(calls).toBe(3);
    await browser.close();
    expect(__browserSlotStats()).toEqual({ inUse: 0, waiting: 0 });
  });

  it('資源不足でない失敗は即座に投げ、スロットを返す', async () => {
    const launch = async () => {
      throw new Error('executable not found');
    };
    await expect(launchBrowser({}, { launch, env: {} })).rejects.toThrow('executable not found');
    expect(__browserSlotStats()).toEqual({ inUse: 0, waiting: 0 });
  });

  it('再試行を使い切ったら投げ、スロットを返す', async () => {
    const launch = async () => {
      throw new Error('pthread_create: Resource temporarily unavailable (11)');
    };
    await expect(
      launchBrowser({}, { launch, env: {}, backoffMs: [1, 1, 1] }),
    ).rejects.toThrow('Resource temporarily unavailable');
    expect(__browserSlotStats()).toEqual({ inUse: 0, waiting: 0 });
  });

  it('待ちが上限を超えたら retryable なエラーにする (worker を塞がない)', async () => {
    const launch = async () => asPw(fakeBrowser());
    const held = await launchBrowser({}, { launch, env: {} });
    await expect(
      launchBrowser({}, { launch, env: {}, slotWaitMaxMs: 20 }),
    ).rejects.toBeInstanceOf(BrowserSlotTimeoutError);
    await held.close();
  });

  it('close し忘れても slotMaxMs で強制返却する', async () => {
    const launch = async () => asPw(fakeBrowser());
    await launchBrowser({}, { launch, env: {}, slotMaxMs: 20 });
    expect(__browserSlotStats().inUse).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(__browserSlotStats().inUse).toBe(0);
  });
});
