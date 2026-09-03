/**
 * BOOK☆WALKER 著者センター 自動入稿 (Playwright) [F-094]。
 *
 * `scripts/bookwalker/bw-submit.mjs` の実証済フロー (2026-09-02〜03, 40冊申請済) を
 * worker headless へ移植したもの。https://author.bookwalker.jp/books/new のフォームに
 * 基本情報+3ファイル(表紙JPG/販売用EPUB/試し読みEPUB)を入力し、
 * 「販売を申請する」→確認モーダルの 2 段階を **信頼済みクリック** (force:true =
 * CDP 経由 isTrusted=true。synthetic click では React ハンドラが発火しない) で通す。
 * 成功判定 = `POST /api/books/register` が 2xx/3xx かつインラインバリデーション無し。
 *
 * ログインは reCAPTCHA によりサーバーから不可 — 復号済み storageState (Cookie) を再利用し、
 * 未ログイン検知時は `not_logged_in` で返す (ローカルで bw-session-push.mjs 再実行が必要)。
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。evaluate 内は DOM 参照可。
 */
import path from 'node:path';

import { chromium, type BrowserContextOptions, type Page } from 'playwright';

import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';

const log = createLogger('worker.bw-submit.playwright');

const NEW_BOOK_URL = 'https://author.bookwalker.jp/books/new';

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface BwBookInput {
  id: string;
  title: string;
  title_kana?: string | null;
  subtitle?: string | null;
  /** theme_candidates.genre — BW カテゴリ (実用/文芸・小説/ラノベ) の決定に使う。 */
  genre?: string | null;
  description?: string | null;
  keywords?: string[] | null;
  /** 税抜き販売価格 (円)。 */
  price_notax: number;
  author: string;
  author_kana: string;
  /** ローカル tmp のファイルパス。 */
  coverJpgPath: string;
  epubPath: string;
  trialEpubPath: string;
}

export interface BwSubmitArgs {
  book: BwBookInput;
  /** 復号済み storageState(JSON 文字列)。 */
  sessionState: string;
  /** true = 「販売を申請する」を押さず下書き保存で止める。 */
  dryRun?: boolean;
  /** スクショ保存先ディレクトリ。 */
  stageDir: string;
}

export type BwSubmitResult =
  | { ok: true; status: 'submitted' | 'dry_run_ready'; storageState: string }
  | {
      ok: false;
      reason: 'not_logged_in' | 'validation' | 'uncertain' | 'error';
      message: string;
      storageState?: string;
    };

export interface BwSubmitPort {
  submitOne(args: BwSubmitArgs): Promise<BwSubmitResult>;
}

export function createPlaywrightBwSubmitPort(): BwSubmitPort {
  return { submitOne };
}

// ---------------------------------------------------------------------------
// カテゴリ対応 (Kindle ジャンル → BW トップ×サブ)
// ---------------------------------------------------------------------------

export function bwCategory(
  genre: string | null | undefined,
  title: string,
): { top: string; sub: string | null } {
  const g = genre || '';
  if (/light_novel|ラノベ/.test(g)) return { top: 'ライトノベル', sub: 'ファンタジー' };
  if (/novel|fiction|romance|fantasy|mystery|horror|literature/.test(g)) {
    return { top: '文芸・小説', sub: /官能/.test(title) ? '官能小説' : 'エッセイ' };
  }
  return { top: '実用（評論・情報）', sub: null };
}

// ---------------------------------------------------------------------------
// 実装
// ---------------------------------------------------------------------------

/** Cookie 同意バナー等のオーバーレイを除去 (クリック遮蔽で 15s タイムアウトするため)。 */
async function clearOverlays(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const b of document.querySelectorAll('button,a')) {
        if (
          /すべてのCookieを許可|必須のCookieのみ許可|閉じる/.test(b.textContent || '') &&
          ((b as HTMLElement).offsetWidth || (b as HTMLElement).offsetHeight)
        ) {
          (b as HTMLElement).click();
        }
      }
    })
    .catch(() => {});
}

/** インラインバリデーションエラー (「100文字以下にしてください」等) を収集。 */
async function inlineErrors(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('input,textarea,select')) {
        const sib = el.parentElement?.querySelector(
          '.error, .invalid-feedback, [class*=error], [class*=Error]',
        ) as HTMLElement | null;
        if (sib && (sib.offsetWidth || sib.offsetHeight)) {
          out.push(
            ((el as HTMLInputElement).id || (el as HTMLInputElement).name) +
              ': ' +
              (sib.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          );
        }
      }
      return [...new Set(out)];
    })
    .catch(() => []);
}

async function submitOne(args: BwSubmitArgs): Promise<BwSubmitResult> {
  const { book, dryRun, stageDir } = args;
  let storageStateJson: unknown;
  try {
    storageStateJson = JSON.parse(args.sessionState);
  } catch {
    return { ok: false, reason: 'error', message: 'sessionState JSON parse failed' };
  }

  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const ctx = await browser.newContext({
    storageState: storageStateJson as BrowserContextOptions['storageState'],
    userAgent: UA,
    locale: 'ja-JP',
    viewport: { width: 1400, height: 1100 },
  });
  ctx.setDefaultTimeout(60_000);
  const page = await ctx.newPage();
  const shot = (n: string) =>
    page.screenshot({ path: path.join(stageDir, `bw-${n}.png`), fullPage: true }).catch(() => {});

  const finish = async <T extends BwSubmitResult>(result: T): Promise<T> => {
    // セッション延命のため最新 storageState を返す (Cookie ローテーション追随)。
    try {
      (result as { storageState?: string }).storageState = JSON.stringify(await ctx.storageState());
    } catch {
      /* storageState 取得失敗は無視 */
    }
    await browser.close().catch(() => {});
    return result;
  };

  try {
    log.info({ book_id: book.id }, 'browser launched — goto /books/new');
    await page.goto(NEW_BOOK_URL, { waitUntil: 'domcontentloaded' });
    log.info({ url: page.url().slice(0, 90) }, 'goto done');
    await page.waitForTimeout(6000);
    await clearOverlays(page);
    await page.waitForTimeout(1500);

    if (!/books\/new/.test(page.url()) || (await page.$('input[type=password]'))) {
      await shot('not-logged-in');
      return finish({
        ok: false,
        reason: 'not_logged_in',
        message: `セッション失効 (url=${page.url().slice(0, 80)}) — ローカルで bw-session-push.mjs を再実行してください`,
      });
    }

    // --- 基本情報 ---
    const setV = async (sel: string, v: string | null | undefined) => {
      if (v == null || v === '') return;
      const e = await page.$(sel);
      if (e) {
        await e.click().catch(() => {});
        await e.fill(String(v)).catch(() => {});
      }
    };
    const descText = String(book.description || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    await setV('#book_main_title', book.title);
    await setV('#book_main_title_kana', book.title_kana || '');
    await setV('#authors_0_name', book.author);
    await setV('#authors_0_name_kana', book.author_kana);
    await setV('#book_copyright', `© ${book.author}`);
    await setV(
      '#book_catchphrase',
      (book.subtitle || descText.split('\n')[0] || '').slice(0, 40),
    );
    await setV('#book_description', descText.slice(0, 800));
    // BW 検索キーワードは 100 文字以下必須 (2026-09-02 実測) — 収まるだけ詰める。
    let kwStr = '';
    for (const k of book.keywords ?? []) {
      const nx = kwStr ? `${kwStr} ${k}` : k;
      if (nx.length > 100) break;
      kwStr = nx;
    }
    await setV('#book_keywords', kwStr);
    await setV('#book_price_notax', String(book.price_notax));

    // --- ファイル (表紙 JPG / 販売用 EPUB / 試し読み EPUB — 3 点必須) ---
    await page.setInputFiles('#book_files_cover', book.coverJpgPath);
    await page.setInputFiles('#book_files_epub', book.epubPath);
    await page.setInputFiles('#book_files_epub_trial', book.trialEpubPath);
    await page.waitForTimeout(4000);

    // --- カテゴリ (トップ→サブをラベルテキストでクリック。ラジオは synthetic click で可) ---
    const cat = bwCategory(book.genre, book.title);
    const catPicked = await page.evaluate((c: { top: string; sub: string | null }) => {
      const out: string[] = [];
      const clickByText = (t: string) => {
        const el = [...document.querySelectorAll('label,button,[role=radio],[role=button],a,span')].find(
          (x) =>
            (x.textContent || '').replace(/\s+/g, '').trim() === t.replace(/\s+/g, '') &&
            ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
        ) as HTMLElement | undefined;
        if (el) {
          el.click();
          return true;
        }
        return false;
      };
      if (clickByText(c.top)) out.push('top:' + c.top);
      if (c.sub && clickByText(c.sub)) out.push('sub:' + c.sub);
      return out;
    }, cat);
    log.info({ book_id: book.id, catPicked, kwLen: kwStr.length }, '基本情報+ファイル入力完了');
    await page.waitForTimeout(2000);
    await shot('filled');

    // EPUB のサーバ側検証待ち (固定 40 秒。本文 grep は注意書きで誤検知するため使わない)。
    await page.waitForTimeout(40_000);

    if (dryRun) {
      await page.click('#save-book', { noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(6000);
      await shot('draft-saved');
      return finish({ ok: true, status: 'dry_run_ready', storageState: '' });
    }

    // --- 販売申請 (2 段階の信頼済みクリック) ---
    page.on('dialog', (d) => {
      d.accept().catch(() => {});
    });
    let createResp: { status: number; url: string } | null = null;
    page.on('response', (r) => {
      const u = r.url();
      const m = r.request().method();
      if (
        m !== 'GET' &&
        /author\.bookwalker\.jp/.test(u) &&
        !/invite_code|percent_scrolled|\.(js|css|png|jpg|gif|woff)/.test(u)
      ) {
        createResp = { status: r.status(), url: u.replace('https://author.bookwalker.jp', '') };
        log.info({ status: r.status(), url: createResp.url.slice(0, 60) }, '申請POST捕捉');
      }
    });

    await clearOverlays(page);
    await page
      .$('#register-book')
      .then((b) => b?.scrollIntoViewIfNeeded())
      .catch(() => {});
    await page.waitForTimeout(1200);
    let clicked = false;
    for (let a = 0; a < 3 && !clicked; a++) {
      await clearOverlays(page);
      try {
        await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 });
        clicked = true;
      } catch {
        await page.waitForTimeout(1500);
      }
    }
    if (!clicked) {
      await shot('register-click-failed');
      return finish({ ok: false, reason: 'error', message: '申請ボタンをクリックできませんでした' });
    }

    // 確認モーダルの出現をポーリング → 2 段目を信頼済みクリック。
    const modalBtn = page
      .locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button, .pure-button')
      .filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ });
    let modalClicked = false;
    for (let m = 0; m < 9 && !modalClicked; m++) {
      await page.waitForTimeout(2000);
      if (createResp) break;
      const cnt = await modalBtn.count().catch(() => 0);
      if (cnt) {
        await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
        modalClicked = true;
        await page.waitForTimeout(3000);
      }
    }
    // モーダル未検知 & POST 無し = EPUB サーバ検証が未完了のことが多い → 追加待機して再クリック。
    for (let r = 0; r < 2 && !createResp && !modalClicked; r++) {
      await page.waitForTimeout(20_000);
      await clearOverlays(page);
      await page.click('#register-book', { noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
      for (let m = 0; m < 6 && !modalClicked; m++) {
        await page.waitForTimeout(2000);
        if (createResp) break;
        const cnt2 = await modalBtn.count().catch(() => 0);
        if (cnt2) {
          await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
          modalClicked = true;
          await page.waitForTimeout(3000);
        }
      }
    }
    await page.waitForTimeout(5000);

    const errs = await inlineErrors(page);
    const resp = createResp as { status: number; url: string } | null;
    await shot('submitted');
    if (errs.length > 0) {
      return finish({
        ok: false,
        reason: 'validation',
        message: `バリデーションエラー: ${errs.join(' / ').slice(0, 200)}`,
      });
    }
    if (resp && resp.status >= 200 && resp.status < 400) {
      return finish({ ok: true, status: 'submitted', storageState: '' });
    }
    return finish({
      ok: false,
      reason: 'uncertain',
      message: `申請POST未確認 (resp=${resp ? `${resp.status} ${resp.url.slice(0, 50)}` : 'none'})`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    log.warn({ book_id: book.id, err_message: msg, url: page.url().slice(0, 90) }, 'submitOne caught error');
    await shot('error');
    return finish({ ok: false, reason: 'error', message: msg });
  }
}
