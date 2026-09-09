/** 既存下書きのSTEP3(価格)を直接開いてフォーム/出版ボタンのセレクタを採取(READ-ONLY, 出版しない) */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');
const titleId = process.argv[2] || 'TN2S3HGG343';

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
const AMZ_PW = process.env.AMAZON_PASSWORD, TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
async function passReauth() {
  if (!/\/ap\/signin/.test(page.url())) return;
  const pf = await page.$('#ap_password'); if (!pf || !AMZ_PW) return;
  await pf.type(AMZ_PW, { delay: 35 }); await page.click('#signInSubmit'); await page.waitForTimeout(8000);
  const otp = await page.$('#auth-mfa-otpcode');
  if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(8000); }
}
await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/pricing`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
await passReauth();
if (!/pricing/.test(page.url())) { await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/pricing`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
console.log('URL:', page.url());
const info = await page.evaluate(() => {
  const els = [];
  for (const el of document.querySelectorAll('input,select,textarea,button,[role=radio],[role=checkbox],[role=button]')) {
    if (!(el.offsetWidth || el.offsetHeight)) continue;
    const lab = el.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    els.push({ tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', id: el.id || '', name: el.getAttribute('name') || '', label: lab.slice(0, 55), value: (el.value || '').slice(0, 30), text: ['BUTTON', 'A'].includes(el.tagName) ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '' });
    if (els.length > 120) break;
  }
  const priceText = (document.body.textContent.match(/(印刷費|最低[価]|ロイヤリティ|希望小売価格)[^\n。]{0,50}/g) || []).slice(0, 12);
  return { els, priceText };
});
console.log('価格文言:', JSON.stringify(info.priceText));
for (const e of info.els) console.log(JSON.stringify(e));
await page.screenshot({ path: path.join(OUT, 'pb-step3.png'), fullPage: true }).catch(() => {});
console.log('STEP3 RECON DONE');
await ctx.close();
process.exit(0);
