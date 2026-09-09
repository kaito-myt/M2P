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

/** 本棚の1書籍(著者センター側)。bwId は BW 内部ID、status は表示ステータス。 */
export interface BwShelfEntry {
  bwId: string;
  title: string;
  status: '申請中' | '却下' | '販売中' | '取り下げ';
}

export interface BwRetagArgs {
  /** BW 内部の書籍ID (本棚から取得)。 */
  bwId: string;
  /** 申請中なら true で先に取り下げ (却下/取り下げ済なら false)。 */
  withdraw: boolean;
  book: BwBookInput;
  sessionState: string;
  stageDir: string;
}

export type BwRetagResult =
  | { ok: true; status: 'reapplied'; storageState: string }
  | {
      ok: false;
      // rate_limited = 当日申請枠(~3件)超過(HTTP 403)。呼び出し側は当日停止する。
      reason: 'not_logged_in' | 'rate_limited' | 'validation' | 'uncertain' | 'error';
      message: string;
      storageState?: string;
    };

export interface BwSubmitPort {
  submitOne(args: BwSubmitArgs): Promise<BwSubmitResult>;
  /** 著者センター本棚を全ページ走査して書籍一覧を返す。 */
  enumerateShelf(sessionState: string): Promise<BwShelfEntry[]>;
  /** 既存書籍を編集導線で再申請 (AI生成付与+内容紹介整形+クリーンEPUB再アップ)。 */
  retagOne(args: BwRetagArgs): Promise<BwRetagResult>;
}

export function createPlaywrightBwSubmitPort(): BwSubmitPort {
  return { submitOne, enumerateShelf, retagOne };
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

/**
 * 内容紹介を、フィールド maxlength(0=無制限)を超えず、かつ**必ず文末で終わる**ように整える。
 * BW は「内容紹介が途中で途切れている」を却下理由にするため、maxlength 内に文末が無い場合は
 * 段落/読点で妥協せず、句点(。！？)や閉じ括弧までのプレフィックスに丸める。
 */
export function fitToSentence(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (!t) return '';
  const limit = maxLen && maxLen > 0 ? maxLen : t.length;
  // 全文が収まり、かつ末尾が文末で終わっていればそのまま。
  if (t.length <= limit && /[。！？」』】）)]$/.test(t)) return t;
  const head = t.slice(0, limit);
  // limit 内の「最後の文末文字」で切る(句点・感嘆・疑問・閉じ括弧)。
  let idx = -1;
  for (const ch of ['。', '！', '？', '」', '』', '】']) idx = Math.max(idx, head.lastIndexOf(ch));
  if (idx > 0) return head.slice(0, idx + 1).trim();
  // 文末文字が全く無ければ切る材料が無いのでそのまま(先頭 limit)。
  return head.trim();
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
  // 本番 worker は tsx(esbuild keepNames)実行 — evaluate コールバック内のネスト関数が
  // __name(...) でラップされブラウザ側に __name が無く ReferenceError で落ちる(2026-08 KDP で実害)。
  // 全ナビの主コンテキストに no-op シムを注入して回避する。
  await ctx.addInitScript({
    content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
  });
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
    // 内容紹介: フィールド maxlength を尊重し、必ず文末(。！？」』)で切る。
    // (却下理由② = 内容紹介が途中で途切れている → 中途半端な切断を禁止)。
    const descFitted = fitToSentence(
      descText,
      await page
        .$eval('#book_description', (el) => Number((el as HTMLTextAreaElement).maxLength) || 0)
        .catch(() => 0),
    );
    await setV('#book_description', descFitted);
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
    // サブカテゴリを描画させてから「AI生成」を必ずチェック(却下理由① — AI作品は必須)。
    // book_sub_category value=7497(全メインカテゴリ共通)。ラベルクリック + 直接 check の二段で確実に。
    await page.waitForTimeout(1500);
    const aiTag = await page
      .evaluate(() => {
        const boxes = [...document.querySelectorAll('input.book_sub_category[value="7497"]')] as HTMLInputElement[];
        let done = false;
        for (const b of boxes) {
          if (!b.checked) {
            (b.closest('label') as HTMLElement | null)?.click();
            if (!b.checked) {
              b.checked = true;
              b.dispatchEvent(new Event('change', { bubbles: true }));
              b.dispatchEvent(new Event('click', { bubbles: true }));
            }
          }
          if (b.checked) done = true;
        }
        return { found: boxes.length, checked: done };
      })
      .catch(() => ({ found: 0, checked: false }));
    log.info({ book_id: book.id, catPicked, aiTag, kwLen: kwStr.length }, '基本情報+ファイル入力完了');
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

// ---------------------------------------------------------------------------
// 本棚列挙 / 再申請 (却下理由①② 恒久対応)
// ---------------------------------------------------------------------------

const SHELF_URL = 'https://author.bookwalker.jp/library/bookshelf';

async function openCtx(sessionState: string) {
  const storageStateJson = JSON.parse(sessionState) as BrowserContextOptions['storageState'];
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const ctx = await browser.newContext({
    storageState: storageStateJson,
    userAgent: UA,
    locale: 'ja-JP',
    viewport: { width: 1400, height: 1600 },
  });
  ctx.setDefaultTimeout(60_000);
  await ctx.addInitScript({
    content: 'globalThis.__name = globalThis.__name || function (f) { return f; };',
  });
  return { browser, ctx };
}

async function enumerateShelf(sessionState: string): Promise<BwShelfEntry[]> {
  const { browser, ctx } = await openCtx(sessionState);
  const page = await ctx.newPage();
  const byId = new Map<string, BwShelfEntry>();
  try {
    for (let p = 1; p <= 15; p++) {
      await page.goto(`${SHELF_URL}?page=${p}`, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      if (p === 1 && (!/bookshelf/.test(page.url()) || (await page.$('input[type=password]')))) break;
      const rows = await page
        .evaluate(() => {
          const out: Array<{ id: string; title: string; status: string }> = [];
          const seed = document.querySelectorAll('a.js-booksample[data-url],a.js-bookviewer[data-url]');
          for (const el of seed) {
            const id = ((el.getAttribute('data-url') || '').match(/\/books\/(\d+)/) || [])[1];
            if (!id) continue;
            let box: HTMLElement | null = el as HTMLElement;
            for (let i = 0; i < 7 && box?.parentElement; i++) {
              box = box.parentElement;
              if (/円（税別）/.test(box.textContent || '')) break;
            }
            const t = (box?.textContent || '').replace(/\s+/g, ' ').trim();
            const drop = box?.querySelector('a.js-bookdrop') as HTMLElement | null;
            const title =
              drop?.getAttribute('data-title') || (t.match(/^(.*?)\s*宮田海斗/) || [])[1] || t.slice(0, 44);
            let status = '取り下げ';
            if (drop) status = '申請中';
            else if (/申請が却下されました/.test(t)) status = '却下';
            else if (/予約受付中|発売日|販売中/.test(t)) status = '販売中';
            out.push({ id, title: title.slice(0, 60), status });
          }
          return out;
        })
        .catch(() => [] as Array<{ id: string; title: string; status: string }>);
      if (rows.length === 0) break;
      for (const r of rows) {
        if (!byId.has(r.id)) byId.set(r.id, { bwId: r.id, title: r.title, status: r.status as BwShelfEntry['status'] });
      }
      const hasNext = await page
        .evaluate((cur: number) => !![...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === String(cur + 1)), p)
        .catch(() => false);
      if (!hasNext) break;
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return [...byId.values()];
}

async function retagOne(args: BwRetagArgs): Promise<BwRetagResult> {
  const { bwId, withdraw, book, stageDir } = args;
  const { browser, ctx } = await openCtx(args.sessionState);
  const page = await ctx.newPage();
  const shot = (n: string) =>
    page.screenshot({ path: path.join(stageDir, `retag-${bwId}-${n}.png`), fullPage: true }).catch(() => {});
  const finish = async <T extends BwRetagResult>(result: T): Promise<T> => {
    try {
      (result as { storageState?: string }).storageState = JSON.stringify(await ctx.storageState());
    } catch {
      /* ignore */
    }
    await browser.close().catch(() => {});
    return result;
  };
  page.on('dialog', (d) => {
    d.accept().catch(() => {});
  });
  try {
    // 1) 申請中なら取り下げ (POST /api/books/drop、CSRF不要・セッションcookie依存)。
    if (withdraw) {
      await page.goto(SHELF_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(3000);
      if (await page.$('input[type=password]')) {
        return finish({ ok: false, reason: 'not_logged_in', message: 'セッション失効 (bw-session-push.mjs 再実行)' });
      }
      const dropStatus = await page
        .evaluate(async (id: string) => {
          const r = await fetch('/api/books/drop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
            body: 'book_id=' + id,
            credentials: 'include',
          }).catch(() => null);
          return r ? r.status : 0;
        }, bwId)
        .catch(() => 0);
      log.info({ bwId, dropStatus }, 'bw retag: 取り下げ');
      await page.waitForTimeout(1500);
    }

    // 2) 編集画面へ
    await page.goto(`https://author.bookwalker.jp/books/${bwId}/edit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    await clearOverlays(page);
    if (!/\/edit/.test(page.url()) || (await page.$('input[type=password]'))) {
      await shot('no-edit');
      return finish({ ok: false, reason: 'not_logged_in', message: `編集画面に入れず (url=${page.url().slice(0, 80)})` });
    }

    // 3) 内容紹介を文末整形で再セット
    const descText = String(book.description || '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    const maxLen = await page.$eval('#book_description', (el) => Number((el as HTMLTextAreaElement).maxLength) || 0).catch(() => 0);
    const descFit = fitToSentence(descText, maxLen);
    if (descFit) {
      const d = await page.$('#book_description');
      if (d) {
        await d.click().catch(() => {});
        await d.fill(descFit).catch(() => {});
      }
    }

    // 4) クリーンEPUB (販売用/試し読み) + 表紙を再アップ
    await page.setInputFiles('#book_files_cover', book.coverJpgPath).catch(() => {});
    await page.setInputFiles('#book_files_epub', book.epubPath).catch(() => {});
    await page.setInputFiles('#book_files_epub_trial', book.trialEpubPath).catch(() => {});
    await page.waitForTimeout(4000);

    // 5) AI生成 サブカテゴリを必須チェック。編集画面はメインカテゴリ再クリックでサブ枠が展開する。
    //    value=7497 はカテゴリ毎に複数あるが、保存に効くのは可視の1個のみ。可視ラベルを実クリック。
    const top = bwCategory(book.genre, book.title).top;
    await page.locator('label', { hasText: top }).first().click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    const labels = page.locator('label.pure-checkbox', { has: page.locator('input.book_sub_category[value="7497"]') });
    const ln = await labels.count().catch(() => 0);
    let aiChecked = false;
    for (let i = 0; i < ln; i++) {
      const el = labels.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const box = el.locator('input.book_sub_category[value="7497"]');
        if (!(await box.isChecked().catch(() => false))) await el.click({ force: true }).catch(() => {});
        aiChecked = await box.isChecked().catch(() => false);
        break;
      }
    }
    log.info({ bwId, aiChecked, descLen: descFit.length }, 'bw retag: AI生成+内容紹介セット');
    await page.waitForTimeout(40_000); // EPUB サーバ検証待ち
    await shot('filled');

    // 6) 再申請 (信頼済み2段クリック)。/api/books/register の HTTP status で 403=当日枠超過 を検出。
    let registerStatus = 0;
    page.on('response', (r) => {
      if (/\/api\/books\/register/.test(r.url())) registerStatus = r.status();
    });
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
    const modalBtn = page
      .locator('[role=dialog] button, .modal button, [class*=modal] button, [class*=Modal] button, .pure-button')
      .filter({ hasText: /^(申請する|はい|OK|同意して|確定|申請)/ });
    for (let m = 0; m < 9; m++) {
      await page.waitForTimeout(2000);
      if (registerStatus) break;
      if (await modalBtn.count().catch(() => 0)) {
        await modalBtn.first().click({ noWaitAfter: true, force: true, timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(3000);
        break;
      }
    }
    await page.waitForTimeout(5000);
    await shot('reapplied');
    if (registerStatus === 403) {
      return finish({ ok: false, reason: 'rate_limited', message: '当日の申請枠(~3件)超過 (register 403)' });
    }
    if (registerStatus >= 200 && registerStatus < 400) {
      return finish({ ok: true, status: 'reapplied', storageState: '' });
    }
    return finish({ ok: false, reason: 'uncertain', message: `再申請POST未確認 (register status=${registerStatus || 'none'})` });
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : String(err);
    log.warn({ bwId, err_message: msg }, 'retagOne caught error');
    await shot('error');
    return finish({ ok: false, reason: 'error', message: msg });
  }
}
