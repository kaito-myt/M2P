/**
 * note 本文「+」挿入ボタンの実DOM偵察 (第6回)。空の段落に表示される "+" ボタンのセレクタを採取する。
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
fs.mkdirSync(OUT, { recursive: true });

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
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon6-${n}.png`), fullPage: true }).catch(() => {});

await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
console.log('url:', page.url());
await shot('empty-initial');

// タイトルだけ埋めて本文にフォーカス(空のまま)
await page.fill('textarea[placeholder="記事タイトル"]', '(recon6) プラスボタン採取用').catch(() => {});
const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
await body.click().catch(() => {});
await page.waitForTimeout(1500);
await shot('body-focused-empty');

const dump = await page.evaluate(() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const el = (e) => ({
    tag: e.tagName, id: e.id, cls: clean((e.className||'').toString()).slice(0,90),
    aria: e.getAttribute('aria-label'), role: e.getAttribute('role'),
    text: clean(e.textContent).slice(0,30), visible: vis(e), rect: rect(e),
  });
  // ProseMirror 本文の左側 200px 以内にある候補ボタン/divをすべて拾う
  const bodyEl = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const bodyRect = bodyEl.getBoundingClientRect();
  const candidates = [...document.querySelectorAll('button,[role=button],div[class*=plus],div[class*=Plus],div[class*=insert],div[class*=Insert]')]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.x < bodyRect.x && r.x > bodyRect.x - 120 && Math.abs(r.y - bodyRect.y) < 100 && vis(e);
    })
    .map(el);
  return { bodyRect: rect(bodyEl), candidates, allButtonsNear: [...document.querySelectorAll('button,[role=button]')].filter(vis).map(el).filter(b => Math.abs(b.rect.y - bodyRect.y) < 60) };
});
console.log(JSON.stringify(dump, null, 1));
await browser.close();
