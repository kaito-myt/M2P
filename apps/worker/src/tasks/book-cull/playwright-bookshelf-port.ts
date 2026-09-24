/**
 * KDP 本棚操作 (Playwright) — BookshelfPort の本番実装。
 *
 * 保存済みセッションで本棚を開き、ASIN 完全一致で 1 冊に絞り込み、
 * 「出版停止(unpublish)」→(mode により)「アーカイブ(archive)」を実行する。
 * 実 KDP で検証済みの動線・セレクタを使う。playwright の import は本ファイルに閉じる。
 *
 * 安全策: 検索結果が 1 件でなければ ambiguous で中断。各操作は確認ダイアログまで踏む。
 * デバッグ証跡(スクショ)を R2 に保存する。
 */
import { createLogger } from '@a2p/contracts/logger';

import type {
  ReadPaperbackStatusArgs,
  ReadPaperbackStatusResult,
  BookshelfPort,
  KdpBookStatus,
  ReadBookStatusArgs,
  ReadBookStatusResult,
  TakedownBookArgs,
  TakedownBookResult,
  TakedownStep,
} from './bookshelf-port.js';

const log = createLogger('worker.book-cull.playwright');
const BOOKSHELF_URL = process.env.KDP_BOOKSHELF_URL ?? 'https://kdp.amazon.co.jp/ja_JP/bookshelf';
const DEFAULT_TIMEOUT_MS = 60_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

export function createPlaywrightBookshelfPort(): BookshelfPort {
  return { takedownBook, readBookStatus, readPaperbackStatus };
}

/**
 * KDP 本棚の行テキストから状態ラベルを 5 値に正規化する(純関数、単体テスト対象)。
 * 未知のラベル(行が見つからない/文言変更等)は安全側で 'not_found' にフォールバックする。
 */
export function mapStatusLabel(text: string): KdpBookStatus {
  const t = (text ?? '').trim();
  if (/ブロック|Blocked/i.test(t)) return 'blocked';
  if (/レビュー中|In[\s_-]?Review/i.test(t)) return 'in_review';
  if (/下書き|Draft/i.test(t)) return 'draft';
  if (/販売中|\bLive\b/i.test(t)) return 'live';
  return 'not_found';
}

async function takedownBook(args: TakedownBookArgs): Promise<TakedownBookResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let storageState: unknown;
  try {
    storageState = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'session_expired', message: 'stored session is not valid JSON' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'unknown', message: `playwright unavailable: ${errMsg(err)}` };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const steps: TakedownStep[] = [];
  try {
    const context = await browser.newContext({
      storageState: storageState as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1000 },
    });
    await context.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    async function gotoAndSearch(): Promise<{ dotsId: string; live: boolean } | { error: TakedownBookResult }> {
      await page.goto(BOOKSHELF_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
      await page.waitForTimeout(6000);
      if (/\/ap\/signin|\/signin/i.test(page.url())) {
        return { error: { ok: false, reason: 'session_expired', message: `sign-in redirect (${page.url()})` } };
      }
      const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
      if (!sb) return { error: { ok: false, reason: 'action_failed', message: 'search box not found' } };
      await sb.fill(args.asin);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(6000);
      const content = await page.content();
      if (!content.includes(args.asin)) return { error: { ok: false, reason: 'not_found', message: `ASIN ${args.asin} not found` } };
      const dots = await page.$$('button[id$="-other-actions-announce"]');
      if (dots.length !== 1) return { error: { ok: false, reason: 'ambiguous', message: `${dots.length} results for ${args.asin}` } };
      const dotsId = (await dots[0]!.getAttribute('id')) ?? '';
      return { dotsId, live: /live-book-actions/.test(dotsId) };
    }

    async function openMenu(): Promise<boolean> {
      const dots = await page.$('button[id$="-other-actions-announce"]');
      if (!dots) return false;
      await dots.click().catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    }

    // --- 1. unpublish (live のときのみ) ---
    let r = await gotoAndSearch();
    if ('error' in r) return r.error;
    await saveShot(page, args.asin, 'found');

    if (r.live) {
      if (!(await openMenu())) return { ok: false, reason: 'action_failed', message: 'menu open failed (unpublish)', steps };
      const unpub = await page.$('a[id^="unpublish-"]');
      if (unpub && (await unpub.isVisible().catch(() => false))) {
        await unpub.click().catch(() => {});
        await page.waitForTimeout(2500);
        const confirm = await page.$('#confirm-unpublish-announce');
        if (confirm && (await confirm.isVisible().catch(() => false))) {
          await confirm.click().catch(() => {});
          await page.waitForTimeout(5000);
          steps.push({ step: 'unpublish', ok: true });
          await saveShot(page, args.asin, 'unpublished');
        } else {
          steps.push({ step: 'unpublish', ok: false, note: 'no confirm dialog' });
        }
      } else {
        steps.push({ step: 'unpublish', ok: false, note: 'no unpublish link' });
      }
    } else {
      steps.push({ step: 'unpublish', ok: true, note: 'already not live' });
    }

    // --- 2. archive (mode により) ---
    if (args.mode === 'unpublish_archive') {
      r = await gotoAndSearch(); // 再検索(下書きに変わっているはず)
      if ('error' in r) {
        // 見つからない=既にアーカイブ済みの可能性 → 成功扱い
        return { ok: true, steps, finalState: 'archived_or_gone' };
      }
      if (!(await openMenu())) {
        steps.push({ step: 'archive', ok: false, note: 'menu open failed' });
        return { ok: true, steps, finalState: 'unpublished' };
      }
      const arch = await page.$('a[id^="digital_archive_title-"]');
      if (arch && (await arch.isVisible().catch(() => false))) {
        await arch.click().catch(() => {});
        await page.waitForTimeout(2500);
        const confirm = await page.$('#archive-title-ok-announce');
        if (confirm && (await confirm.isVisible().catch(() => false))) {
          await confirm.click().catch(() => {});
          await page.waitForTimeout(5000);
          steps.push({ step: 'archive', ok: true });
          await saveShot(page, args.asin, 'archived');
          return { ok: true, steps, finalState: 'archived' };
        }
        steps.push({ step: 'archive', ok: false, note: 'no archive confirm dialog' });
      } else {
        steps.push({ step: 'archive', ok: false, note: 'no archive link' });
      }
      return { ok: true, steps, finalState: 'unpublished' };
    }

    return { ok: true, steps, finalState: 'unpublished' };
  } catch (err) {
    const msg = errMsg(err);
    const reason = /timeout/i.test(msg) ? 'timeout' : 'unknown';
    log.warn({ err: msg, asin: args.asin }, 'takedownBook failed');
    return { ok: false, reason, message: msg, steps };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * `kdp.publish.status.sync` 用 READ-ONLY ステータス取得。
 * ログイン/出版/取り下げ等の状態変更操作は一切行わない(検索して状態を読むだけ)。
 */
async function readBookStatus(args: ReadBookStatusArgs): Promise<ReadBookStatusResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const query = args.asin ?? args.title;
  if (!query) return { ok: false, reason: 'action_failed', message: 'asin/title both missing' };

  let storageState: unknown;
  try {
    storageState = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'session_expired', message: 'stored session is not valid JSON' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'unknown', message: `playwright unavailable: ${errMsg(err)}` };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      storageState: storageState as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1000 },
    });
    await context.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    await page.goto(BOOKSHELF_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(6000);
    if (/\/ap\/signin|\/signin/i.test(page.url())) {
      return { ok: false, reason: 'session_expired', message: `sign-in redirect (${page.url()})` };
    }

    const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
    if (!sb) return { ok: false, reason: 'action_failed', message: 'search box not found' };
    await sb.fill(query);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000);

    const content = await page.content();
    if (!content.includes(query)) return { ok: true, status: 'not_found' };

    const dots = await page.$$('button[id$="-other-actions-announce"]');
    if (dots.length === 0) return { ok: true, status: 'not_found' };
    // ASIN 完全一致検索なら通常 1 件。複数ヒットしても最初の 1 件を対象にする(READ-ONLY のため誤爆リスクなし)。
    const rowText = await extractRowText(page, dots[0]!);
    // 行テキストから ASIN を拾って backfill 用に返す(タイトル検索で LIVE 化した本の ASIN 未記録を自己修復する)。
    const asin = (rowText.match(/ASIN:\s*(B0[A-Z0-9]{8})/) ?? [])[1] ?? args.asin ?? null;
    return { ok: true, status: mapStatusLabel(rowText), asin };
  } catch (err) {
    const msg = errMsg(err);
    log.warn({ err: msg, query }, 'readBookStatus failed');
    return { ok: false, reason: 'unknown', message: msg };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** dots(その他操作)ボタンの祖先を辿り、ある程度まとまったテキストを持つ行コンテナのテキストを取る。 */
async function extractRowText(
  page: import('playwright').Page,
  dots: import('playwright').ElementHandle<SVGElement | HTMLElement>,
): Promise<string> {
  return page.evaluate((el: Element) => {
    let node: Element | null = el;
    for (let i = 0; i < 6 && node; i++) {
      const text = node.textContent ?? '';
      if (text.trim().length > 20) return text;
      node = node.parentElement;
    }
    return el.textContent ?? '';
  }, dots);
}

/**
 * [F-097b] ペーパーバック行の状態を READ-ONLY で読む。
 *
 * KDP 本棚は 1 タイトルのカード内に「Kindle 本」行と「ペーパーバック」行を並べて表示し、
 * 各行は `<種別> <状態> 提出日: ... ¥<価格> ... ASIN: <ASIN> ...` というテキストを持つ
 * (2026-09-24 実測)。Kindle の ASIN で検索するとそのカードだけが出るので、
 * 同カード内の「ペーパーバック」で始まる行を拾えば紙版の状態が分かる。
 */
async function readPaperbackStatus(args: ReadPaperbackStatusArgs): Promise<ReadPaperbackStatusResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!args.asin) return { ok: false, reason: 'action_failed', message: 'asin is required' };

  let storageState: unknown;
  try {
    storageState = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'session_expired', message: 'stored session is not valid JSON' };
  }

  let chromium: typeof import('playwright').chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    return { ok: false, reason: 'unknown', message: `playwright unavailable: ${errMsg(err)}` };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    const context = await browser.newContext({
      storageState: storageState as Awaited<ReturnType<import('playwright').BrowserContext['storageState']>>,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1100 },
    });
    await context.addInitScript({ content: 'globalThis.__name = globalThis.__name || function (f) { return f; };' });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    await page.goto(BOOKSHELF_URL, { waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => {});
    await page.waitForTimeout(6000);
    if (/\/ap\/signin|\/signin/i.test(page.url())) {
      return { ok: false, reason: 'session_expired', message: `sign-in redirect (${page.url()})` };
    }

    const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
    if (!sb) return { ok: false, reason: 'action_failed', message: 'search box not found' };
    await sb.fill(args.asin);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000);

    const rowText = await page.evaluate(() => {
      // 「ペーパーバック」で始まり ASIN を含む最小の行コンテナを探す。
      let best: string | null = null;
      for (const el of Array.from(document.querySelectorAll('div,li,tr'))) {
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!t.startsWith('ペーパーバック')) continue;
        if (!/ASIN:/.test(t)) continue;
        if (best === null || t.length < best.length) best = t;
      }
      return best;
    });

    if (!rowText) return { ok: true, status: 'not_found', pbAsin: null, priceJpy: null };

    const pbAsin = (rowText.match(/ASIN:\s*([A-Z0-9]{10})/) ?? [])[1] ?? null;
    const priceRaw = (rowText.match(/¥\s*([0-9,]+)/) ?? [])[1] ?? null;
    const priceJpy = priceRaw ? Number(priceRaw.replace(/,/g, '')) : null;
    const status = /販売停止中/.test(rowText) ? 'unpublished' : mapPaperbackStatusLabel(rowText);
    return { ok: true, status, pbAsin, priceJpy: Number.isFinite(priceJpy) ? priceJpy : null };
  } catch (err) {
    const msg = errMsg(err);
    log.warn({ err: msg, asin: args.asin }, 'readPaperbackStatus failed');
    return { ok: false, reason: 'unknown', message: msg };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * ペーパーバック行のラベル → 状態。KDP は「出版準備中」も使うので in_review に寄せる
 * (Kindle 側の mapStatusLabel には無いラベル)。
 */
export function mapPaperbackStatusLabel(text: string): 'live' | 'draft' | 'in_review' | 'blocked' | 'not_found' {
  const t = (text ?? '').trim();
  if (/ブロック|Blocked/i.test(t)) return 'blocked';
  if (/レビュー中|出版準備中|In[\s_-]?Review/i.test(t)) return 'in_review';
  if (/下書き|Draft/i.test(t)) return 'draft';
  if (/販売中|Live/i.test(t)) return 'live';
  return 'not_found';
}

async function saveShot(page: import('playwright').Page, asin: string, stage: string): Promise<void> {
  try {
    const mod = await import('@a2p/storage');
    const key = `debug/book-cull/${asin}-${stage}-${page.url().length}.png`;
    const png = await page.screenshot();
    await mod.uploadBuffer(key, png, 'image/png');
    log.info({ asin, stage, key }, 'saved book-cull debug shot');
  } catch {
    /* best-effort */
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
