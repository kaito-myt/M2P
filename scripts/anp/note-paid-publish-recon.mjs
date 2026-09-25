/**
 * 公開済み記事を有料に切り替えるときの「公開設定」以降の画面を採取する (F-ANP-47)。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/anp/note-paid-publish-recon.mjs <note_article_id>
 *
 * 2026-09-25 実測: 記事タイプで「有料」を選ぶと、公開設定画面の主ボタンが
 * 「更新する」ではなく **「有料エリア設定」** になる。その先の画面を調べるための recon。
 * **最終的な投稿/更新ボタンは押さない**（ボタン一覧をダンプして終わる）。
 */
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

const ARTICLE_ID = process.argv[2];
if (!ARTICLE_ID) {
  console.error('usage: node scripts/anp/note-paid-publish-recon.mjs <note_article_id>');
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
const shot = (n) => page.screenshot({ path: path.join(OUT, `paid-recon-${n}.png`), fullPage: true }).catch(() => {});

const buttons = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('button,[role=button],a')]
      .filter((x) => x.offsetWidth || x.offsetHeight)
      .map((x) => (x.textContent || '').trim())
      .filter((t) => t.length > 0 && t.length < 30),
  );

const clickByText = (t) =>
  page.evaluate((text) => {
    const el = [...document.querySelectorAll('button,[role=button]')].find(
      (x) => (x.textContent || '').trim() === text && (x.offsetWidth || x.offsetHeight),
    );
    if (!el) return false;
    el.click();
    return true;
  }, t);

await page.goto(`https://editor.note.com/notes/${noteId}/edit/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(7000);
console.log('editor url:', page.url());
console.log(
  'paywall-line exists:',
  await page.evaluate(() => !!document.querySelector('div.ProseMirror[contenteditable="true"] paywall-line')),
);

// 本文を一度クリックしてエディタにフォーカスを入れる (これが無いと「公開に進む」が効かない)。
await page
  .locator('div.ProseMirror[contenteditable="true"] > *')
  .nth(2)
  .click({ position: { x: 6, y: 6 }, timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(1000);

console.log('進む:', await clickByText('公開に進む'));
await page.waitForTimeout(12000);
await shot('after-proceed');
console.log('settings url:', page.url());
console.log('settings buttons:', JSON.stringify(await buttons()));

// 記事タイプ「有料」を trusted click。
const box = await page.evaluate(() => {
  const input = document.querySelector('#paid');
  if (!input) return null;
  let node = input;
  for (let i = 0; i < 6 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    if (node.tagName === 'LABEL' || getComputedStyle(node).cursor === 'pointer') break;
  }
  const r = (node ?? input).getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + Math.min(20, r.height / 2) };
});
if (box) await page.mouse.click(box.x, box.y);
await page.waitForTimeout(4000);
console.log('after paid buttons:', JSON.stringify(await buttons()));
await shot('settings');

// 価格を入れてから有料エリア設定へ。
for (const sel of ['input[name="price"]', 'input#price', 'input[type="number"]']) {
  const loc = page.locator(sel).first();
  if ((await loc.count().catch(() => 0)) && (await loc.isVisible().catch(() => false))) {
    await loc.click().catch(() => {});
    await loc.fill('680').catch(() => {});
    console.log('price filled via', sel, await loc.inputValue().catch(() => ''));
    break;
  }
}
await page.waitForTimeout(1500);

console.log('有料エリア設定:', await clickByText('有料エリア設定'));
await page.waitForTimeout(10000);
console.log('next url:', page.url());
console.log('next buttons:', JSON.stringify(await buttons()));
console.log(
  'next text head:',
  (await page.locator('body').innerText().catch(() => '')).slice(0, 700).replace(/\n{2,}/g, '\n'),
);
await shot('paidarea');

await browser.close();
