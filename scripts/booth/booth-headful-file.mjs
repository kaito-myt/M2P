/** ヘッドフルで「ファイルの追加・管理」を開き、file input / filechooser / モーダル内容を検証。 */
import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64) { const raw = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT booth_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].booth_session_state_enc));
const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
let fcSeen = false;
page.on('filechooser', () => { fcSeen = true; });
await page.goto('https://manage.booth.pm/items/8804766/edit', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.getByText('ファイルの追加・管理', { exact: false }).first().click({ force: true }).catch(() => {});
await page.waitForTimeout(6000);
const m = await page.evaluate(() => {
  const modal = document.querySelector('.booth-modal');
  const files = [...document.querySelectorAll('input[type=file]')].map((f) => ({ accept: (f.accept || '').slice(0, 30), display: getComputedStyle(f).display }));
  return { modalText: modal ? (modal.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200) : '(no booth-modal)', modalHtml: modal ? modal.innerHTML.slice(0, 300) : '', files, iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).filter((s) => s && !/recaptcha|google/.test(s)) };
});
console.log('モーダルtext:', m.modalText);
console.log('モーダルHTML冒頭:', m.modalHtml.replace(/\s+/g, ' '));
console.log('file input:', JSON.stringify(m.files));
console.log('非recaptcha iframe:', JSON.stringify(m.iframes));
console.log('filechooser(モーダル開いた時点):', fcSeen);
// モーダル内の「ファイルを選択」等をクリックしてfilechooser誘発
for (const t of ['ファイルを選択', 'ファイルを追加', 'アップロード', '参照', 'デバイスから選択', 'ここに']) {
  const b = page.getByText(t, { exact: false }).first();
  if (await b.count().catch(() => 0)) {
    try { await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }).then(() => console.log('★filechooser誘発ボタン:', t)), b.click({ force: true })]); break; }
    catch { console.log('  「' + t + '」ではfilechooser出ず'); }
  }
}
await page.screenshot({ path: path.join(REPO, 'scripts/booth/out/headful-modal.png'), fullPage: false }).catch(() => {});
await browser.close();
process.exit(0);
