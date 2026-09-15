/**
 * note 公開設定画面「有料」選択後の価格/ライン欄セレクタ偵察 (第4回)。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/anp/out');

const publishUrl = process.argv[2] || 'https://editor.note.com/notes/n9c510facf4dc/publish/';

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
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon4-${n}.png`), fullPage: true }).catch(() => {});

await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);

await page.evaluate(() => { const el = document.querySelector('#paid'); if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('click', { bubbles: true })); const label = el.closest('label') || document.querySelector('label[for="paid"]'); if (label) label.click(); } });
await page.waitForTimeout(2500);
await shot('paid-selected');

const dump = await page.evaluate(() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const el = (e) => ({
    tag: e.tagName, id: e.id, name: e.getAttribute('name'), type: e.getAttribute('type'),
    ph: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'),
    text: clean(e.textContent).slice(0, 60), visible: vis(e),
  });
  return {
    inputs: [...document.querySelectorAll('input,textarea,select')].filter(vis).map(el),
    bodyHead: clean(document.body.innerText).slice(0, 1500),
  };
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
