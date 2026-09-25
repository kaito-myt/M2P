/**
 * ペーパーバックの「下書き → 出版」をサーバー側 (Railway) で実行する Playwright ポート (F-097d)。
 *
 * 運営者要望 (2026-09-25)「ペーパーバックの出版もローカルからじゃなくて Railway からできないの？」。
 * ローカル専用だった `scripts/paperback/pb-complete.mjs` の実績フローをそのまま移植する。
 * 既に `kdp.submit` が同じ再認証の壁 (`max_auth_age=0` + OTP) をサーバーで突破できているので、
 * ペーパーバックも同じ土俵に載せられる。
 *
 * フロー (すべて実測ベース。コメントの日付は実地確認日):
 *   1. details を開いて「保存して続行」 — これを飛ばすと後段が blocked_prior_page になる (2026-09-10)
 *   2. content でプレビューアーを起動 → `#max_page_label` に総頁数が出るまで待つ (最大 15 分)
 *   3. 可視の「承認」ボタンを trusted click (synthetic click では記録されない)
 *   4. **承認後に「印刷プレビューアーを終了」を押さない** — 押すと承認が取り消される (2026-09-25)。
 *      15 秒待って content へ goto して抜ける
 *   5. content の警告文が消えたか検証。残っていれば最大 3 回やり直す
 *   6. 「保存して続行」→ pricing で `#price-input-jpy` に定価を入力 → 「ペーパーバック本を出版」
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。
 */
import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

const log = createLogger('worker.paperback-submit.playwright');

const BASE = 'https://kdp.amazon.co.jp';
/** content ページに残っていると保存が黙ってブロックされる警告文 (= プレビュー未承認)。 */
const PREVIEW_WARN = '続行する前に、これらの変更をプレビューして確認してください';

export interface PaperbackPublishArgs {
  /** KDP のペーパーバック titleId。 */
  titleId: string;
  /** 復号済み storageState (JSON 文字列)。 */
  sessionState: string;
  /** 再認証用。password が無いと壁を越えられない。 */
  password: string;
  totpSecret?: string | null;
  /** true = pricing まで進めて出版ボタンは押さない。 */
  dryRun: boolean;
  /** 価格を決める関数 (総頁数 → 円)。プレビューアーが返す実頁数で計算する。 */
  priceFor: (pages: number) => number;
  /** デバッグ用スクショの保存先 (ローカル tmp)。 */
  stageDir?: string;
}

export type PaperbackPublishResult =
  | { ok: true; status: 'submitted' | 'dry_run_ready'; pages: number | null; priceJpy: number | null }
  | {
      ok: false;
      reason: 'reauth_failed' | 'no_previewer' | 'not_approved' | 'blocked_prior_page' | 'no_price_field' | 'uncertain' | 'error';
      message: string;
    };

export interface PaperbackPublishPort {
  publishDraft(args: PaperbackPublishArgs): Promise<PaperbackPublishResult>;
}

export function createPlaywrightPaperbackPort(): PaperbackPublishPort {
  return { publishDraft };
}

async function publishDraft(args: PaperbackPublishArgs): Promise<PaperbackPublishResult> {
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
      viewport: { width: 1760, height: 1200 },
    });
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('dialog', (d: any) => {
      log.info({ message: String(d.message()).slice(0, 120) }, 'dialog auto-accepted');
      void d.accept().catch(() => {});
    });

    const { titleId } = args;

    /** 再認証ウォール (max_auth_age=0) を通す。遷移を待ってから DOM を触る (2026-09-25 の教訓)。 */
    const passReauth = async (label: string): Promise<boolean> => {
      if (!/\/ap\/signin/.test(page.url())) return true;
      log.info({ label }, 'kdp reauth wall');
      try {
        const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
        if (!pf || !args.password) return false;
        await pf.click({ force: true }).catch(() => {});
        await pf.fill('').catch(() => {});
        await pf.type(args.password, { delay: 35 });
        await page.check('#auth-remember-me').catch(() => {});
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null),
          page.click('#signInSubmit').catch(() => {}),
        ]);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(5000);

        const otp = await page.$('#auth-mfa-otpcode').catch(() => null);
        if (otp) {
          const secret = (args.totpSecret ?? '').replace(/[\s-]/g, '');
          if (!secret) return false;
          const { authenticator } = await import('otplib');
          await otp.type(authenticator.generate(secret), { delay: 35 }).catch(() => {});
          await page.check('#auth-mfa-remember-device').catch(() => {});
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null),
            page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter').catch(() => {})),
          ]);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForTimeout(5000);
        }
        return !/\/ap\/signin/.test(page.url());
      } catch (err) {
        log.warn({ err: errMsg(err), label }, 'reauth failed');
        return !/\/ap\/signin/.test(page.url());
      }
    };

    const gotoWithReauth = async (url: string, tag: string): Promise<boolean> => {
      await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(7000);
      if (!(await passReauth(tag))) return false;
      const tail = url.split('/').pop() ?? '';
      if (!page.url().includes(tail)) {
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(7000);
        // セッション反映待ちで 2 回目も聞かれることがある。
        if (!(await passReauth(`${tag}-retry`))) return false;
      }
      return true;
    };

    /** 可視の最初の 1 件を trusted click する (不可視の同名要素を掴むと force でも落ちる)。 */
    const clickVisible = async (re: RegExp): Promise<boolean> => {
      const cands = page.locator('.a-button-text, button, a, [role=button], input[type=submit]').filter({ hasText: re });
      const n = await cands.count().catch(() => 0);
      for (let i = 0; i < n; i += 1) {
        const c = cands.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        if (await c.click({ force: true, timeout: 15000 }).then(() => true).catch(() => false)) return true;
      }
      return false;
    };

    // --- STEP 0: details を保存し直して前段を確定させる ---
    if (!(await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/details`, 'details'))) {
      return { ok: false, reason: 'reauth_failed', message: '詳細ページで再認証できませんでした' };
    }
    const detailsSaved = await clickVisible(/保存して続行/);
    log.info({ titleId, detailsSaved }, 'paperback details saved');
    await page.waitForTimeout(12000);
    await passReauth('details-save');

    // --- STEP A: content でプレビューアー承認 ---
    if (!(await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'content'))) {
      return { ok: false, reason: 'reauth_failed', message: 'コンテンツページで再認証できませんでした' };
    }

    const readTotalPages = async (): Promise<number | null> => {
      const v = await page
        .evaluate(() => {
          const el = document.querySelector('#max_page_label');
          const m = (el?.textContent ?? '').match(/(\d{2,4})/);
          return m ? m[1] : null;
        })
        .catch(() => null);
      const n = v ? Number(v) : NaN;
      return Number.isFinite(n) && n >= 20 ? n : null;
    };

    const approveOnce = async (): Promise<{ opened: boolean; pages: number | null }> => {
      const opened = await clickVisible(/プレビューアーを起動/);
      if (!opened) return { opened: false, pages: null };
      // 変換完了待ち (最大 15 分)。完了前に閉じるとプレビュー実施と見なされない。
      let pages: number | null = null;
      for (let i = 0; i < 90; i += 1) {
        await page.waitForTimeout(10000);
        pages = await readTotalPages();
        if (pages) break;
      }
      // フッターの描画は総頁数より遅れるので、承認ボタンは最大 60 秒リトライする。
      let approved = false;
      for (let attempt = 0; attempt < 12 && !approved; attempt += 1) {
        approved = await clickVisible(/^\s*承認\s*$/);
        if (!approved) await page.waitForTimeout(5000);
      }
      log.info({ titleId, pages, approved }, 'paperback preview approve clicked');
      // [2026-09-25] 承認直後に終了ボタンを押すと承認が取り消される。押さずに離れる。
      await page.waitForTimeout(15000);
      await page.goto(`${BASE}/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(6000);
      await passReauth('after-approve');
      return { opened: true, pages };
    };

    const needsPreview = async (): Promise<boolean> => {
      if (!/\/content/.test(page.url())) {
        await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'content-verify');
      }
      await page.waitForTimeout(4000);
      return page.evaluate((w: string) => (document.body.innerText || '').includes(w), PREVIEW_WARN).catch(() => false);
    };

    let pages: number | null = null;
    let approvedOk = false;
    for (let round = 0; round < 4; round += 1) {
      if (!(await needsPreview())) {
        approvedOk = true;
        break;
      }
      const r = await approveOnce();
      if (!r.opened) {
        return { ok: false, reason: 'no_previewer', message: 'プレビューアー起動ボタンが見つかりません' };
      }
      pages = r.pages ?? pages;
    }
    if (!approvedOk) {
      return { ok: false, reason: 'not_approved', message: 'プレビュー承認が記録されませんでした (4 回試行)' };
    }
    log.info({ titleId, pages }, 'paperback preview approved');

    // --- content を保存して pricing へ ---
    const contSaved = await clickVisible(/保存して続行/);
    log.info({ titleId, contSaved }, 'paperback content saved');
    await page.waitForTimeout(12000);
    await passReauth('content-save');

    if (!/pricing/.test(page.url())) {
      if (!(await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/pricing`, 'pricing'))) {
        return { ok: false, reason: 'reauth_failed', message: '価格ページで再認証できませんでした' };
      }
    }

    const priceJpy = args.priceFor(pages ?? 200);
    const jp = await page.waitForSelector('#price-input-jpy', { timeout: 30000 }).catch(() => null);
    if (!jp) return { ok: false, reason: 'no_price_field', message: '価格入力欄が見つかりません' };
    await jp.click({ force: true, timeout: 8000 }).catch(() => {});
    await jp.fill('').catch(() => {});
    await jp.type(String(priceJpy), { delay: 40 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(4000);
    log.info({ titleId, priceJpy, pages }, 'paperback price filled');

    // 「以前のページに問題が見つかりました」= 前段が確定していない。戻らず失敗として返す。
    const blocked = await page
      .evaluate(() => {
        const d = [...document.querySelectorAll('[role=dialog], .a-popover')].find(
          (x) => ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight) && /以前のページに問題/.test(x.textContent || ''),
        );
        return d ? (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
      })
      .catch(() => null);
    if (blocked) return { ok: false, reason: 'blocked_prior_page', message: blocked };

    if (args.dryRun) return { ok: true, status: 'dry_run_ready', pages, priceJpy };

    const published = await clickVisible(/ペーパーバック本を出版/);
    log.info({ titleId, published }, 'paperback publish clicked');
    await page.waitForTimeout(12000);
    await passReauth('after-publish');
    await page.waitForTimeout(5000);

    const state = await page
      .evaluate(() => {
        const t = document.body.textContent || '';
        return { url: location.href, review: /レビュー中|審査|出版準備中|提出されました/.test(t) };
      })
      .catch(() => ({ url: '', review: false }));
    if (state.review || /bookshelf/.test(state.url)) {
      return { ok: true, status: 'submitted', pages, priceJpy };
    }
    return { ok: false, reason: 'uncertain', message: `出版後の確認ができませんでした (${state.url.slice(0, 80)})` };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
