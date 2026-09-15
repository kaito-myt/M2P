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
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon8-${n}.png`), fullPage: true }).catch(() => {});

function clickByText(text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(
      (x) => (x.textContent || '').trim() === t && (x.offsetWidth || x.offsetHeight),
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);
}

await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
await page.fill('textarea[placeholder="記事タイトル"]', '(recon8) 見出しクリック検証').catch(() => {});
const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
await body.click().catch(() => {});
await page.waitForTimeout(800);

// パターンA: メニューを開かず直接「大見出し」をクリック→タイプ
const clickedA = await clickByText('大見出し');
console.log('パターンA clickByText(大見出し) 戻り値:', clickedA);
await page.waitForTimeout(500);
await page.keyboard.type('これは大見出しのはず(パターンA)', { delay: 10 });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await shot('pattern-a-after-type');

// パターンB: 「メニューを開く」→「小見出し」をクリック→タイプ
const openedB = await page.click('button[aria-label="メニューを開く"]').then(()=>true).catch(()=>false);
console.log('パターンB メニューを開く:', openedB);
await page.waitForTimeout(800);
const clickedB = await clickByText('小見出し');
console.log('パターンB clickByText(小見出し) 戻り値:', clickedB);
await page.waitForTimeout(500);
await page.keyboard.type('これは小見出しのはず(パターンB)', { delay: 10 });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await shot('pattern-b-after-type');

// DOM構造で見出しタグになっているか確認
const structure = await page.evaluate(() => {
  const body = document.querySelector('div.ProseMirror[contenteditable="true"]');
  return [...body.children].map(c => ({ tag: c.tagName, cls: (c.className||'').toString().slice(0,40), text: (c.textContent||'').slice(0,40) }));
});
console.log('本文DOM構造:', JSON.stringify(structure, null, 1));

await browser.close();
