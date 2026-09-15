/**
 * note ダッシュボード READ-ONLY スクレイプ (F-ANP-40, docs/11-anp-design.md §2.2)。
 *
 * `scripts/anp/note-stats-recon.mjs` (2026-09-16) で採取した実 DOM に基づく実装。
 *   - `https://note.com/dashboard` を開き、期間セレクタ(`<select>`, 1番目)を **`THIS_MONTH`
 *     にして `change` イベントを発火**させることで「今月」スコープのデータに切り替える。
 *     ⚠️ `?period=THIS_MONTH` を URL クエリで直接指定する方式は**信頼できないことを実機確認済み**
 *     (2026-09-16 code review 対応の再偵察): クエリ直指定だと前月(8月)のデータが返る一方、
 *     `?period=ALL` は URL 指定でも正しく反映される — note のクライアント側の初期化順序に
 *     起因する非対称なバグと推測される。安全のため **どの period 値も select 要素への実操作
 *     (`el.value=...; el.dispatchEvent(new Event('change'))`) で切り替える方式に統一**する。
 *   - 記事別テーブル (タイトル/インプレッション/ページビュー/スキ/コメント/売上) を
 *     「もっとみる」ボタンを繰り返しクリックして全件展開し取得。THIS_MONTH 選択後は
 *     当月にアクティビティ(閲覧等)があった記事のみが対象になる(実機確認済み — 8月公開の
 *     記事でも9月にビューが付いていれば表示された)。
 *   - フォロワー数は `https://note.com/<handle>` の `<a href="/<handle>/followers">{N}フォロワー</a>`
 *     (period 非依存の累計値)。
 *   - メンバーシップ (入会/退会/売上) は同ダッシュボードの「メンバーシップ」タブ
 *     (期間セレクタは記事別テーブルと共通のため THIS_MONTH 選択後にタブ切替すれば当月分になる)。
 *   - `/dashboard/salesmanage` `/dashboard/sales` (詳細な売上・購入者数) はセッション再利用でも
 *     パスワード再確認 (ステップアップ認証) を要求されるため取得不可 (docs/11 §2.2 記載の制約)。
 *     `buyers` は取得できないため常に 0 で保存する (best-effort・既知の制約)。
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。
 */
import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';
import {
  aggregateMembership,
  parseDashboardRow,
  parseFollowerCount,
  parseMembershipRow,
  type NoteDashboardArticleStat,
} from './parse.js';

const log = createLogger('worker.note-sales.playwright');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

const MAX_LOAD_MORE_CLICKS = 8;

export interface NoteSalesFetchArgs {
  sessionState: string;
  /** 分かっていればクリエイターページ (フォロワー数) も取得する。 */
  handle?: string | null;
}

export type NoteSalesFetchResult =
  | {
      ok: true;
      articles: NoteDashboardArticleStat[];
      followers: number | null;
      membership: { subscribers: number; mrrJpy: number } | null;
    }
  | { ok: false; reason: 'not_logged_in' | 'error'; message: string };

export interface NoteSalesPort {
  fetchStats(args: NoteSalesFetchArgs): Promise<NoteSalesFetchResult>;
}

export function createPlaywrightNoteSalesPort(): NoteSalesPort {
  return { fetchStats };
}

async function fetchStats(args: NoteSalesFetchArgs): Promise<NoteSalesFetchResult> {
  let storageStateObj: unknown;
  try {
    storageStateObj = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'error', message: 'session state is not valid JSON' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'error', message: `playwright unavailable: ${errMsg(err)}` };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      storageState: storageStateObj as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1400 },
    });
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(45000);

    await page.goto('https://note.com/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(4000);

    if (/\/login\b/i.test(page.url()) || (await page.$('input[type=password]').catch(() => null))) {
      return { ok: false, reason: 'not_logged_in', message: `セッション失効 (url=${page.url().slice(0, 90)})` };
    }

    // 期間を「今月」に切り替える(URL クエリではなく select 実操作。ファイル冒頭コメント参照)。
    const periodSet = await page
      .evaluate(() => {
        const sel = document.querySelectorAll('select')[0] as HTMLSelectElement | undefined;
        if (!sel) return false;
        sel.value = 'THIS_MONTH';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return sel.value === 'THIS_MONTH';
      })
      .catch(() => false);
    if (!periodSet) {
      // 既定期間は「今月」ではない。切替に失敗したまま続行すると別期間の売上/ビューが
      // year_month=当月として保存され、ホームの当月純利益に混入する。書き込みを中止して
      // 次回 dispatch に委ねる(code-reviewer 指摘 2026-09-15)。
      return {
        ok: false,
        reason: 'error',
        message: '期間セレクタ(THIS_MONTH)への切替に失敗 — DOM 変更の可能性。当月行への書き込みを中止',
      };
    }
    await page.waitForTimeout(2500);

    // 記事別テーブル (2番目の table。docs/11 §2.2) を「もっとみる」で全件展開する。
    for (let i = 0; i < MAX_LOAD_MORE_CLICKS; i++) {
      const clicked = await clickByText(page, 'もっとみる');
      if (!clicked) break;
      await page.waitForTimeout(1200);
    }

    const rawRows: Array<{ href: string | null; cells: string[] }> = await page
      .evaluate(() => {
        const tables = [...document.querySelectorAll('table')];
        const t = tables.find((tb) => (tb.querySelector('th')?.textContent || '').includes('タイトル'));
        if (!t) return [];
        return [...t.querySelectorAll('tbody tr')].map((tr) => {
          const a = tr.querySelector('td a[href*="/n/"]') as HTMLAnchorElement | null;
          const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '');
          return { href: a?.href ?? null, cells };
        });
      })
      .catch(() => [] as Array<{ href: string | null; cells: string[] }>);

    const articles = rawRows
      .map((r) => parseDashboardRow(r.href, r.cells))
      .filter((r): r is NoteDashboardArticleStat => r !== null);
    if (rawRows.length === 0) {
      log.warn({}, '記事別テーブルが見つかりません(DOM変更の可能性)');
    }

    // メンバーシップタブ (入会/退会/売上)。
    let membership: { subscribers: number; mrrJpy: number } | null = null;
    const membershipClicked = await page
      .evaluate(() => {
        const el = [...document.querySelectorAll('button,a,[role=tab]')].find(
          (x) => (x.textContent || '').trim() === 'メンバーシップ',
        ) as HTMLElement | undefined;
        if (!el) return false;
        el.click();
        return true;
      })
      .catch(() => false);
    if (membershipClicked) {
      await page.waitForTimeout(1500);
      const membershipRows: string[][] = await page
        .evaluate(() => {
          const tables = [...document.querySelectorAll('table')];
          const t = tables.find((tb) => (tb.querySelector('th')?.textContent || '').includes('入会'));
          if (!t) return [];
          return [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''));
        })
        .catch(() => [] as string[][]);
      const parsedRows = membershipRows.map(parseMembershipRow).filter((r): r is NonNullable<typeof r> => r !== null);
      if (parsedRows.length > 0) membership = aggregateMembership(parsedRows);
    }

    // フォロワー数 (handle が分かっている場合のみ)。
    let followers: number | null = null;
    if (args.handle) {
      await page.goto(`https://note.com/${args.handle}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(2500);
      const followerText = await page
        .evaluate((handle: string) => {
          const el = document.querySelector(`a[href="/${handle}/followers"]`);
          return el?.textContent ?? null;
        }, args.handle)
        .catch(() => null);
      followers = parseFollowerCount(followerText);
    }

    return { ok: true, articles, followers, membership };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function clickByText(page: Page, text: string): Promise<boolean> {
  return page
    .evaluate((t: string) => {
      const el = [...document.querySelectorAll('button,[role=button]')].find(
        (x) => (x.textContent || '').trim() === t && ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
      ) as HTMLElement | undefined;
      if (!el) return false;
      el.click();
      return true;
    }, text)
    .catch(() => false);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
