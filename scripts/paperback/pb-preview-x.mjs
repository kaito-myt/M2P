/** プレビューアー徹底可視化: 変換完了の実表示→全ボタン/バー→ページ送り→終了→content警告の残存確認 */
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
const shot = (n) => page.screenshot({ path: path.join(OUT, `pvx-${n}.png`), fullPage: false }).catch(() => {});
async function reauth() { if (!/\/ap\/signin/.test(page.url())) return; const pf = await page.waitForSelector('#ap_password', { timeout: 15000 }).catch(() => null); if (!pf) return; await pf.type(AMZ_PW, { delay: 35 }); await page.click('#signInSubmit'); await page.waitForTimeout(8000); const otp = await page.$('#auth-mfa-otpcode'); if (otp && TOTP) { const { authenticator } = req('otplib'); await otp.type(authenticator.generate(TOTP), { delay: 35 }); await page.click('#auth-signin-button').catch(() => page.keyboard.press('Enter')); await page.waitForTimeout(8000); } }
page.on('response', async (r) => { const m = r.request().method(); if (m === 'GET') return; const u = r.url(); if (/invite_code|percent_scrolled|unagi|metrics/.test(u)) return; console.log(`←${m} ${r.status()} ${u.replace(/https:\/\/[^/]+/, '')}`.slice(0, 110)); });

await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000); await reauth();
if (!/content/.test(page.url())) { await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
// 事前の警告状態
const warnBefore = await page.evaluate(() => /プレビューして確認してください|プレビューして承認/.test(document.body.textContent || ''));
console.log('警告(前):', warnBefore);
await page.locator('button, a').filter({ hasText: 'プレビューアーを起動' }).first().click({ force: true, timeout: 15000 });
console.log('起動(trusted)');
// 変換完了を「ページ範囲入力の隣の総数」で実表示確認(最大6分)
for (let i = 0; i < 36; i++) {
  await page.waitForTimeout(10000);
  const info = await page.evaluate(() => {
    const inp = document.querySelector('#cur_page_range');
    const near = inp ? (inp.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : null;
    const bottom = [...document.querySelectorAll('button, [role=button], a, input')].filter((b) => { const r = b.getBoundingClientRect(); return r.top > innerHeight - 220 && (b.offsetWidth || b.offsetHeight); }).map((b) => (b.textContent || b.value || b.placeholder || b.id || '').replace(/\s+/g, ' ').trim().slice(0, 28)).filter(Boolean);
    return { near, bottom: [...new Set(bottom)] };
  }).catch(() => ({}));
  console.log(`t=${i * 10}s near=${info.near} bottom=${JSON.stringify(info.bottom).slice(0, 220)}`);
  if (info.near && /\/\s*\d{2,}/.test(info.near)) { console.log('変換完了表示検出'); break; }
}
await shot('loaded');
// ページ送り(次ページ矢印/キー)を3回
for (let k = 0; k < 3; k++) { await page.keyboard.press('ArrowRight').catch(() => {}); await page.waitForTimeout(2000); }
console.log('ページ送り3回');
await shot('paged');
// 終了(trusted)
await page.locator('button, a, [role=button]').filter({ hasText: '印刷プレビューアーを終了' }).first().click({ force: true, timeout: 15000 }).catch((e) => console.log('exit err:', e.message.slice(0, 50)));
console.log('終了クリック');
await page.waitForTimeout(10000);
console.log('URL:', page.url());
const warnAfter = await page.evaluate(() => /プレビューして確認してください|プレビューして承認/.test(document.body.textContent || ''));
console.log('警告(後):', warnAfter, '← falseなら承認記録成功');
await shot('content-after');
console.log('PVX DONE');
await ctx.close();
process.exit(0);
