import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/anp/out');

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("select session_state_enc from note_accounts where id='note-acc-1'");
await c.end();
const state = JSON.parse(dec(r.rows[0].session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon7-${n}.png`), fullPage: true }).catch(() => {});

await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
console.log('url:', page.url());
await page.fill('textarea[placeholder="記事タイトル"]', '(recon7) プラスメニュー確認').catch(() => {});
const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
await body.click().catch(() => {});
await page.waitForTimeout(1000);
await shot('before-open');

const before = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim()==='画像' && (b.offsetWidth||b.offsetHeight)).length);
console.log('画像ボタン visible count (before):', before);

const opened = await page.click('button[aria-label="メニューを開く"]').then(()=>true).catch((e)=>{console.log('click err',e.message); return false;});
console.log('clicked メニューを開く:', opened);
await page.waitForTimeout(1500);
await shot('after-open');

const after = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => (b.textContent||'').trim()==='画像' && (b.offsetWidth||b.offsetHeight)).length);
console.log('画像ボタン visible count (after):', after);

const items = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => (b.offsetWidth||b.offsetHeight) && /^(画像|大見出し|小見出し|箇条書きリスト|有料エリア指定)$/.test((b.textContent||'').trim())).map(b => (b.textContent||'').trim()));
console.log('見つかった項目:', JSON.stringify(items));

await browser.close();
