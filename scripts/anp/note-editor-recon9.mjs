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
const shot = (n) => page.screenshot({ path: path.join(OUT, `recon9-${n}.png`), fullPage: true }).catch(() => {});

function clickByText(text) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(
      (x) => (x.textContent || '').trim() === t && (x.offsetWidth || x.offsetHeight),
    );
    if (!el) return { found: false };
    el.click();
    return { found: true };
  }, text);
}

await page.goto('https://note.com/notes/new', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(8000);
await page.fill('textarea[placeholder="記事タイトル"]', '(recon9) 箇条書き/画像/有料ライン検証').catch(() => {});
const body = page.locator('div.ProseMirror[contenteditable="true"]').first();
await body.click().catch(() => {});
await page.waitForTimeout(800);

// 最初の段落に普通のテキストを書いてEnter(新しい空段落を作る、これがtypeBlockの各ブロック開始時の状態と同じ)
await page.keyboard.type('通常の段落テキストです。', { delay: 8 });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);

// メニューを開かずに箇条書きリストを試す
const bulletResult = await clickByText('箇条書きリスト');
console.log('箇条書きリスト(メニュー未オープン) clickByText結果:', JSON.stringify(bulletResult));
await page.waitForTimeout(500);
await page.keyboard.type('項目1', { delay: 8 });
await page.waitForTimeout(300);
await shot('after-bullet-attempt');

let structure = await page.evaluate(() => [...document.querySelector('div.ProseMirror[contenteditable="true"]').children].map(c => ({tag:c.tagName, text:(c.textContent||'').slice(0,30)})));
console.log('段階1 DOM構造:', JSON.stringify(structure));

// 新しい段落へ
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

// メニューを開かずに画像を試す(filechooserが開くはずなのでtimeoutで確認するだけ、実際は選択しない)
const fcPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
const imgResult = await clickByText('画像');
console.log('画像(メニュー未オープン) clickByText結果:', JSON.stringify(imgResult));
const fc = await fcPromise;
console.log('filechooser 発火:', !!fc);
await shot('after-image-attempt');
if (fc) await page.keyboard.press('Escape').catch(()=>{});

structure = await page.evaluate(() => [...document.querySelector('div.ProseMirror[contenteditable="true"]').children].map(c => ({tag:c.tagName, cls:(c.className||'').slice(0,30), text:(c.textContent||'').slice(0,30)})));
console.log('最終 DOM構造:', JSON.stringify(structure, null, 1));

await browser.close();
