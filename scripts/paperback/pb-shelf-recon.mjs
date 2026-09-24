/**
 * F-097b: KDP 本棚でペーパーバック行がどう見えるかの READ-ONLY 偵察。
 * 「出版したはずのペーパーバックが実際に販売中になっているか」を DB へ同期する
 * (`paperback.status.sync`) ための実 DOM 調査。状態変更操作は一切行わない。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/paperback/pb-shelf-recon.mjs "<書名の一部>"
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const QUERY = process.argv[2];
if (!QUERY) {
  console.log('usage: pb-shelf-recon.mjs "<書名の一部>"');
  process.exit(1);
}

function dec(b64, keyHex) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(
  "select kdp_session_state_enc from accounts where status='active' and kdp_session_state_enc is not null order by created_at limit 1",
);
await c.end();
if (!rows[0]) {
  console.log('KDP セッションが保存されていません');
  process.exit(1);
}
const state = JSON.parse(dec(rows[0].kdp_session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1100 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(6000);
console.log('url:', page.url());
if (/\/ap\/signin|\/signin/i.test(page.url())) {
  console.log('セッション失効');
  await browser.close();
  process.exit(2);
}

const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
if (!sb) {
  console.log('検索ボックスが見つからない');
  await browser.close();
  process.exit(3);
}
await sb.fill(QUERY);
await page.keyboard.press('Enter');
await page.waitForTimeout(6000);

// 1) ステータス文言を持つ要素から行コンテナを辿る
const rowsText = await page.evaluate(() => {
  const STATUS = /(販売中|下書き|レビュー中|ブロック|保留中|草稿)/;
  const hits = [...document.querySelectorAll('div,span,td,li')].filter(
    (e) => STATUS.test(e.textContent ?? '') && (e.children.length === 0 || (e.textContent ?? '').length < 30),
  );
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    let node = h;
    for (let i = 0; i < 8 && node; i += 1) {
      const t = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (t.length > 60 && /ASIN|ペーパーバック|電子書籍/.test(t)) {
        if (!seen.has(t.slice(0, 120))) {
          seen.add(t.slice(0, 120));
          out.push({ status: (h.textContent ?? '').trim().slice(0, 20), row: t.slice(0, 300) });
        }
        break;
      }
      node = node.parentElement;
    }
  }
  return out;
});
console.log(`--- status rows (${rowsText.length}) ---`);
for (const [i, r] of rowsText.entries()) console.log(`[${i}] status=${JSON.stringify(r.status)} :: ${r.row}`);

// 2) 「ペーパーバック」という語を含む行の生テキストも見る
const pbRows = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div,li,tr')) {
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t.length > 40 && t.length < 400 && /ペーパーバック|紙書籍/.test(t) && !/詳細情報の編集/.test(t)) out.push(t.slice(0, 260));
  }
  return [...new Set(out)].slice(0, 8);
});
console.log(`--- paperback-ish rows (${pbRows.length}) ---`);
for (const [i, t] of pbRows.entries()) console.log(`[${i}] ${t}`);
await browser.close();
