/** 「以前のページに問題」の真因診断: previewerの全ボタン + details/content の可視エラーを採取(READ-ONLY) */
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
const shot = (n) => page.screenshot({ path: path.join(OUT, `diagblk-${n}.png`), fullPage: true }).catch(() => {});
async function reauth() { if (!/\/ap\/signin/.test(page.url())) return; const pf = await page.waitForSelector('#ap_password', { timeout: 15000 }).catch(() => null); if (!pf) return; await pf.type(AMZ_PW, { delay: 35 }); await page.click('#signInSubmit'); await page.waitForTimeout(8000); const otp = await page.$('#auth-mfa-otpcode'); if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(8000); } }

// 1) details ページの可視エラー
await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/details`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000); await reauth();
if (!/details/.test(page.url())) { await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/details`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(7000); }
const dErr = await page.evaluate(() => {
  const errs = [...document.querySelectorAll('.a-alert-error, [class*=error]')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.children.length < 4).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 110)).filter((t) => t && !/placeholder/.test(t));
  return [...new Set(errs)].slice(0, 10);
});
console.log('=== details可視エラー ===', JSON.stringify(dErr, null, 1));
await shot('details');

// 2) content ページの可視エラー/未完アイコン
await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000); await reauth();
const cInfo = await page.evaluate(() => {
  const errs = [...document.querySelectorAll('.a-alert-error, [class*=error], [class*=warning]')].filter((e) => (e.offsetWidth || e.offsetHeight) && e.children.length < 4).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 110)).filter((t) => t && !/placeholder/.test(t));
  const secs = [...document.querySelectorAll('h2, h3')].map((h) => { const sec = h.closest('div'); const t = sec?.textContent || ''; return { h: h.textContent.trim().slice(0, 30), bad: /エラー|問題|必須|未完了/.test(t) }; }).filter((x) => x.h);
  return { errs: [...new Set(errs)].slice(0, 10), secs: secs.slice(0, 15) };
});
console.log('=== content可視エラー ===', JSON.stringify(cInfo.errs, null, 1));
await shot('content');

// 3) previewer の全可視ボタン/リンク実名
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].find((x) => /プレビューアーを起動/.test(x.textContent || '') && (x.offsetWidth || x.offsetHeight)); if (b) b.click(); });
console.log('previewer起動...');
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => ({
    url: location.href,
    btns: [...document.querySelectorAll('button, a, input[type=submit], [role=button]')].filter((b) => b.offsetWidth || b.offsetHeight).map((b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean),
  })).catch(() => null);
  if (!info) continue;
  if (i % 3 === 0) console.log(`t=${i * 10}s btns:`, JSON.stringify([...new Set(info.btns)]).slice(0, 500));
  if (info.btns.some((b) => /終了|承認/.test(b)) && i >= 6) break;
}
await shot('previewer');
console.log('DIAGBLK DONE');
await ctx.close();
process.exit(0);
