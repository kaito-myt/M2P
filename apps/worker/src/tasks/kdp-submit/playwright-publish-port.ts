/**
 * KDP サーバー側自動入稿 (Playwright) — 出版ウィザードの本番実装 [F-041 Phase3]。
 *
 * `scripts/kdp-publish.mjs` の実証済 `--auto` フロー(既存下書き resume→STEP1/2/3→出版)を
 * worker headless へ移植したもの。セッションは `accounts.kdp_session_state_enc` 再利用、
 * 再認証は password 実タイプ＋OTP(TOTP 自動 or LINE リレー)、IP は既定データセンター
 * (proxy 指定時のみ住宅IP)。**既存下書きを resume するため KDP の作成上限を消費しない**。
 *
 * HARD RULE: playwright の import はこのファイルに閉じる。DOM 操作の evaluate は
 * ブラウザ側実行のため document/window を参照してよい。
 */
import path from 'node:path';

import { createLogger } from '@a2p/contracts/logger';

import { handleOtpRetryLoop } from '../sales-fetch/kdp-login-refresh.js';
import type { KdpProxyConfig } from '../sales-fetch/kdp-proxy.js';
import { UA, LAUNCH_ARGS } from '../sales-fetch/playwright-browser-port.js';
import type { OtpProvider } from './totp.js';

const log = createLogger('worker.kdp-submit.playwright');

const BOOKSHELF = 'https://kdp.amazon.co.jp/ja_JP/bookshelf';
const EDIT_BASE =
  'https://kdp.amazon.co.jp/action/dualbookshelf.editkindledetails/ja_JP/title-setup/kindle/';
const CREATE_URL =
  'https://kdp.amazon.co.jp/action/mangaactions.createkindle/ja_JP/title-setup/kindle/new/details';
const OTP_SEL = '#auth-mfa-otpcode, input[name="otpCode"], #cvf-input-code, input[name="code"]';

// ---------------------------------------------------------------------------
// 公開型
// ---------------------------------------------------------------------------

export interface KdpBookInput {
  id: string;
  title: string;
  subtitle?: string | null;
  title_kana?: string | null;
  title_romaji?: string | null;
  subtitle_kana?: string | null;
  subtitle_romaji?: string | null;
  pen_name?: string | null;
  author_kana?: string | null;
  author_romaji?: string | null;
  keywords?: string[] | null;
  description?: string | null;
  categories?: string[] | null;
  price_jpy?: number | null;
  /** ローカル tmp の原稿 docx / 表紙 画像パス。 */
  docxPath: string;
  coverPath: string;
}

export interface KdpPublishArgs {
  book: KdpBookInput;
  /** 復号済み storageState(JSON)。 */
  sessionState: string;
  proxy?: KdpProxyConfig;
  otp: OtpProvider;
  amazonEmail?: string;
  amazonPassword?: string;
  dryRun?: boolean;
  /** スクショ保存先ディレクトリ。 */
  stageDir: string;
}

export type KdpPublishResult =
  | { ok: true; status: 'submitted' | 'dry_run_ready'; asin: string | null; storageState: string }
  | {
      ok: false;
      reason: 'no_draft' | 'creation_limit' | 'reauth_failed' | 'blocked' | 'error' | 'no_creds';
      message: string;
      blockedAt?: string;
      storageState?: string;
    };

export interface KdpPublishPort {
  publishOne(args: KdpPublishArgs): Promise<KdpPublishResult>;
}

export function createPlaywrightPublishPort(): KdpPublishPort {
  return { publishOne };
}

// ---------------------------------------------------------------------------
// romaji (KDP のローマ字欄は ASCII のみ) — scripts/kdp-publish.mjs から移植
// ---------------------------------------------------------------------------
const KANA_ROMAJI: Record<string, string> = {
  キャ: 'kya', キュ: 'kyu', キョ: 'kyo', シャ: 'sha', シュ: 'shu', ショ: 'sho', チャ: 'cha', チュ: 'chu', チョ: 'cho',
  ニャ: 'nya', ニュ: 'nyu', ニョ: 'nyo', ヒャ: 'hya', ヒュ: 'hyu', ヒョ: 'hyo', ミャ: 'mya', ミュ: 'myu', ミョ: 'myo',
  リャ: 'rya', リュ: 'ryu', リョ: 'ryo', ギャ: 'gya', ギュ: 'gyu', ギョ: 'gyo', ジャ: 'ja', ジュ: 'ju', ジョ: 'jo',
  ビャ: 'bya', ビュ: 'byu', ビョ: 'byo', ピャ: 'pya', ピュ: 'pyu', ピョ: 'pyo',
  ヴァ: 'va', ヴィ: 'vi', ヴェ: 've', ヴォ: 'vo', ファ: 'fa', フィ: 'fi', フェ: 'fe', フォ: 'fo',
  ティ: 'ti', ディ: 'di',
  ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o', カ: 'ka', キ: 'ki', ク: 'ku', ケ: 'ke', コ: 'ko',
  サ: 'sa', シ: 'shi', ス: 'su', セ: 'se', ソ: 'so', タ: 'ta', チ: 'chi', ツ: 'tsu', テ: 'te', ト: 'to',
  ナ: 'na', ニ: 'ni', ヌ: 'nu', ネ: 'ne', ノ: 'no', ハ: 'ha', ヒ: 'hi', フ: 'fu', ヘ: 'he', ホ: 'ho',
  マ: 'ma', ミ: 'mi', ム: 'mu', メ: 'me', モ: 'mo', ヤ: 'ya', ユ: 'yu', ヨ: 'yo',
  ラ: 'ra', リ: 'ri', ル: 'ru', レ: 're', ロ: 'ro', ワ: 'wa', ヲ: 'o', ン: 'n',
  ガ: 'ga', ギ: 'gi', グ: 'gu', ゲ: 'ge', ゴ: 'go', ザ: 'za', ジ: 'ji', ズ: 'zu', ゼ: 'ze', ゾ: 'zo',
  ダ: 'da', ヂ: 'ji', ヅ: 'zu', デ: 'de', ド: 'do', バ: 'ba', ビ: 'bi', ブ: 'bu', ベ: 'be', ボ: 'bo',
  パ: 'pa', ピ: 'pi', プ: 'pu', ペ: 'pe', ポ: 'po', ヴ: 'vu',
  ァ: 'a', ィ: 'i', ゥ: 'u', ェ: 'e', ォ: 'o', ー: '', '・': ' ', '　': ' ',
};
function kanaToRomaji(s?: string | null): string {
  if (!s) return '';
  let str = String(s).replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const two = str.substr(i, 2);
    if (KANA_ROMAJI[two] !== undefined) {
      out += KANA_ROMAJI[two];
      i++;
      continue;
    }
    const ch = str[i]!;
    if (ch === 'ッ') {
      const nx = KANA_ROMAJI[str.substr(i + 1, 2)] ?? KANA_ROMAJI[str[i + 1] ?? ''] ?? '';
      if (nx) out += nx[0];
      continue;
    }
    out += KANA_ROMAJI[ch] !== undefined ? KANA_ROMAJI[ch] : ch;
  }
  return out;
}
const asciiOnly = (v?: string | null): string | null =>
  v && /^[\x00-\x7F]+$/.test(String(v)) ? String(v) : null;
function romajiFor(romaji?: string | null, kana?: string | null): string | undefined {
  const a = asciiOnly(romaji);
  if (a) return a;
  const r = kanaToRomaji(kana).replace(/[^\x00-\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
  return r || undefined;
}
function segs(pathStr: string): string[] {
  const p = pathStr.split('>').map((s) => s.trim());
  const i = p.findIndex((x) => x.replace(/\s/g, '') === 'Kindle本');
  return i >= 0 ? p.slice(i) : p;
}

// ---------------------------------------------------------------------------
// 実装 (playwright dynamic import)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Page = any;

async function publishOne(args: KdpPublishArgs): Promise<KdpPublishResult> {
  const { book: b, otp, dryRun } = args;
  const stage = args.stageDir;

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

  const browser = await chromium.launch({
    headless: true,
    args: LAUNCH_ARGS,
    ...(args.proxy ? { proxy: args.proxy } : {}),
  });
  if (args.proxy) log.info({ server: args.proxy.server }, 'kdp.submit via home proxy');
  try {
    const context = await browser.newContext({
      storageState: storageStateObj as Awaited<
        ReturnType<import('playwright').BrowserContext['storageState']>
      >,
      locale: 'ja-JP',
      userAgent: UA,
      viewport: { width: 1500, height: 1200 },
      acceptDownloads: false,
    });
    const page: Page = await context.newPage();
    page.setDefaultTimeout(60000);

    // 1. 本棚へ。再認証ウォールが出れば通す。
    await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    const reauth = await passReauth(page, args);
    if (!reauth) {
      await screenshot(page, stage, b.id + '-reauth-failed');
      return { ok: false, reason: 'reauth_failed', message: 'login/reauth failed' };
    }

    // 2. 既存下書きがあれば resume(作成上限を消費しない)、無ければ新規作成(上限を1消費)。
    const draftIds = await collectDraftIds(page);
    const detailsUrl = draftIds.length > 0 ? EDIT_BASE + draftIds[0] + '/details' : CREATE_URL;
    const mode = draftIds.length > 0 ? 'resume' : 'create';
    log.info({ drafts: draftIds.length, mode }, 'collected draft slots');

    // 3. STEP1 詳細ページを開く
    await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(6000);
    await passReauth(page, args); // 編集/作成ページで再度ウォールが出ることがある
    if (!/\/details/.test(page.url()) || !(await page.$('#data-title').catch(() => null))) {
      await page.goto(detailsUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(6000);
      await passReauth(page, args);
    }
    const titleReady = await page
      .waitForSelector('#data-title', { state: 'visible', timeout: 45000 })
      .then(() => true)
      .catch(() => false);
    if (!titleReady) {
      await screenshot(page, stage, b.id + '-nodetails');
      return { ok: false, reason: 'error', message: '詳細ページの入力欄が表示されません' };
    }
    const s1 = await fillStep1(page, b);
    if (s1.blocked) {
      await screenshot(page, stage, b.id + '-blocked1');
      const reason = s1.blocked === 'creation_limit' ? 'creation_limit' : 'blocked';
      return { ok: false, reason, message: `step1 blocked: ${s1.blocked}`, blockedAt: 'step1' };
    }
    log.info('step1 OK -> content');

    // 4. STEP2 原稿/表紙アップロード
    const s2 = await fillStep2(page, b.coverPath, b.docxPath, stage);
    if (s2.blocked) {
      await screenshot(page, stage, b.id + '-blocked2');
      return { ok: false, reason: 'blocked', message: `step2 blocked: ${s2.blocked}`, blockedAt: 'step2' };
    }
    log.info('step2 OK (uploads verified) -> pricing');

    // 5. STEP3 価格/出版
    let s3: { ok?: boolean; blocked?: string; dryRun?: boolean; verify?: boolean };
    try {
      s3 = await fillStep3(page, b, stage, dryRun);
    } catch (e) {
      log.warn({ err: errMsg(e) }, 'step3 threw (nav on publish?) — verifying via bookshelf');
      s3 = { verify: true };
    }
    const freshState = JSON.stringify(await context.storageState());
    if (s3.dryRun) {
      await screenshot(page, stage, b.id + '-dryrun-pricing');
      return { ok: true, status: 'dry_run_ready', asin: null, storageState: freshState };
    }
    if (s3.blocked) {
      await screenshot(page, stage, b.id + '-blocked3');
      return { ok: false, reason: 'blocked', message: `step3 blocked: ${s3.blocked}`, blockedAt: 'step3', storageState: freshState };
    }

    // 6. 出版確認 (本棚照合)
    await page.waitForTimeout(4000);
    const pubv = await verifyPublished(page, b.title).catch(() => ({ published: false, asin: null }));
    const finalState = JSON.stringify(await context.storageState());
    if (pubv.published) {
      log.info({ asin: pubv.asin }, 'publish verified via bookshelf');
      return { ok: true, status: 'submitted', asin: pubv.asin ?? null, storageState: finalState };
    }
    await screenshot(page, stage, b.id + '-publish-unconfirmed');
    return { ok: false, reason: 'blocked', message: '出版未確認(本棚にレビュー中/販売中が出ない)', blockedAt: 'verify', storageState: finalState };
  } catch (err) {
    return { ok: false, reason: 'error', message: errMsg(err) };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 再認証 (account picker → password → OTP)
// ---------------------------------------------------------------------------
async function passReauth(page: Page, args: KdpPublishArgs): Promise<boolean> {
  const authForm = async () =>
    page.$('#ap_password, input[type="password"][name="password"], #signInSubmit, #ap_email, ' + OTP_SEL).catch(() => null);
  if (!/signin|\/ap\/|\/mfa|\/cvf/i.test(page.url()) && !(await authForm())) return true;

  const email = args.amazonEmail || process.env.AMAZON_EMAIL || '';
  const password = args.amazonPassword || process.env.AMAZON_PASSWORD || '';
  let passTries = 0;
  for (let i = 0; i < 120; i++) {
    // account picker
    if (!(await page.$('#ap_password, input[type="password"][name="password"]').catch(() => null))) {
      const picked = await clickAccountTile(page, email);
      if (picked) {
        await page.waitForTimeout(3500);
      }
    }
    // email (稀)
    const emailEl = await page.$('#ap_email, input[type="email"][name="email"]').catch(() => null);
    if (emailEl && email && (await emailEl.isVisible().catch(() => false))) {
      await emailEl.fill(email).catch(() => {});
      await page.click('#continue, input#continue').catch(() => {});
      await page.waitForTimeout(2500);
    }
    // OTP
    const otpEl = await page.$(OTP_SEL).catch(() => null);
    if (otpEl && (await otpEl.isVisible().catch(() => false))) {
      const r = await handleOtpRetryLoop(page, {
        requestOtp: (prompt) => args.otp.getCode(prompt),
        notifyFailure: async () => true,
      });
      if (!r.ok) return false;
    }
    // password (実タイプ)
    const passEl = await page.$('#ap_password, input[type="password"][name="password"]').catch(() => null);
    if (passEl && (await passEl.isVisible().catch(() => false)) && password && passTries < 3) {
      passTries++;
      await passEl.click().catch(() => {});
      await passEl.fill('').catch(() => {});
      await passEl.type(password, { delay: 25 }).catch(() => {});
      await page.check('#auth-remember-me, #rememberMe').catch(() => {});
      await page.click('#signInSubmit, input#signInSubmit').catch(() => {});
      await page.waitForTimeout(3500);
    }
    if (!/signin|\/ap\/|\/mfa|\/cvf/i.test(page.url()) && !(await authForm())) {
      await page.waitForTimeout(1500);
      return true;
    }
    await page.waitForTimeout(3000);
  }
  return false;
}

async function clickAccountTile(page: Page, email: string): Promise<string | null> {
  return page
    .evaluate((mail: string) => {
      const t = (mail || '').toLowerCase();
      const nodes = Array.from(
        document.querySelectorAll('a, div[role="button"], button, [data-a-target], .a-link-normal'),
      ) as HTMLElement[];
      const hit =
        (t ? nodes.find((n) => (n.textContent || '').toLowerCase().includes(t)) : undefined) ??
        nodes.find(
          (n) => !/アカウントの追加|別のアカウント/.test(n.textContent || '') && /@/.test(n.textContent || ''),
        );
      if (hit) {
        hit.click();
        return (hit.textContent || '').trim().slice(0, 40);
      }
      return null;
    }, email)
    .catch(() => null);
}

async function collectDraftIds(page: Page): Promise<string[]> {
  await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const a of Array.from(document.querySelectorAll('a[href*="editkindledetails"]'))) {
      const m = (a.getAttribute('href') || '').match(/kindle\/([A-Z0-9]{8,})\/details/);
      if (!m) continue;
      let row: HTMLElement | null = a as HTMLElement;
      for (let i = 0; i < 8 && row; i++) {
        row = row.parentElement;
        if (row && /下書き/.test(row.textContent || '')) break;
      }
      const rt = row ? row.textContent || '' : '';
      if (/下書き/.test(rt) && !/レビュー中|販売中|ライブ|出版準備中/.test(rt) && !seen.has(m[1]!)) {
        seen.add(m[1]!);
        out.push(m[1]!);
      }
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// STEP1 詳細
// ---------------------------------------------------------------------------
async function fillStep1(page: Page, b: KdpBookInput): Promise<{ ok?: boolean; blocked?: string }> {
  const set = async (sel: string, v?: string | null) => {
    if (v == null || v === '') return;
    const e = await page.$(sel);
    if (e) await e.fill(String(v));
  };
  await set('#data-title', b.title);
  await set('#data-title-pronunciation', b.title_kana);
  await set('#data-title-romanized', romajiFor(b.title_romaji, b.title_kana));
  await set('#data-subtitle', b.subtitle);
  await set('#data-subtitle-pronunciation', b.subtitle_kana);
  await set('#data-subtitle-romanized', romajiFor(b.subtitle_romaji, b.subtitle_kana));
  await set('#data-print-book-primary-author-last-name-jp', b.pen_name);
  await set('#data-primary-author-pronunciation', b.author_kana);
  await set('#data-primary-author-name-romanized', romajiFor(b.author_romaji, b.author_kana));
  for (let i = 0; i < 7; i++) if (b.keywords?.[i]) await set('#data-keywords-' + i, b.keywords[i]);
  await page.check('#non-public-domain', { force: true }).catch(() => {});
  await page.check('input[name="data[is_adult_content]-radio"][value="false"]', { force: true }).catch(() => {});
  await page
    .evaluate((t: string) => {
      try {
        const w = window as unknown as { CKEDITOR?: { instances: Record<string, { setData: (s: string) => void }> } };
        if (w.CKEDITOR && w.CKEDITOR.instances) {
          const k = Object.keys(w.CKEDITOR.instances)[0];
          if (k) w.CKEDITOR.instances[k]!.setData(t.replace(/\n/g, '<br>'));
        }
      } catch {
        /* noop */
      }
    }, b.description || '')
    .catch(() => {});
  await page.waitForTimeout(2000);

  // categories
  let en = false;
  for (let i = 0; i < 15; i++) {
    const d = await page.getAttribute('#categories-modal-button', 'disabled').catch(() => null);
    if (d === null) {
      en = true;
      break;
    }
    await page.waitForTimeout(1500);
  }
  if (en) {
    const cats = (b.categories || []).slice(0, 3).map(segs);
    await page.click('#categories-modal-button').catch(() => {});
    await page.waitForTimeout(3500);
    const pickSelect = async (seg: string) => {
      for (let a = 0; a < 4; a++) {
        const info = await page.$$eval(
          'select',
          (sels: HTMLSelectElement[], seg: string) =>
            sels.map((s, i) => ({
              i,
              vis: s.offsetParent !== null,
              has: [...s.options].some((o) => o.textContent!.trim() === seg),
              cur: s.options[s.selectedIndex]?.textContent?.trim(),
            })),
          seg,
        );
        const t = info.find((s: { vis: boolean; has: boolean; cur?: string }) => s.vis && s.has && s.cur !== seg);
        if (t) {
          const h = (await page.$$('select'))[t.i];
          await h.selectOption({ label: seg });
          await page.waitForTimeout(1600);
          return true;
        }
        await page.waitForTimeout(900);
      }
      return false;
    };
    const checkPlace = (seg: string) =>
      page.evaluate((seg: string) => {
        const boxes = [...document.querySelectorAll('input[type=checkbox]')].filter(
          (c) => (c as HTMLElement).offsetParent !== null,
        ) as HTMLInputElement[];
        const lbl = (c: HTMLInputElement) => {
          let t = '';
          if (c.id) {
            const l = document.querySelector(`label[for="${c.id}"]`);
            if (l) t = l.textContent!.trim();
          }
          if (!t && c.closest('label')) t = c.closest('label')!.textContent!.trim();
          return t;
        };
        const ex = boxes.find((c) => lbl(c) === seg && !c.checked);
        const tg = ex || boxes.find((c) => !c.checked);
        if (!tg) return { ok: false };
        tg.click();
        return { ok: true };
      }, seg);
    for (let ci = 0; ci < cats.length; ci++) {
      if (ci > 0) {
        await page.click('button:has-text("別のカテゴリーを追加")').catch(() => {});
        await page.waitForTimeout(2000);
      }
      let leaf = false;
      for (const seg of cats[ci]!) {
        const ok = await pickSelect(seg);
        if (ok) continue;
        const r = await checkPlace(seg);
        leaf = r.ok;
        break;
      }
      if (!leaf) await checkPlace('__x__');
      await page.waitForTimeout(1200);
    }
    await page.click('button:has-text("カテゴリーを保存")').catch(() => {});
    await page.waitForTimeout(3000);
  }
  await page.click('#save-and-continue-announce').catch(() => {});
  await page.waitForTimeout(7000);
  const limited = await page.evaluate(() => {
    const n = [...document.querySelectorAll('div,section')].find(
      (x) =>
        /本の作成数制限を超えました|提出可能な本の数を超え/.test(x.textContent || '') &&
        (x as HTMLElement).offsetParent !== null &&
        x.querySelectorAll('button,a').length <= 3,
    );
    return !!n;
  });
  if (limited) return { blocked: 'creation_limit' };
  if (!/\/(content)/.test(page.url())) return { blocked: 'not_advanced' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// STEP2 原稿/表紙 + オプション + 確認チェック (scripts から移植)
// ---------------------------------------------------------------------------
async function checkConfirmBoxes(page: Page): Promise<{ total: number; checked: number }> {
  const handles = await page.$$('[role="checkbox"]').catch(() => []);
  let total = 0;
  let checked = 0;
  for (const h of handles) {
    const isConfirm = await h
      .evaluate((el: HTMLElement) => {
        let n: HTMLElement | null = el;
        for (let i = 0; i < 6 && n; i++) {
          n = n.parentElement;
          if (n && /新しい原稿または表紙画像をアップロード|自分の回答が正しいこと/.test(n.textContent || '')) return true;
        }
        return false;
      })
      .catch(() => false);
    if (!isConfirm) continue;
    total++;
    let ac = await h.getAttribute('aria-checked').catch(() => null);
    if (ac !== 'true') {
      await h.click().catch(() => {});
      await page.waitForTimeout(500);
      ac = await h.getAttribute('aria-checked').catch(() => null);
      if (ac !== 'true') {
        await h.focus().catch(() => {});
        await page.keyboard.press('Space').catch(() => {});
        await page.waitForTimeout(400);
        ac = await h.getAttribute('aria-checked').catch(() => null);
      }
    }
    if (ac === 'true') checked++;
  }
  return { total, checked };
}

async function setStep2Options(page: Page): Promise<{ drm: boolean; accessibility: boolean; confirm: boolean; aiNo: boolean }> {
  await page.click('#a-autoid-0-announce').catch(() => {});
  await page.waitForTimeout(300);
  await page
    .evaluate(() => {
      const all = [...document.querySelectorAll('*')] as HTMLElement[];
      const q = all.find((x) => /AI ツールを使用しましたか/.test(x.textContent || '') && (x.textContent || '').length < 300);
      let root: HTMLElement | null = q ?? null;
      for (let i = 0; i < 10 && root; i++) {
        if ([...root.querySelectorAll('*')].some((e) => e.textContent!.trim() === 'いいえ')) break;
        root = root.parentElement;
      }
      root = root || document.body;
      const leaf = [...root.querySelectorAll('*')].find(
        (e) => e.textContent!.trim() === 'いいえ' && e.children.length === 0,
      ) as HTMLElement | undefined;
      const target = leaf ? leaf.closest('label,[role=radio],.a-radio,button,a') || leaf : null;
      if (target)
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) =>
          target.dispatchEvent(new MouseEvent(t, { bubbles: true })),
        );
    })
    .catch(() => {});
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const labelOf = (inp: HTMLInputElement) => {
      const l = inp.closest('label') || (inp.id && document.querySelector('label[for="' + inp.id + '"]'));
      return ((l ? l.textContent : inp.parentElement ? inp.parentElement.textContent : '') || '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const radios = [...document.querySelectorAll('input[type=radio]')] as HTMLInputElement[];
    const drmR =
      radios.find((r) => /デジタル著作権管理を適用します/.test(labelOf(r))) ||
      radios.find((r) => /DRM/.test(labelOf(r)) && /を適用します/.test(labelOf(r)));
    if (drmR && !drmR.checked) drmR.click();
    const accR = ([...document.querySelectorAll('input[name="data[accessibility][image_reading]"]')] as HTMLInputElement[]).find(
      (r) => /すべてに代替テキストや詳細な説明が含まれています/.test(labelOf(r)),
    );
    if (accR && !accR.checked) accR.click();
    const cf = (() => {
      const cands = ([...document.querySelectorAll('div, section, fieldset, li')] as HTMLElement[]).filter((el) => {
        const t = el.textContent || '';
        return t.length < 400 && /新しい原稿または表紙画像をアップロード/.test(t) && /自分の回答が正しいこと/.test(t);
      });
      const minimal = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o)));
      let total = 0;
      let checked = 0;
      const isOn = (box: HTMLElement, aui: Element | null) => {
        const nat = box.querySelector('input[type=checkbox]') as HTMLInputElement | null;
        if (nat) return nat.checked;
        if (aui && aui.getAttribute && aui.getAttribute('aria-checked') === 'true') return true;
        return /a-checkbox-checked|is-checked|aria-checked="true"/.test(box.innerHTML || '');
      };
      for (const box of minimal) {
        total++;
        const nat = box.querySelector('input[type=checkbox]') as HTMLInputElement | null;
        if (nat) {
          if (!nat.checked) nat.click();
          if (nat.checked) checked++;
          continue;
        }
        const aui = box.querySelector('[role=checkbox], .a-checkbox, i[class*="checkbox"], [class*="checkbox"], label');
        const target = (aui || box) as HTMLElement;
        if (!isOn(box, aui))
          ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) =>
            target.dispatchEvent(new MouseEvent(t, { bubbles: true })),
          );
        if (isOn(box, aui)) checked++;
      }
      return { total, checked };
    })();
    const aiNo = (() => {
      const all = [...document.querySelectorAll('*')] as HTMLElement[];
      const q = all.find((x) => /AI ツールを使用しましたか/.test(x.textContent || '') && (x.textContent || '').length < 300);
      let root: HTMLElement | null = q ?? null;
      for (let i = 0; i < 10 && root; i++) {
        if ([...root.querySelectorAll('*')].some((e) => e.textContent!.trim() === 'いいえ')) break;
        root = root.parentElement;
      }
      root = root || document.body;
      const leaf = [...root.querySelectorAll('*')].find(
        (e) => e.textContent!.trim() === 'いいえ' && e.children.length === 0,
      ) as HTMLElement | undefined;
      const box = leaf ? leaf.closest('label,[role=radio],.a-radio') : null;
      if (!box) return false;
      const nat = box.querySelector('input[type=radio]') as HTMLInputElement | null;
      if (nat) return nat.checked;
      return /a-icon-radio-active/.test(box.innerHTML) || box.getAttribute('aria-checked') === 'true';
    })();
    return {
      drm: !!(drmR && drmR.checked),
      accessibility: !!(accR && accR.checked),
      confirm: cf.total > 0 && cf.checked >= cf.total,
      aiNo,
    };
  });
}

async function fillStep2(
  page: Page,
  coverPath: string,
  docxPath: string,
  stage: string,
): Promise<{ ok?: boolean; blocked?: string }> {
  await page
    .setInputFiles('#data-assets-interior-file-upload-AjaxInput', docxPath)
    .catch((e: Error) => {
      throw new Error('interior upload: ' + e.message);
    });
  log.info('manuscript uploading...');
  await waitUploadDone(page, 'interior', 1, stage);
  await page.click('#a-autoid-0-announce').catch(() => {});
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  await page.waitForTimeout(1500);
  const coverSel = (await page.$('#data-assets-cover-jp-file-upload-AjaxInput').catch(() => null))
    ? '#data-assets-cover-jp-file-upload-AjaxInput'
    : '#data-assets-cover-file-upload-AjaxInput';
  await page.setInputFiles(coverSel, coverPath).catch((e: Error) => {
    throw new Error('cover upload: ' + e.message);
  });
  log.info({ coverSel }, 'cover uploading...');
  await waitCoverDone(page, stage);
  // ファイル準備モーダル(変換処理)完了待ち
  {
    const pdl = Date.now() + 6 * 60 * 1000;
    while (Date.now() < pdl) {
      const busy = await page.evaluate(() => /ファイルを準備しています/.test(document.body.textContent || ''));
      if (!busy) break;
      await page.waitForTimeout(4000);
    }
  }
  await page.waitForTimeout(2000);
  let opt = await setStep2Options(page);
  for (let r = 0; r < 3 && (!opt.aiNo || !opt.drm); r++) {
    await page.waitForTimeout(2500);
    opt = await setStep2Options(page);
  }
  let cc = await checkConfirmBoxes(page);
  for (let r = 0; r < 4 && cc.total > 0 && cc.checked < cc.total; r++) {
    await page.waitForTimeout(1500);
    cc = await checkConfirmBoxes(page);
  }
  await page.waitForTimeout(800);
  await screenshot(page, stage, 'step2-ready');
  const saveDeadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < saveDeadline) {
    await page.click('#save-and-continue-announce').catch(() => {});
    await page.waitForTimeout(6000);
    if (/\/(pricing)/.test(page.url())) return { ok: true };
  }
  await screenshot(page, stage, 'step2-blocked');
  return { blocked: 'content_not_advanced' };
}

async function waitUploadDone(page: Page, tag: string, minCount: number, stage: string, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const err = await page.evaluate(() =>
      /アップロードに失敗|正常にアップロードできません|ファイルの処理に失敗|問題が発生しました/.test(
        document.body.textContent || '',
      ),
    );
    if (err) {
      await screenshot(page, stage, tag + '-uploaderr');
      throw new Error(tag + ' upload error');
    }
    const n = await page.evaluate(
      () => (document.body.textContent!.match(/正常にアップロードしました/g) || []).length,
    );
    if (n >= minCount) {
      await page.waitForTimeout(2500);
      return;
    }
    await page.waitForTimeout(3000);
  }
  await screenshot(page, stage, tag + '-uploadtimeout');
  throw new Error(tag + ' upload timeout');
}

async function waitCoverDone(page: Page, stage: string, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await page.evaluate(() => ({
      done: /表紙のアップロードに成功|アップロードに成功しました/.test(document.body.textContent || ''),
      err: /アップロードに失敗|正常にアップロードできませんでした|サポートされていないファイル|画像のサイズが小さ/.test(
        document.body.textContent || '',
      ),
    }));
    if (st.err) {
      await screenshot(page, stage, 'cover-err');
      throw new Error('cover upload error');
    }
    if (st.done) {
      await page.waitForTimeout(2500);
      return;
    }
    await page.waitForTimeout(3000);
  }
  await screenshot(page, stage, 'cover-timeout');
  throw new Error('cover upload timeout');
}

async function fillStep3(
  page: Page,
  b: KdpBookInput,
  stage: string,
  dryRun?: boolean,
): Promise<{ ok?: boolean; blocked?: string; dryRun?: boolean }> {
  await page.evaluate(() => {
    const lbl = (e: HTMLInputElement) => {
      const l = e.closest('label') || (e.id && document.querySelector('label[for="' + e.id + '"]'));
      return ((l ? l.textContent : e.parentElement ? e.parentElement.textContent : '') || '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const radios = [...document.querySelectorAll('input[type=radio]')] as HTMLInputElement[];
    let t = radios.find((r) => lbl(r).replace(/\s/g, '').includes('70%') && !lbl(r).includes('35'));
    if (!t) t = radios.find((r) => (r.value || '').replace(/\s/g, '') === '70' || (r.value || '').includes('royalty_70'));
    if (t && !t.checked) t.click();
  });
  await page.waitForTimeout(2500);
  const jpSel = 'input[name="data[digital][channels][amazon][JP][price_vat_inclusive]"]';
  await page.click(jpSel).catch(() => {});
  await page.fill(jpSel, '').catch(() => {});
  await page.type(jpSel, String(b.price_jpy || 550), { delay: 40 }).catch(() => {});
  await page.keyboard.press('Tab').catch(() => {});
  const bannerErr = () =>
    page.evaluate(() =>
      /続行するには[、,].{0,40}エラーを修正|強調表示されている項目のエラーを修正/.test(document.body.textContent || ''),
    );
  let converted = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    if (!(await bannerErr())) {
      await page.waitForTimeout(3000);
      if (!(await bannerErr())) {
        converted = true;
        break;
      }
    }
  }
  await screenshot(page, stage, 'step3-ready');
  if (dryRun) return { dryRun: true };
  if (!converted) {
    await screenshot(page, stage, 'step3-priceerr');
    return { blocked: 'price_not_set' };
  }
  await page.click('#save-and-publish-announce').catch(() => {});
  await page.waitForTimeout(5000);
  if (await bannerErr()) {
    await screenshot(page, stage, 'step3-publish-reverted');
    return { blocked: 'price_reverted_on_publish' };
  }
  await page.click('button:has-text("出版"):visible, #save-and-publish-announce:visible').catch(() => {});
  await page.waitForTimeout(8000);
  return { ok: true };
}

async function verifyPublished(page: Page, title: string): Promise<{ published: boolean; asin: string | null }> {
  await page.goto(BOOKSHELF, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(6000);
  const sb = await page
    .$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"], input[name*="search"]')
    .catch(() => null);
  if (sb) {
    await sb.fill('').catch(() => {});
    await sb.fill(title.slice(0, 14)).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(6000);
  }
  return page.evaluate((title: string) => {
    const key = title.slice(0, 10);
    const body = document.body.textContent || '';
    if (!body.includes(key)) return { published: false, asin: null };
    const m = body.match(/レビュー中|出版準備中|販売中|ライブ/);
    if (m) {
      const a = body.match(/\bB0[A-Z0-9]{8}\b/);
      return { published: true, asin: a ? a[0] : null };
    }
    return { published: false, asin: null };
  }, title);
}

async function screenshot(page: Page, stage: string, name: string): Promise<void> {
  await page.screenshot({ path: path.join(stage, name + '.png'), fullPage: true }).catch(() => {});
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
