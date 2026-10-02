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

import { checkReuploadConfirms } from '../kdp-submit/playwright-publish-port.js';
import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

const log = createLogger('worker.paperback-submit.playwright');

const BASE = 'https://kdp.amazon.co.jp';
/** content ページに残っていると保存が黙ってブロックされる警告文 (= プレビュー未承認)。 */
const PREVIEW_WARN = '続行する前に、これらの変更をプレビューして確認してください';

/**
 * プレビュー/content ページから拾った文のうち、**エラーではない案内文**。
 *
 * 画面から広く文言を集めるようにした結果 (F-097k)、「表紙 "...pdf" が正常にアップロード
 * されました。」のような**成功通知にも「表紙」が含まれる**ため、これを素通しすると
 * エラーが 1 つも無くても毎回「表紙が不適合」と誤判定して差し替えてしまう (2026-10-02 実測)。
 */
const PREVIEW_INFO_PATTERNS: readonly RegExp[] = [
  /正常にアップロード/,
  /デザインが新しくなりました/,
  /ISBN が割り当てられました/,
  /外部流通機能を利用できません/,
  /新しい原稿または表紙画像をアップロードされたようです/,
  /続行する前に、これらの変更をプレビュー/,
  /原稿、表紙、印刷オプションを更新しました/,
  /印刷コスト/,
];

/** KDP が本当にエラーとして出している文言か。 */
export function isRealPreviewError(text: string): boolean {
  return !PREVIEW_INFO_PATTERNS.some((re) => re.test(text));
}

/** 表紙サイズ不適合を指す文言 (「表紙」を含むだけの案内文と区別する)。 */
export const COVER_SIZE_ERROR = /提出された表紙サイズ|適切な表紙のサイズ|表紙のサイズが適切ではありません/;

/**
 * [F-097e] デバッグ用の画面キャプチャ (R2 `debug/paperback/`)。
 *
 * プレビュー承認が「押せているのに記録されない」(`not_approved`) という症状が続いたが、
 * このポートは何も保存していなかったため原因が分からなかった (2026-09-29)。
 * 各段の画面と、content ページの警告文まわりのテキストを残す。best-effort。
 */
async function shot(page: Page, name: string): Promise<void> {
  let buf: Buffer | null = null;
  try {
    buf = await page.screenshot({ fullPage: true });
  } catch {
    return;
  }
  if (!buf) return;
  try {
    const mod = await import('@a2p/storage');
    const key = `debug/paperback/${name}-${Date.now()}.png`;
    await mod.uploadBuffer(key, buf, 'image/png');
    log.info({ key }, 'saved paperback debug shot');
  } catch {
    /* best-effort */
  }
}

/** content ページのプレビュー警告まわりのテキストを抜き出す (何が出ているかをログに残す)。 */
async function previewStateText(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const t = document.body.innerText || '';
      const i = t.indexOf('プレビュー');
      const around = i >= 0 ? t.slice(Math.max(0, i - 120), i + 260) : t.slice(0, 260);
      const buttons = [...document.querySelectorAll('button,[role=button],a')]
        .map((b) => (b.textContent || '').trim())
        .filter((x) => x.length > 0 && x.length < 24)
        .slice(0, 30);
      return JSON.stringify({ around: around.replace(/\s+/g, ' '), buttons });
    })
    .catch(() => '');
}

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
  /**
   * [F-097g] 正しいラップカバー PDF のローカルパス。プレビューが表紙サイズ不適合を
   * 報告したとき、これを上げ直してから再プレビューする。
   *
   * 古いローカル実行で作られた下書きには **Kindle 用の表紙 (A4 縦) が上がっている**ことがあり、
   * その場合 KDP は「適切な表紙のサイズは 12.000x8.520 ですが、提出されたファイル サイズは
   * 8.264x11.694」と出して**承認ボタンを無効化**する (2026-09-29 実測)。これが
   * `not_approved` の正体だった。
   */
  coverPath?: string | null;
  /**
   * [F-097h] **KDP が数えた頁数**でラップカバーを作り直すコールバック。
   *
   * こちらの PDF の頁数と KDP 変換後の頁数は一致しない (2026-09-30 実測: 手元 137 頁 /
   * KDP のプレビューは 144 頁)。背幅は頁数で決まるので、手元の頁数で作った表紙は
   * KDP から見ると幅が合わず、差し替えても弾かれ続ける。
   */
  buildCoverForPages?: (pages: number) => Promise<string | null>;
  /**
   * [F-097j] 余白を広げたペーパーバック用の本文 PDF。プレビューが
   * 「内側マージンが不十分です」を出したときに上げ直す。
   */
  interiorPath?: string | null;
}

export type PaperbackPublishResult =
  | { ok: true; status: 'submitted' | 'dry_run_ready'; pages: number | null; priceJpy: number | null }
  | {
      ok: false;
      reason:
        | 'reauth_failed'
        | 'no_previewer'
        | 'draft_incomplete'
        | 'not_approved'
        | 'cover_rejected'
        | 'blocked_prior_page'
        | 'no_price_field'
        | 'uncertain'
        | 'error';
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

    /**
     * [F-097g/j] プレビューアーが出しているエラー文を読む。承認ボタンはこのとき無効になる。
     *
     * KDP のプレビューアーは**別フレーム (iframe)** で描画されることがあり、トップ document
     * だけを見ていると本文の余白エラー
     *   「内側マージンが不十分です。152 ページの本では、0.5" (12.700mm) 以上の内側マージンが必要です」
     * を取り逃がす。2026-10-02 まではまさにこれで `マージン` を検出できず、F-097j の
     * **本文差し替えが一度も発火していなかった** (DB に残った理由は毎回 generic な
     * 「エラーのある本は、Amazon の品質基準を満たしません」だけだった)。
     * そのため全フレームを走査する。
     */
    const PREVIEW_ERROR_PATTERNS: readonly string[] = [
      '提出された表紙サイズが[^。]*。',
      '適切な表紙のサイズは[^。]*。',
      '判型が選択されていますが[^。]*。',
      // 本文 (原稿) 側の指摘 — これを拾えないと本文の差し替えが発火しない。
      '内側マージン[^。]*。',
      '外側マージン[^。]*。',
      'マージンが不十分[^。]*。',
      'ページの上下には[^。]*。',
      'エラーのある本は[^。]*。',
    ];

    const previewErrors = async (): Promise<string[]> => {
      const out: string[] = [];
      const push = (raw: string): void => {
        const v = raw.replace(/\s+/g, ' ').trim();
        if (v.length > 6 && v.length < 400 && !out.includes(v)) out.push(v);
      };
      for (const frame of page.frames()) {
        const found = await frame
          .evaluate((sources: readonly string[]) => {
            const txt = document.body?.innerText ?? '';
            const hits: string[] = [];
            for (const src of sources) {
              const re = new RegExp(src, 'g');
              let m: RegExpExecArray | null;
              while ((m = re.exec(txt)) !== null && hits.length < 24) hits.push(m[0]);
            }
            // 決め打ちに当たらない文言のため、エラーボックス本文も拾う。
            const boxes = document.querySelectorAll(
              '[class*="error"], [class*="Error"], [role="alert"]',
            );
            for (const box of [...boxes]) {
              const t = box.textContent ?? '';
              if (t.trim().length > 8) hits.push(t);
            }
            return hits;
          }, PREVIEW_ERROR_PATTERNS)
          .catch(() => [] as string[]);
        for (const t of found) push(t);
        if (out.length >= 12) break;
      }
      return out.slice(0, 12);
    };

    /** 本文ファイルを上げ直す (原稿のアップロードボタン)。 */
    const replaceInterior = async (file: string): Promise<boolean> => {
      await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'replace-interior');
      await page.waitForTimeout(4000);
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
        page
          .evaluate(() => {
            const b = [...document.querySelectorAll('button,[role=button]')].find(
              (x) =>
                /原稿をアップロード|原稿を置き換え|本の原稿をアップロード/.test(x.textContent ?? '') &&
                ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
            );
            if (b) (b as HTMLElement).click();
            return !!b;
          })
          .catch(() => false),
      ]);
      if (!fc) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > 0) await inputs[0].setInputFiles(file).catch(() => {});
        else return false;
      } else {
        await fc.setFiles(file);
      }
      for (let i = 0; i < 90; i += 1) {
        await page.waitForTimeout(10000);
        const t: string = await page.evaluate(() => document.body.textContent ?? '').catch(() => '');
        if (/正常にアップロードしました|アップロードに成功|処理が完了しました/.test(t)) break;
        if (/アップロードで問題|アップロードに失敗/.test(t)) return false;
      }
      // [F-097k] 表紙と同じく、再アップロード後は確認チェックが要る。
      const cfm = await checkReuploadConfirms(page).catch(() => ({ total: 0, checked: 0 }));
      log.info({ titleId, ...cfm }, 'paperback interior replaced');
      return true;
    };

    /** 表紙ファイルだけを上げ直す (content ページ側のアップロードボタンを使う)。 */
    const replaceCover = async (file: string): Promise<boolean> => {
      await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'replace-cover');
      await page.waitForTimeout(4000);
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }).catch(() => null),
        page
          .evaluate(() => {
            const b = [...document.querySelectorAll('button,[role=button]')].find(
              (x) =>
                /表紙ファイルをアップロード|表紙をアップロード|表紙を置き換え/.test(x.textContent ?? '') &&
                ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight),
            );
            if (b) (b as HTMLElement).click();
            return !!b;
          })
          .catch(() => false),
      ]);
      if (!fc) {
        const inputs = await page.$$('input[type=file]').catch(() => []);
        if (inputs.length > 1) {
          await inputs[1].setInputFiles(file).catch(() => {});
        } else {
          log.warn({ titleId }, '表紙アップロードのボタンも input も見つかりません');
          return false;
        }
      } else {
        await fc.setFiles(file);
      }
      // 変換待ち (最大 10 分)。
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(10000);
        const t: string = await page.evaluate(() => document.body.textContent ?? '').catch(() => '');
        if (/正常にアップロードしました|アップロードに成功|処理が完了しました/.test(t)) break;
        if (/アップロードで問題|アップロードに失敗/.test(t)) {
          log.warn({ titleId }, '表紙の再アップロードで KDP がエラーを報告');
          return false;
        }
      }
      // [F-097k] 原稿/表紙を上げ直すと KDP が
      // 「新しい原稿または表紙画像をアップロードされたようです。これをクリックすることで、
      //   自分の回答が正しいことを確認することになります。」の確認チェックを要求する。
      // ON にしないと content が確定せず、価格ページで「以前のページに問題」になる。
      const cfm = await checkReuploadConfirms(page).catch(() => ({ total: 0, checked: 0 }));
      log.info({ titleId, ...cfm }, 'paperback cover replaced');
      return true;
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
      const errs = await previewErrors();
      log.info({ titleId, pages, approved, previewErrors: errs }, 'paperback preview approve clicked');
      await shot(page, `${titleId}-preview-after-approve`);
      lastPreviewErrors = errs;
      // [2026-09-25] 承認直後に終了ボタンを押すと承認が取り消される。押さずに離れる。
      await page.waitForTimeout(15000);
      await page.goto(`${BASE}/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(6000);
      await passReauth('after-approve');
      // プレビューアーを閉じると消える文言と、content ページ側に残る文言の両方があるので
      // 戻ったあともう一度拾ってマージする。
      const contentErrs = await previewErrors();
      if (contentErrs.length > 0) {
        lastPreviewErrors = [...new Set([...lastPreviewErrors, ...contentErrs])].slice(0, 12);
        log.info({ titleId, contentErrors: contentErrs }, 'content ページ側のエラー文も収集');
      }
      return { opened: true, pages };
    };

    const needsPreview = async (): Promise<boolean> => {
      if (!/\/content/.test(page.url())) {
        await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'content-verify');
      }
      await page.waitForTimeout(4000);
      const warned = await page
        .evaluate((w: string) => (document.body.innerText || '').includes(w), PREVIEW_WARN)
        .catch(() => false);
      // 何が出ているのかを毎回残す (not_approved の原因切り分け用)。
      log.info({ titleId, warned, state: await previewStateText(page) }, 'paperback content preview state');
      return warned;
    };

    /**
     * [F-097k] content ページの「概要」に**ページ数と印刷コスト**が出ているか。
     *
     * 原稿が処理済みの下書きには必ず「ページ数: 152 印刷コスト ￥510」が出る。
     * 出ていない = 原稿も ISBN も入っていない**未完成の下書き**で、この状態で先へ進むと
     * 価格ページが「以前のページに問題が見つかりました」で固まる (2026-10-02 実測。
     * `no_price_field` / `blocked_prior_page` として延々リトライしていた本の正体)。
     * details/content を保存し直しても直らないので、下書き作成からやり直させる。
     */
    const draftLooksComplete = async (): Promise<boolean> =>
      page
        .evaluate(() => /ページ数:\s*\d+/.test(document.body.innerText || ''))
        .catch(() => true);

    if (!(await draftLooksComplete())) {
      await shot(page, `${titleId}-draft-incomplete`);
      return {
        ok: false,
        reason: 'draft_incomplete',
        message: '下書きが未完成 (原稿未アップロード/ISBN 未取得)。下書き作成からやり直します',
      };
    }

    let pages: number | null = null;
    let approvedOk = false;
    let lastPreviewErrors: string[] = [];
    let coverReplaced = false;
    let interiorReplaced = false;
    // 表紙を差し替えた直後は、警告文が消えていても**必ず承認をやり直す**
    // (差し替え前の承認は新しいファイルには効かない)。
    let forceReapprove = false;
    for (let round = 0; round < 4; round += 1) {
      if (!forceReapprove && !(await needsPreview())) {
        approvedOk = true;
        break;
      }
      forceReapprove = false;
      const r = await approveOnce();
      if (!r.opened) {
        return { ok: false, reason: 'no_previewer', message: 'プレビューアー起動ボタンが見つかりません' };
      }
      pages = r.pages ?? pages;

      // [F-097g] プレビューにエラーがあると承認ボタンが無効のままになる。原因の大半は
      // **表紙が Kindle 用の A4 縦のまま**なので、エラーが出ていたら一度だけ、こちらで
      // 組み直した正しいラップカバーに差し替えて仕切り直す (文言に「表紙」が出ない
      // ケースもあるため、エラーの有無だけで判断する — 2026-09-29 実測)。
      // [F-097j] 「内側マージンが不十分です」は本文 PDF の問題なので、余白を広げた本文に差し替える。
      const realErrors = lastPreviewErrors.filter(isRealPreviewError);
      const marginBad = realErrors.some((e) => /マージン/.test(e));
      if (marginBad && args.interiorPath && !interiorReplaced) {
        log.warn({ titleId, previewErrors: lastPreviewErrors }, '本文の余白不足 — 余白を広げた本文に差し替える');
        interiorReplaced = true;
        forceReapprove = true;
        if (!(await replaceInterior(args.interiorPath))) {
          return {
            ok: false,
            reason: 'cover_rejected',
            message: `本文を差し替えられませんでした: ${realErrors.join(' / ').slice(0, 200)}`,
          };
        }
        continue;
      }

      // 表紙サイズの指摘が出ていればそれ、出ていなくても**本物の**エラーが残っているなら
      // 表紙が原因のことが多い (文言に「表紙」が出ないケースがある — 2026-09-29 実測)。
      const previewHasError = realErrors.some((e) => COVER_SIZE_ERROR.test(e)) || realErrors.length > 0;
      if (previewHasError && !coverReplaced) {
        // **KDP が数えた頁数**で作り直す (手元の頁数とは一致しない)。
        const kdpPages = r.pages ?? pages;
        let file = args.coverPath ?? null;
        if (args.buildCoverForPages && kdpPages) {
          const rebuilt = await args.buildCoverForPages(kdpPages).catch(() => null);
          if (rebuilt) file = rebuilt;
        }
        if (!file) break;
        log.warn(
          { titleId, kdpPages, previewErrors: realErrors },
          '表紙が KDP 判定で不適合 — KDP の頁数で作り直して差し替える',
        );
        coverReplaced = true;
        forceReapprove = true;
        if (!(await replaceCover(file))) {
          return {
            ok: false,
            reason: 'cover_rejected',
            message: `表紙を差し替えられませんでした: ${realErrors.join(' / ').slice(0, 200)}`,
          };
        }
        continue;
      }
    }
    if (!approvedOk) {
      await shot(page, `${titleId}-not-approved`);
      const real = lastPreviewErrors.filter(isRealPreviewError);
      const detail = real.length > 0 ? ` KDP の指摘: ${real.join(' / ').slice(0, 220)}` : '';
      const reason = real.some((e) => COVER_SIZE_ERROR.test(e)) ? 'cover_rejected' : 'not_approved';
      return { ok: false, reason, message: `プレビュー承認が記録されませんでした (4 回試行)。${detail}` };
    }
    log.info({ titleId, pages }, 'paperback preview approved');

    // --- content を保存して pricing へ ---
    // 保存前に再アップロードの確認チェックを ON にする (残っていると保存が通らない)。
    const preSaveCfm = await checkReuploadConfirms(page).catch(() => ({ total: 0, checked: 0 }));
    if (preSaveCfm.total > 0) log.info({ titleId, ...preSaveCfm }, 'content 保存前の確認チェック');
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

    /**
     * 「本の設定の以前のページに問題が見つかりました。続行するには、戻って情報を確認し、
     * 保存してください。」ダイアログの文言を返す (出ていなければ null)。
     *
     * このダイアログが出ている間は **価格欄 (`#price-input-jpy`) 自体が描画されない**
     * (「マーケットプレイスが設定されていません」とだけ出る。2026-10-01 実測)。
     * つまり `no_price_field` の正体はたいていこれなので、価格欄の有無を判定する前に
     * ダイアログを見て前段を保存し直す必要がある。
     */
    const priorPageBlocked = async (): Promise<string | null> =>
      page
        .evaluate(() => {
          const d = [...document.querySelectorAll('[role=dialog], .a-popover')].find(
            (x) =>
              ((x as HTMLElement).offsetWidth || (x as HTMLElement).offsetHeight) &&
              /以前のページに問題/.test(x.textContent || ''),
          );
          return d ? (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
        })
        .catch(() => null);

    /**
     * [F-097g] 表紙や本文を差し替えると前段 (details/content) の確定が外れることがある。
     * details → content の順に保存し直してから価格ページへ戻る。
     */
    const resavePriorPages = async (): Promise<void> => {
      await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/details`, 'details-retry');
      const detailsResaved = await clickVisible(/保存して続行/);
      await page.waitForTimeout(10000);
      await passReauth('details-resave');
      await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/content`, 'content-retry');
      const retryCfm = await checkReuploadConfirms(page).catch(() => ({ total: 0, checked: 0 }));
      if (retryCfm.total > 0) log.info({ titleId, ...retryCfm }, '前段やり直し時の確認チェック');
      const contentResaved = await clickVisible(/保存して続行/);
      await page.waitForTimeout(12000);
      await passReauth('content-resave');
      log.info({ titleId, detailsResaved, contentResaved }, 'paperback 前段を保存し直した');
      if (!/\/pricing/.test(page.url())) {
        await gotoWithReauth(`${BASE}/print-setup/paperback/${titleId}/pricing`, 'pricing-retry');
      }
    };

    let jp = null as Awaited<ReturnType<typeof page.waitForSelector>> | null;
    let blockedMsg: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      jp = await page.waitForSelector('#price-input-jpy', { timeout: 30000 }).catch(() => null);
      blockedMsg = await priorPageBlocked();
      if (jp && !blockedMsg) break;
      if (attempt === 1) break;
      log.warn(
        { titleId, blocked: blockedMsg, hasPriceField: Boolean(jp) },
        '価格欄に入力できない — details/content を保存し直して再試行',
      );
      await shot(page, `${titleId}-blocked-prior-page`);
      await resavePriorPages();
    }

    if (!jp) {
      await shot(page, `${titleId}-no-price-field`);
      return blockedMsg
        ? { ok: false, reason: 'blocked_prior_page', message: blockedMsg }
        : { ok: false, reason: 'no_price_field', message: '価格入力欄が見つかりません' };
    }

    await jp.click({ force: true, timeout: 8000 }).catch(() => {});
    await jp.fill('').catch(() => {});
    await jp.type(String(priceJpy), { delay: 40 });
    await page.keyboard.press('Tab');
    await page.waitForTimeout(4000);
    log.info({ titleId, priceJpy, pages }, 'paperback price filled');

    const stillBlocked = await priorPageBlocked();
    if (stillBlocked) {
      await shot(page, `${titleId}-blocked-prior-page-retry`);
      return { ok: false, reason: 'blocked_prior_page', message: stillBlocked };
    }

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
