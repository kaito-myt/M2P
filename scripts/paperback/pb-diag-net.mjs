/** content「保存して続行」時のネットワークPOST/レスポンスを捕捉し、サーバー側の拒否理由を特定 */
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
const AMZ_PW = process.env.AMAZON_PASSWORD, TOTP = (process.env.AMAZON_TOTP_SECRET || '').replace(/[\s-]/g, '');
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1760, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
async function reauth() { if (!/\/ap\/signin/.test(page.url())) return; const pf = await page.waitForSelector('#ap_password', { timeout: 15000 }).catch(() => null); if (!pf) return; await pf.type(AMZ_PW, { delay: 35 }); await page.click('#signInSubmit'); await page.waitForTimeout(8000); const otp = await page.$('#auth-mfa-otpcode'); if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(8000); } }

page.on('response', async (r) => {
  const rq = r.request();
  if (rq.method() === 'GET') return;
  const u = r.url();
  if (/invite_code|percent_scrolled|unagi|metrics|\.(js|css|png|gif|woff)/.test(u)) return;
  let snippet = '';
  try { const t = await r.text(); snippet = t.replace(/\s+/g, ' ').slice(0, 300); } catch {}
  console.log(`←${rq.method()} ${r.status()} ${u.replace('https://kdp.amazon.co.jp', '')}`.slice(0, 120));
  if (snippet) console.log('   body:', snippet.slice(0, 250));
});

await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000); await reauth();
if (!/content/.test(page.url())) { await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
console.log('=== 保存して続行(trusted)クリック ===');
const btn = page.locator('#save-and-continue-announce, button:has-text("保存して続行")').first();
await btn.click({ force: true, timeout: 15000 }).catch((e) => console.log('click err:', e.message.slice(0, 50)));
await page.waitForTimeout(15000);
console.log('最終URL:', page.url());
console.log('DIAGNET DONE');
await ctx.close();
process.exit(0);
