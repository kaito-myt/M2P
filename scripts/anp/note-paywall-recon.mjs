/**
 * note エディタの「有料エリア指定」を挿入したときの DOM を採取する (F-ANP-47 の検出条件を確定するため)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-paywall-recon.mjs <note_article_id> [freeBlockCount]
 *
 * **保存/更新は一切しない**（挿入して DOM を読んだら閉じるだけ）ので、公開中の記事は変わらない。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const ARTICLE_ID = process.argv[2];
const AT = Number(process.argv[3] ?? 4);
if (!ARTICLE_ID) {
  console.error('usage: node scripts/anp/note-paywall-recon.mjs <note_article_id> [freeBlockCount]');
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(
  `SELECT a.note_url, acc.session_state_enc
     FROM note_articles a JOIN note_accounts acc ON acc.id = a.note_account_id
    WHERE a.id = $1`,
  [ARTICLE_ID],
);
await c.end();
if (!rows[0]) throw new Error('article not found');
const noteId = (rows[0].note_url.match(/\/n\/(n[0-9a-z]+)/i) ?? [])[1];
const state = JSON.parse(dec(rows[0].session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage', '--no-sandbox'],
});
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1300 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

const dump = () =>
  page.evaluate(() => {
    const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
    if (!root) return null;
    return [...root.children].map((el) => ({
      tag: el.tagName,
      cls: el.className || '',
      attrs: [...el.attributes].map((a) => a.name).join(','),
      text: (el.textContent || '').slice(0, 24),
    }));
  });

await page.goto(`https://editor.note.com/notes/${noteId}/edit/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(7000);
console.log('url:', page.url());

const before = await dump();
console.log('--- before:', before?.length, 'children');
for (const [i, n] of (before ?? []).entries()) console.log(i, n.tag, JSON.stringify(n.cls), n.attrs, n.text);

const spot = await page.evaluate((index) => {
  const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const kids = [...root.children].filter((el) => (el.textContent ?? '').trim().length > 0);
  const at = Math.min(Math.max(index, 1), kids.length - 1);
  kids[at].scrollIntoView({ block: 'center' });
  const r = kids[at].getBoundingClientRect();
  return { x: r.x + 6, y: r.y + Math.min(10, r.height / 2), at };
}, AT);
console.log('spot:', spot);

await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(800);
await page.keyboard.press('Home');
await page.waitForTimeout(300);

await page.evaluate(() => document.querySelector('button[aria-label="メニューを開く"]')?.click());
await page.waitForTimeout(600);
const clicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button,[role=button]')].find(
    (x) => (x.textContent || '').trim() === '有料エリア指定' && (x.offsetWidth || x.offsetHeight),
  );
  if (!el) return false;
  el.click();
  return true;
});
console.log('inserted:', clicked);
await page.waitForTimeout(2500);

const after = await dump();
console.log('--- after:', after?.length, 'children');
for (const [i, n] of (after ?? []).entries()) console.log(i, n.tag, JSON.stringify(n.cls), n.attrs, n.text);

const diff = await page.evaluate(() => {
  const root = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const el = [...root.children].find(
    (x) => /paid|paywall|separator|border/i.test(x.className || '') || x.tagName === 'HR',
  );
  return el ? el.outerHTML.slice(0, 600) : null;
});
console.log('--- candidate node:', diff);

await browser.close();
