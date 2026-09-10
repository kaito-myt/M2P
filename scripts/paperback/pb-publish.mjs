/**
 * ペーパーバック出版 (既存下書きの価格設定→出版)。
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-publish.mjs <bookId> <titleId> [--go]
 * 既定はdry-run(価格入力まで・出版ボタンは押さない)。--go で「ペーパーバック本を出版」をクリック。
 * 価格: plan.json の頁数から印刷費(¥206+頁×¥2.06)を概算し、最低価格(印刷費/0.6)+マージンで決定(下限¥1,480)。
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { paperbackPrice, priceSummary } from './pb-price.mjs';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');

const bookId = process.argv[2];
const titleId = process.argv[3];
const GO = process.argv.includes('--go');
if (!bookId || !titleId) { console.log('usage: pb-publish.mjs <bookId> <titleId> [--go]'); process.exit(1); }
const plan = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/paperback/plan.json'), 'utf8'));
const p = plan.find((x) => x.book_id === bookId);
const pages = p?.pages || 200;
const price = paperbackPrice(pages);
console.log(priceSummary(pages));

const AMZ_PW = process.env.AMAZON_PASSWORD, TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (n) => page.screenshot({ path: path.join(OUT, `pbpub-${n}.png`), fullPage: true }).catch(() => {});
async function passReauth(label) {
  if (!/\/ap\/signin/.test(page.url())) return true;
  console.log(`再認証(${label})`);
  const pf = await page.waitForSelector('#ap_password', { timeout: 20000 }).catch(() => null);
  if (!pf || !AMZ_PW) return false;
  await pf.click(); await pf.fill(''); await pf.type(AMZ_PW, { delay: 35 });
  await page.check('#auth-remember-me').catch(() => {});
  await page.click('#signInSubmit'); await page.waitForTimeout(9000);
  const otp = await page.$('#auth-mfa-otpcode');
  if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.check('#auth-mfa-remember-device').catch(() => {}); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(9000); console.log('TOTP送信'); }
  return !/\/ap\/signin/.test(page.url());
}

const PRICING = `https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/pricing`;
await page.goto(PRICING, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await passReauth('pricing直行');
if (!/pricing/.test(page.url())) { await page.goto(PRICING, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
console.log('URL:', page.url());
if (!/pricing/.test(page.url())) { console.log('pricingに入れない'); await shot('noprice'); await ctx.close(); process.exit(2); }

// JP価格を実タイプ+Tab(fillだけだと換算がコミットされない — Kindle STEP3と同じ罠)
const jp = await page.waitForSelector('#price-input-jpy', { timeout: 30000 });
await jp.click({ force: true, timeout: 10000 }).catch(() => {});
await jp.fill('').catch(() => {});
await jp.type(String(price), { delay: 40 });
await page.keyboard.press('Tab');
await page.waitForTimeout(3000);
// 他マーケットプレイスをJP基準で自動換算
const baseClicks = await page.evaluate(() => {
  let n = 0;
  for (const a of document.querySelectorAll('a')) { if (/この価格をAmazon\.co\.jpの基準とする/.test(a.textContent || '') && (a.offsetWidth || a.offsetHeight)) { a.click(); n++; } }
  return n;
});
console.log('基準換算クリック:', baseClicks, '市場');
await page.waitForTimeout(4000);
// エラーバナー確認(最低価格未満など)
const errs = await page.evaluate(() => [...document.querySelectorAll('.a-alert-error, [class*=error]')].filter((e) => (e.offsetWidth || e.offsetHeight) && /エラー|最低|未満|修正/.test(e.textContent || '')).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 120)));
if (errs.length) console.log('価格エラー:', JSON.stringify([...new Set(errs)]));
await shot('priced');

if (!GO) { console.log('DRY-RUN: 出版ボタンは押さず終了'); await ctx.close(); process.exit(0); }

// 出版クリック
console.log('「ペーパーバック本を出版」クリック...');
const pubBtn = page.locator('button').filter({ hasText: 'ペーパーバック本を出版' }).first();
await pubBtn.scrollIntoViewIfNeeded().catch(() => {});
await pubBtn.click({ force: true, timeout: 15000 }).catch(async (e) => { console.log('出版クリック失敗:', e.message.slice(0, 60)); await shot('pubfail'); });
await page.waitForTimeout(10000);
await passReauth('出版後');
await page.waitForTimeout(5000);
const state = await page.evaluate(() => {
  const t = document.body.textContent || '';
  return { url: location.href, review: /レビュー中|審査|出版準備中|提出/.test(t), limit: /本の作成数制限|提出可能な本の数/.test(t) && !!document.querySelector('[role=dialog]') };
});
console.log('出版後:', JSON.stringify(state));
await shot('published');
console.log(state.review ? '✅ PAPERBACK SUBMITTED' : '⚠ 出版確認できず(スクショ確認要)');
await ctx.close();
process.exit(state.review ? 0 : 4);
