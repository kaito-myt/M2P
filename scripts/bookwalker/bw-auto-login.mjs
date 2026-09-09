/**
 * BookWalker著者センター 自動ログイン + /books/new フォーム偵察 (READ-ONLY, 何も提出しない)。
 * 認証情報は env BW_EMAIL / BW_PASSWORD (.env.local から起動側が渡す。ファイルに書かない)。
 *   export $(grep -E '^BW_(EMAIL|PASSWORD)=' .env.local | tr -d '\r') && node scripts/bookwalker/bw-auto-login.mjs
 * CAPTCHA等で自動突破できない場合はスクショを残して待機(運営者が手動補助可)。
 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');
const OUT = path.join(REPO, 'scripts/bookwalker/out');

const EMAIL = process.env.BW_EMAIL, PASS = process.env.BW_PASSWORD;
if (!EMAIL || !PASS) { console.log('BW_EMAIL/BW_PASSWORD 未設定'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1400, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'],
});
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `bw-${n}.png`), fullPage: true }).catch(() => {});

await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
console.log('初期URL:', page.url());

// Cookie同意バナーがクリックを遮断する(2026-09-02実測) — 先に閉じる
async function dismissCookieBanner() {
  const done = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, a')].find((x) => /すべてのCookieを許可|必須のCookieのみ許可/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight));
    if (b) { b.click(); return (b.textContent || '').trim().slice(0, 30); }
    return null;
  });
  if (done) { console.log('Cookieバナー処理:', done); await page.waitForTimeout(2000); }
  return done;
}

// ログインフォームがあれば投入 (member.bookwalker.jp 共通ID想定)
async function tryLogin() {
  await dismissCookieBanner();
  const emailIn = await page.$('input[type=email], input[name*=mail], input[id*=mail], input[name=username]');
  const passIn = await page.$('input[type=password]');
  if (!emailIn || !passIn) return false;
  await emailIn.click(); await emailIn.fill(''); await emailIn.type(EMAIL, { delay: 30 });
  await passIn.click(); await passIn.fill(''); await passIn.type(PASS, { delay: 30 });
  await shot('login-filled');
  // 「ログインする」ボタンをテキストで特定(submit属性が無い実装に対応)
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, input[type=submit], a')].find((x) => /ログインする/.test((x.textContent || x.value || '')) && (x.offsetWidth || x.offsetHeight));
    if (b) { b.click(); return true; }
    return false;
  });
  if (!clicked) { const btn = await page.$('button[type=submit], input[type=submit]'); if (btn) await btn.click(); else await page.keyboard.press('Enter'); }
  await page.waitForTimeout(9000);
  console.log('ログイン送信後URL:', page.url());
  return true;
}

// ログインページへ誘導リンクがあるならクリック
if (!/books\/new/.test(page.url()) || (await page.$('input[type=password]'))) {
  const loginLink = await page.$('a[href*="login"], a:has-text("ログイン")');
  if (loginLink && !(await page.$('input[type=password]'))) { await loginLink.click().catch(() => {}); await page.waitForTimeout(6000); }
  for (let i = 0; i < 3; i++) {
    const did = await tryLogin();
    if (!did) break;
    if (!(await page.$('input[type=password]'))) break;
    console.log('パスワード欄が残存 — リトライ' + i);
    await shot('login-retry-' + i);
  }
}

// 2FA/CAPTCHA検知
const t = await page.evaluate(() => document.body.textContent || '');
if (/認証コード|CAPTCHA|画像認証|reCAPTCHA/i.test(t)) {
  console.log('!!! 追加認証(2FA/CAPTCHA)が要求されています — 手動補助が必要。ウィンドウで完了してください(最大15分待機)');
  await shot('captcha');
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(10000); if (!/認証コード|CAPTCHA|画像認証/i.test(await page.evaluate(() => document.body.textContent || ''))) break; }
}

// /books/new へ到達確認
await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
console.log('最終URL:', page.url());
await shot('books-new');
if (!/books\/new/.test(page.url())) { console.log('NOT_LOGGED_IN or 未登録(要: サークル/口座等の初期設定)'); await ctx.close(); process.exit(2); }

// フォーム全ダンプ (READ-ONLY)
const info = await page.evaluate(() => {
  const els = [];
  for (const el of document.querySelectorAll('input,select,textarea,button,[role=radio],[role=checkbox],[role=button]')) {
    const vis = !!(el.offsetWidth || el.offsetHeight);
    if (!vis) continue;
    const lab = el.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    els.push({ tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', id: el.id || '', name: el.getAttribute('name') || '', label: lab.slice(0, 60), value: el.type === 'password' ? '***' : (el.value || '').slice(0, 30), text: ['BUTTON', 'A'].includes(el.tagName) ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '' });
    if (els.length > 150) break;
  }
  const heads = [...document.querySelectorAll('h1,h2,h3,legend,label')].map((h) => h.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean).slice(0, 60);
  return { heads, els };
});
console.log('HEADINGS:', JSON.stringify(info.heads));
for (const e of info.els) console.log(JSON.stringify(e));
console.log('BW RECON DONE (何も提出していません)');
await ctx.close();
process.exit(0);
