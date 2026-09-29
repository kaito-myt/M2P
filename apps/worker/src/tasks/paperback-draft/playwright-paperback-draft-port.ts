/**
 * ペーパーバックの**下書き作成**をサーバー側 (Railway) で実行する Playwright ポート (F-097f)。
 *
 * 運営者指示 (2026-09-29)「ペーパーバックの下書き作成についてもローカルではなくてサーバー側で
 * やってって言ったよね？基本すべての作業をサーバー側でやってほしいのですよ」。
 * ローカル専用だった `scripts/paperback/pb-pilot.mjs` の実績フローをそのまま移植する
 * （出版側の `paperback-submit/playwright-paperback-port.ts` と同じ土俵に載せる）。
 *
 * 違いは 2 点だけ:
 *   - 永続 Chrome プロファイル (`scripts/.kdp-userdata`, headless:false) ではなく
 *     **storageState + パスワード/TOTP 再認証**を使う（出版側で実績がある）。
 *   - 画面ダンプの代わりに、失敗時だけ R2 `debug/paperback-draft/` にスクショを残す。
 *
 * フロー (すべて実測ベース。日付は実地確認日):
 *   0. 本棚で ASIN を検索し、その行の「ペーパーバックの作成」を押す
 *      (行を特定できないときは**押さない**。先頭行フォールバックは他書籍の PB を作る事故 2026-09-03)
 *   1. カテゴリー (必須・Kindle から引き継がれない) を kdp_metadata のカテゴリから流用
 *   2. 「保存して続行」→ content へ
 *   3. 無料 KDP ISBN を取得 → 印刷オプション (BW_WHITE / 裁ち落としなし / MATTE / 左→右)
 *      → 判型 A5 (148×210) → 原稿 PDF と表紙 PDF をアップロード → 変換完了を待つ
 *      → AI コンテンツ質問は「いいえ」(運営者方針)
 *   4. URL から titleId を取り出して返す（**出版はしない**。承認と出版は paperback.submit の仕事）
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。
 */
import { createLogger } from '@a2p/contracts/logger';

import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

const log = createLogger('worker.paperback-draft.playwright');

const BASE = 'https://kdp.amazon.co.jp';
/** KDP の作成数上限モーダル。出たら即座に打ち切る（叩き続けても無駄なので）。 */
const CREATION_LIMIT_RE = /本の作成数制限|本の作成数上限|提出可能な本の数を超え/;

/**
 * Kindle のカテゴリ木のトップ → ペーパーバックのカテゴリ木のトップ対応表。
 * 紙書籍は独自分類なので、そのままでは一致しない（2026-09-03 実測）。
 */
const PB_TOP_MAP: Record<string, string> = {
  '健康・フィットネス': '暮らし・健康・子育て',
  自己啓発: '人文・思想',
  'ビジネス・経済': 'ビジネス・経済',
  '投資・金融': '投資・金融・会社経営',
  '文学・評論': '文学・評論',
  ライトノベル: 'コミック・ラノベ・BL',
  '趣味・実用': '趣味・実用',
  スポーツ: 'スポーツ・アウトドア',
  '教育・学参': '教育・学参・受験',
};

export interface PaperbackDraftArgs {
  /** ログ用。 */
  bookId: string;
  /** 本棚で行を特定するための Kindle 版 ASIN。 */
  asin: string;
  /** Kindle のカテゴリパス (「Kindle本 > ... 」形式)。最大 3 本流用する。 */
  categoryPaths: string[];
  /** 本文 PDF のローカルパス。 */
  interiorPath: string;
  /** ラップカバー PDF のローカルパス。 */
  coverPath: string;
  /** 復号済み storageState (JSON 文字列)。 */
  sessionState: string;
  /** 再認証の 1 段目 (メールアドレス入力) 用。 */
  email?: string | null;
  password: string;
  totpSecret?: string | null;
}

export type PaperbackDraftResult =
  | { ok: true; titleId: string; isbn: string | null }
  | {
      ok: false;
      reason:
        | 'not_logged_in'
        | 'reauth_failed'
        | 'creation_limit'
        | 'no_create_button'
        | 'step1_error'
        | 'no_title_id'
        | 'upload_failed'
        | 'error';
      message: string;
    };

export interface PaperbackDraftPort {
  createDraft(args: PaperbackDraftArgs): Promise<PaperbackDraftResult>;
}

export function createPlaywrightPaperbackDraftPort(): PaperbackDraftPort {
  return { createDraft };
}

/** Kindle のカテゴリパスから、ペーパーバック用のセグメント列を作る。 */
export function toPaperbackCategorySegments(categoryPaths: readonly string[]): string[][] {
  return categoryPaths
    .slice(0, 3)
    .map((p) => {
      const segs = String(p)
        .split('>')
        .map((s) => s.trim())
        .filter(Boolean);
      const i = segs.findIndex((x) => x.replace(/\s/g, '') === 'Kindle本');
      const raw = i >= 0 ? segs.slice(i + 1) : segs;
      if (raw.length === 0) return [];
      return [PB_TOP_MAP[raw[0]!] ?? raw[0]!, ...raw.slice(1)];
    })
    .filter((l) => l.length > 0);
}

/** URL から print-setup の titleId を取り出す。 */
export function extractTitleId(url: string): string | null {
  const m = /print-setup\/paperback\/([A-Z0-9]+)/i.exec(url);
  return m ? m[1]! : null;
}

async function createDraft(args: PaperbackDraftArgs): Promise<PaperbackDraftResult> {
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
      void d.accept().catch(() => {});
    });

    const shot = async (name: string): Promise<void> => {
      let buf: Buffer | null = null;
      try {
        buf = await page.screenshot({ fullPage: true });
      } catch {
        return;
      }
      if (!buf) return;
      try {
        const mod = await import('@a2p/storage');
        const key = `debug/paperback-draft/${args.bookId}-${name}-${String(Date.now())}.png`;
        await mod.uploadBuffer(key, buf, 'image/png');
        log.info({ key }, 'saved paperback-draft debug shot');
      } catch {
        /* best-effort */
      }
    };

    /**
     * 再認証ウォール (max_auth_age=0) を通す。
     *
     * 本棚 (`/ja_JP/bookshelf`) から入ると、パスワードだけの壁ではなく
     * **メールアドレス入力から始まる 2 段のサインイン**になることがある
     * (2026-09-29 実測。`print-setup` 直行の出版側では出ない)。1 段目が出たら先に通す。
     */
    const passReauth = async (label: string): Promise<boolean> => {
      if (!/\/ap\/signin/.test(page.url())) return true;
      log.info({ label, bookId: args.bookId }, 'kdp reauth wall');
      try {
        // 1 段目: メールアドレス (パスワード欄がまだ無い場合のみ)。
        const hasPassword = await page.$('#ap_password').catch(() => null);
        if (!hasPassword) {
          const ef = await page.$('#ap_email, #ap_email_login, input[type=email][name=email]').catch(() => null);
          if (ef && args.email) {
            await ef.click({ force: true }).catch(() => {});
            await ef.fill('').catch(() => {});
            await ef.type(args.email, { delay: 30 });
            await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => null),
              page
                .click('#continue, input#continue, #continue-announce')
                .catch(() => page.keyboard.press('Enter').catch(() => {})),
            ]);
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(4000);
          } else if (!ef) {
            log.warn({ label }, 'サインイン画面だがメール欄もパスワード欄も見つかりません');
          }
        }

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

    /**
     * 作成数上限モーダルの検出。**可視のリーフ要素に限定**する
     * (隠しテンプレの文言で誤検知した実績があるため — 2026-09-02)。
     */
    const hitCreationLimit = async (): Promise<boolean> => {
      return page
        .evaluate((src: string) => {
          const re = new RegExp(src);
          return [...document.querySelectorAll('*')].some(
            (el) =>
              ((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight) &&
              el.children.length === 0 &&
              re.test(el.textContent ?? ''),
          );
        }, CREATION_LIMIT_RE.source)
        .catch(() => false);
    };

    // --- STEP0: 本棚 → 「ペーパーバックの作成」 ---
    await page.goto(`${BASE}/ja_JP/bookshelf`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    if (!(await passReauth('bookshelf'))) {
      await shot('reauth-failed');
      return { ok: false, reason: 'reauth_failed', message: '本棚で再認証できませんでした' };
    }
    if (/signin/i.test(page.url())) {
      return { ok: false, reason: 'not_logged_in', message: `未ログイン (url=${page.url().slice(0, 90)})` };
    }

    const searchBox = await page
      .$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]')
      .catch(() => null);
    if (searchBox) {
      await searchBox.fill(args.asin).catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(5000);
    }

    const clicked = await page
      .evaluate((asin: string) => {
        const cands = [...document.querySelectorAll('a,button,span[role=button]')].filter((el) =>
          /ペーパーバックの作成/.test(el.textContent ?? ''),
        );
        for (const el of cands) {
          let row: HTMLElement | null = el as HTMLElement;
          for (let i = 0; i < 14 && row; i += 1) {
            row = row.parentElement;
            if ((row?.textContent ?? '').includes(asin)) break;
          }
          if ((row?.textContent ?? '').includes(asin) || cands.length === 1) {
            (el as HTMLElement).click();
            return true;
          }
        }
        // ASIN 行を特定できないときは押さない (他書籍の PB を作る事故を防ぐ — 2026-09-03)。
        return false;
      }, args.asin)
      .catch(() => false);
    if (!clicked) {
      await shot('no-create-button');
      return {
        ok: false,
        reason: 'no_create_button',
        message: `本棚で ASIN=${args.asin} の「ペーパーバックの作成」を特定できませんでした`,
      };
    }
    await page.waitForTimeout(9000);
    if (await hitCreationLimit()) {
      await shot('creation-limit');
      return { ok: false, reason: 'creation_limit', message: 'KDP の本の作成数上限に達しています' };
    }

    // --- STEP1a: カテゴリー (必須) ---
    const segLists = toPaperbackCategorySegments(args.categoryPaths);
    const lists = segLists.length > 0 ? segLists : [['趣味・実用']];
    const catBtn = await page.$('#categories-modal-button').catch(() => null);
    if (catBtn) {
      await catBtn.click().catch(() => {});
      await page.waitForTimeout(3500);
      const SCOPE = '[role=dialog], .a-popover:not([style*="display: none"]), .a-modal-scroller';

      /** モーダル内の未選択 select に、セグメント名でファジー選択する。 */
      const fuzzyPick = async (seg: string): Promise<{ picked?: string; err?: string }> => {
        for (let a = 0; a < 4; a += 1) {
          const res = await page
            .evaluate(
              ({ scope, target }: { scope: string; target: string }) => {
                const dlg =
                  document.querySelector(scope.split(',')[0]!.trim()) ??
                  document.querySelector('.a-popover:not([style*="display: none"])') ??
                  document.querySelector('.a-modal-scroller');
                if (!dlg) return { err: 'no-dialog' };
                const sels = [...dlg.querySelectorAll('select')].filter(
                  (s) => (s as HTMLElement).offsetWidth || (s as HTMLElement).offsetHeight,
                ) as HTMLSelectElement[];
                const score = (opt: string): number => {
                  const t = opt.trim();
                  if (!t || /^1 つ選択/.test(t)) return -1;
                  if (t === target) return 100;
                  if (t.includes(target) || target.includes(t)) return 80;
                  let ov = 0;
                  for (const ch of new Set(target)) if (t.includes(ch)) ov += 1;
                  return (ov / Math.max(3, target.length)) * 60;
                };
                for (const s of sels) {
                  const cur = s.options[s.selectedIndex]?.textContent?.trim() ?? '';
                  if (cur && !/^1 つ選択/.test(cur)) continue;
                  let best: { sc: number; label: string; value: string } | null = null;
                  for (const o of s.options) {
                    const sc = score(o.textContent ?? '');
                    if (sc > 20 && (!best || sc > best.sc)) {
                      best = { sc, label: (o.textContent ?? '').trim(), value: o.value };
                    }
                  }
                  if (best) {
                    s.value = best.value;
                    s.dispatchEvent(new Event('change', { bubbles: true }));
                    return { picked: best.label };
                  }
                  return { err: 'no-option-for:' + target };
                }
                return { err: 'no-open-select' };
              },
              { scope: SCOPE, target: seg },
            )
            .catch(() => ({ err: 'evaluate-failed' }));
          if (res.picked) {
            await page.waitForTimeout(1800);
            return res;
          }
          if (res.err === 'no-open-select' || res.err?.startsWith('no-option')) return res;
          await page.waitForTimeout(900);
        }
        return { err: 'timeout' };
      };

      for (let ci = 0; ci < lists.length; ci += 1) {
        if (ci > 0) {
          await page.click('button:has-text("別のカテゴリーを追加")').catch(() => {});
          await page.waitForTimeout(2000);
        }
        const mapped = lists[ci]!;
        for (const seg of mapped) {
          const r = await fuzzyPick(seg);
          if (r.err === 'no-open-select') break;
        }
        // 追加で開いた select が残っていれば末尾セグメントで降りる (最大 3 段)。
        for (let d = 0; d < 3; d += 1) {
          const r = await fuzzyPick(mapped[mapped.length - 1]!);
          if (!r.picked) break;
        }
        // 葉のチェックボックスを 1 つ入れる。
        await page
          .evaluate((scope: string) => {
            const dlg =
              document.querySelector(scope.split(',')[0]!.trim()) ??
              document.querySelector('.a-popover:not([style*="display: none"])') ??
              document.querySelector('.a-modal-scroller');
            if (!dlg) return false;
            const boxes = [...dlg.querySelectorAll('input[type=checkbox]')].filter(
              (c) => ((c as HTMLElement).offsetWidth || (c as HTMLElement).offsetHeight) && !(c as HTMLInputElement).checked,
            );
            if (boxes.length === 0) return false;
            (boxes[0] as HTMLElement).click();
            return true;
          }, SCOPE)
          .catch(() => false);
        await page.waitForTimeout(1200);
      }
      const savedCount = await page
        .evaluate((scope: string) => {
          const dlg =
            document.querySelector(scope.split(',')[0]!.trim()) ??
            document.querySelector('.a-popover:not([style*="display: none"])');
          const cnt = /(\d+) 個のカテゴリーを選択済み/.exec(dlg?.textContent ?? '')?.[1];
          const b = [...(dlg ?? document).querySelectorAll('button')].find((x) =>
            /カテゴリーを保存/.test(x.textContent ?? ''),
          );
          if (b) (b as HTMLElement).click();
          return cnt ?? '?';
        }, SCOPE)
        .catch(() => '?');
      log.info({ bookId: args.bookId, savedCount }, 'paperback categories saved');
      await page.waitForTimeout(3000);
    }

    // --- STEP1: 保存して続行 ---
    await page.click('#save-and-continue-announce').catch(() => {});
    await page.waitForTimeout(12000);
    if (await hitCreationLimit()) {
      await shot('creation-limit-step1');
      return { ok: false, reason: 'creation_limit', message: 'KDP の本の作成数上限に達しています' };
    }
    if (/\/details/.test(page.url())) {
      const errs: string[] = await page
        .evaluate(() =>
          [...document.querySelectorAll('.a-alert-error,.a-box-inner .a-alert-container')]
            .filter((x) => (x as HTMLElement).offsetParent !== null)
            .map((x) => (x.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200))
            .filter((t) => t && !/placeholder/.test(t)),
        )
        .catch(() => []);
      if (errs.length > 0) {
        await shot('step1-error');
        return { ok: false, reason: 'step1_error', message: `詳細ページでエラー: ${errs.join(' / ').slice(0, 200)}` };
      }
      await page.waitForTimeout(8000);
    }
    await passReauth('after-step1');

    const titleId = extractTitleId(page.url());
    if (!titleId) {
      await shot('no-title-id');
      return { ok: false, reason: 'no_title_id', message: `titleId を取得できません (url=${page.url().slice(0, 110)})` };
    }
    log.info({ bookId: args.bookId, titleId }, 'paperback draft created');

    // --- STEP2: ISBN / 印刷オプション / 判型 / アップロード ---
    const isbnClicked = await page
      .evaluate(() => {
        const b = [...document.querySelectorAll('button, input[type=button]')].find((x) =>
          /無料.*ISBN|ISBN.*取得/.test(x.textContent ?? (x as HTMLInputElement).value ?? ''),
        );
        if (!b) return false;
        (b as HTMLElement).click();
        return true;
      })
      .catch(() => false);
    if (isbnClicked) {
      await page.waitForTimeout(4000);
      await page
        .locator('[role=dialog] button, [aria-modal="true"] button')
        .filter({ hasText: /割り当て|取得|確認|はい|OK/ })
        .first()
        .click({ timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(5000);
      // overlay の残骸は以降のクリックを遮るので Escape で掃除する。
      for (let k = 0; k < 2; k += 1) {
        const still = await page
          .evaluate(() =>
            [...document.querySelectorAll('[role=dialog], [aria-modal="true"]')].some(
              (d) => (d as HTMLElement).offsetWidth || (d as HTMLElement).offsetHeight,
            ),
          )
          .catch(() => false);
        if (!still) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    const isbn: string | null = await page
      .evaluate(() => /97[89][-\d]{10,14}/.exec(document.body.textContent ?? '')?.[0] ?? null)
      .catch(() => null);

    // 既定値が全て正解だが (2026-09 実測)、明示的に担保する。
    for (const sel of ['#ink-paper-BW_WHITE', '#bleed-no', '#cover-finish-MATTE', '#page-turn-direction-left-to-right']) {
      await page.check(sel, { force: true }).catch(() => {});
    }

    // 判型 A5 (148×210)。UI が role=button のことがあるので広く探す。
    const trimOpened = await page
      .evaluate(() => {
        const c = [...document.querySelectorAll('button,[role=button],a')].find(
          (x) => /判型/.test(x.textContent ?? '') && ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
        );
        if (!c) return false;
        (c as HTMLElement).click();
        return true;
      })
      .catch(() => false);
    if (trimOpened) {
      await page.waitForTimeout(3000);
      await page
        .evaluate(() => {
          const c = [...document.querySelectorAll('[role=dialog] *, .a-popover *')].find(
            (x) =>
              /148\s*(mm)?\s*[x×]\s*210|A5/.test(x.textContent ?? '') &&
              x.children.length <= 1 &&
              ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
          );
          if (c) (c as HTMLElement).click();
        })
        .catch(() => {});
      await page.waitForTimeout(1500);
      await page
        .evaluate(() => {
          const b = [...document.querySelectorAll('[role=dialog] button, .a-popover button')].find((x) =>
            /選択|適用|OK|保存|更新/.test(x.textContent ?? ''),
          );
          if (b) (b as HTMLElement).click();
        })
        .catch(() => {});
      await page.waitForTimeout(3000);
    }

    /** 「原稿/表紙をアップロード」ボタン → filechooser。取れないときは隠し input に直投入。 */
    const uploadVia = async (labelRe: string, file: string, fallbackIdx: number): Promise<boolean> => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
      const handle = await page
        .evaluateHandle(
          (re: string) =>
            [...document.querySelectorAll('button,[role=button]')].find(
              (x) =>
                new RegExp(re).test(x.textContent ?? '') &&
                ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
            ) ?? null,
          labelRe,
        )
        .catch(() => null);
      const el = handle ? handle.asElement() : null;
      if (!el) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > fallbackIdx) {
          await inputs[fallbackIdx].setInputFiles(file).catch(() => {});
          return true;
        }
        return false;
      }
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
        el.click({ timeout: 15000 }).catch(() => {}),
      ]);
      if (!fc) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > fallbackIdx) {
          await inputs[fallbackIdx].setInputFiles(file).catch(() => {});
          return true;
        }
        return false;
      }
      await fc.setFiles(file);
      return true;
    };

    const interiorOk = await uploadVia('原稿をアップロード', args.interiorPath, 0);
    await page.waitForTimeout(4000);
    const coverOk = await uploadVia('表紙ファイルをアップロード', args.coverPath, 1);
    if (!interiorOk || !coverOk) {
      await shot('upload-button-missing');
      return {
        ok: false,
        reason: 'upload_failed',
        message: `アップロードボタンが見つかりません (原稿=${String(interiorOk)} 表紙=${String(coverOk)})`,
      };
    }

    // 変換待ち (最大 12 分)。
    let uploadedBoth = false;
    for (let i = 0; i < 72; i += 1) {
      await page.waitForTimeout(10000);
      const t: string = await page.evaluate(() => document.body.textContent ?? '').catch(() => '');
      const ok = (t.match(/正常にアップロードしました|アップロードに成功|処理が完了しました/g) ?? []).length;
      if (/アップロードで問題|アップロードに失敗|エラーが発生|問題が見つかりました/.test(t)) {
        await shot('upload-error');
        return { ok: false, reason: 'upload_failed', message: 'KDP がアップロードの問題を報告しました' };
      }
      if (ok >= 2) {
        uploadedBoth = true;
        break;
      }
    }
    log.info({ bookId: args.bookId, titleId, uploadedBoth, isbn }, 'paperback draft uploads done');

    // AI コンテンツ質問は「いいえ」(Kindle 版と同じ運営者方針)。
    await page.check('input[name="has-ai-content"][value="no"]', { force: true }).catch(() => {});
    // 下書きとして保存して抜ける (**出版はしない**)。
    await page
      .evaluate(() => {
        const b = [...document.querySelectorAll('button,[role=button]')].find((x) =>
          /下書きとして保存|下書きを保存/.test(x.textContent ?? ''),
        );
        if (b) (b as HTMLElement).click();
      })
      .catch(() => {});
    await page.waitForTimeout(8000);

    return { ok: true, titleId, isbn };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
