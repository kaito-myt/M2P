/** content「保存して続行」クリック後のインラインエラー/未完要素を採取(真のブロッカー特定) */
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
await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000); await reauth();
if (!/content/.test(page.url())) { await page.goto(`https://kdp.amazon.co.jp/print-setup/paperback/${titleId}/content`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000); }
console.log('content URL:', page.url());
// 保存して続行(遷移は待たずに残留エラーを見る)
await page.evaluate(() => { const b = document.querySelector('#save-and-continue-announce') || [...document.querySelectorAll('button')].find((x) => /保存して続行/.test(x.textContent || '')); if (b) b.click(); });
console.log('保存して続行クリック');
await page.waitForTimeout(12000);
console.log('クリック後URL:', page.url());
const diag = await page.evaluate(() => {
  const vis = (e) => e.offsetWidth || e.offsetHeight;
  const errs = [...document.querySelectorAll('.a-alert-error, .a-alert-warning, [class*=error]')].filter((e) => vis(e) && e.children.length < 6).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 130)).filter((t) => t && !/placeholder|エラーはありません/.test(t));
  // 未チェックの可視チェックボックス(確認系)
  const unchecked = [...document.querySelectorAll('input[type=checkbox], [role=checkbox]')].filter((c) => vis(c) && !(c.checked || c.getAttribute('aria-checked') === 'true')).map((c) => { const l = c.closest('label')?.textContent || (c.id && document.querySelector(`label[for="${c.id}"]`)?.textContent) || c.getAttribute('aria-label') || ''; return l.replace(/\s+/g, ' ').trim().slice(0, 70); }).filter(Boolean);
  // 未選択のradioグループ
  const groups = {};
  for (const r of document.querySelectorAll('input[type=radio]')) { if (!vis(r)) continue; const n = r.name || 'x'; groups[n] = groups[n] || { any: false }; if (r.checked) groups[n].any = true; }
  const unsel = Object.entries(groups).filter(([, v]) => !v.any).map(([k]) => k);
  return { errs: [...new Set(errs)].slice(0, 12), unchecked: [...new Set(unchecked)].slice(0, 12), unselectedRadioGroups: unsel };
});
console.log('=== 保存後エラー ===', JSON.stringify(diag.errs, null, 1));
console.log('=== 未チェックbox ===', JSON.stringify(diag.unchecked, null, 1));
console.log('=== 未選択radio群 ===', JSON.stringify(diag.unselectedRadioGroups));
await page.screenshot({ path: path.join(OUT, 'diagsave.png'), fullPage: true }).catch(() => {});
console.log('DIAGSAVE DONE');
await ctx.close();
process.exit(0);
