import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
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
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon5-${n}.png`), fullPage: true }).catch(() => {});

await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);

// #paid の祖先で clickable そうな要素(labelかbutton or div[role])を探して座標クリック
const box = await page.evaluate(() => {
  const input = document.querySelector('#paid');
  let node = input;
  for (let i = 0; i < 6 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const cs = getComputedStyle(node);
    if (cs.cursor === 'pointer' || node.tagName === 'LABEL' || node.getAttribute('role')) break;
  }
  const target = node || input;
  const r = target.getBoundingClientRect();
  return { tag: target.tagName, cls: (target.className || '').toString().slice(0,80), x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log('click target box:', JSON.stringify(box));
if (box && box.w > 0 && box.h > 0) {
  await page.mouse.click(box.x + box.w / 2, box.y + Math.min(20, box.h / 2));
}
await page.waitForTimeout(2500);
await shot('after-click');

const checked = await page.evaluate(() => document.querySelector('#paid')?.checked);
console.log('paid checked?', checked);

const dump = await page.evaluate(() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const el = (e) => ({ tag: e.tagName, id: e.id, name: e.getAttribute('name'), type: e.getAttribute('type'), ph: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'), text: clean(e.textContent).slice(0,60), visible: vis(e) });
  return {
    inputs: [...document.querySelectorAll('input,textarea,select')].filter(vis).map(el),
    bodyHead: clean(document.body.innerText).slice(0, 2000),
  };
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
