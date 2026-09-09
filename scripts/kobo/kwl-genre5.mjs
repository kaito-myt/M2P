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
const rq = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(rq.rows[0].kobo_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

// ジャンル関連のフォーム内部フィールド(hidden含む)を全ダンプ
const genreFields = () => page.evaluate(() => [...document.querySelectorAll('input,select')].filter((e) => /categor|genre|bisac|subject|ジャンル/i.test(e.name || e.getAttribute('aria-label') || '')).map((e) => ({ name: e.name, type: e.type, val: e.value })));
console.log('初期ジャンルfield:', JSON.stringify(await genreFields()));

// トップ「ビジネス・経済・就職」→ 一般
await page.getByText(/^ビジネス・経済・就職\s*›?\s*$/).first().click({ force: true }).catch((e) => console.log('top err', e.message.slice(0, 30)));
await page.waitForTimeout(2000);
// 展開後の「一般」(または最初のサブ)をクリック
const ippan = page.getByText('一般', { exact: true });
const n = await ippan.count().catch(() => 0);
console.log('「一般」候補数:', n);
if (n) { await ippan.first().click({ force: true }).catch((e) => console.log('ippan err', e.message.slice(0, 30))); await page.waitForTimeout(2000); }
console.log('選択後ジャンルfield:', JSON.stringify(await genreFields()));
// ご選択のジャンル パネルの全テキスト
const panel = await page.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find((e) => /ご選択のジャンル/.test(e.textContent || '') && (e.textContent || '').length < 400);
  return h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '?';
});
console.log('選択パネル:', JSON.stringify(panel));
// 出版ボタン押下→エラー消えるか
await page.getByText('出版する', { exact: true }).first().click({ force: true, noWaitAfter: true }).catch(() => {});
await page.waitForTimeout(3000);
const stillErr = await page.evaluate(() => (document.body.innerText || '').includes('ジャンルを 1 つ以上ご選択ください') || /①.*ジャンル/.test(document.body.innerText || ''));
console.log('出版後まだジャンルエラー:', stillErr);
await page.screenshot({ path: path.join(REPO, 'scripts/kobo/out/genre5.png'), fullPage: true }).catch(() => {});
await browser.close();
process.exit(0);
