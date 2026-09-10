/**
 * 却下書籍の編集導線を実DOMで特定する（非破壊）。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-edit-probe.mjs <bwId> [--headful]
 *
 * `/books/<id>/edit` が本棚へリダイレクトされる件の切り分け用。
 * bw-shelf-enum と同じ抽出（a.js-booksample[data-url] / a.js-bookviewer[data-url] を起点に
 * 親を7段まで遡って行ボックスを得る）で該当行を掴み、行内のリンク・ボタンを列挙する。
 */
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const REPO = 'C:/DEV/M2P';
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

function dec(b64) {
  const raw = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

const bwId = process.argv[2];
const HEADFUL = process.argv.includes('--headful');
if (!bwId) { console.log('usage: bw-edit-probe.mjs <bwId> [--headful]'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].bw_session_state_enc));

const browser = await chromium.launch({ headless: !HEADFUL, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 2400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

let row = null;
for (let p = 1; p <= 12 && !row; p++) {
  await page.goto('https://author.bookwalker.jp/library/bookshelf?page=' + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (p === 1 && (await page.$('input[type=password]'))) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
  row = await page.evaluate((id) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    for (const el of document.querySelectorAll('a.js-booksample[data-url],a.js-bookviewer[data-url]')) {
      const m = (el.getAttribute('data-url') || '').match(/\/books\/(\d+)/);
      if (!m || m[1] !== id) continue;
      let box = el;
      for (let i = 0; i < 7 && box.parentElement; i++) { box = box.parentElement; if (/円（税別）/.test(box.textContent || '')) break; }
      return {
        pageUrl: location.href,
        text: clean(box.textContent).slice(0, 300),
        links: [...box.querySelectorAll('a')].map((a) => ({
          href: a.getAttribute('href'), dataUrl: a.getAttribute('data-url'),
          cls: clean(a.className).slice(0, 46), text: clean(a.textContent).slice(0, 20),
        })),
        buttons: [...box.querySelectorAll('button,[role=button],.pure-button,input[type=submit]')]
          .map((b) => ({ cls: clean(b.className).slice(0, 46), text: clean(b.textContent || b.value).slice(0, 20) })),
      };
    }
    return null;
  }, bwId).catch(() => null);
}
console.log('===== 本棚の行 =====');
console.log(row ? JSON.stringify(row, null, 1) : '行が見つからず');

// 編集URLの候補を順に試して、どれが編集画面に入れるか確認する
for (const u of [`/books/${bwId}/edit`, `/books/${bwId}`, `/books/${bwId}/edit?from=bookshelf`]) {
  await page.goto('https://author.bookwalker.jp' + u, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);
  const has = await page.evaluate(() => ({
    url: location.href,
    title: !!document.querySelector('#book_main_title'),
    desc: !!document.querySelector('#book_description'),
    series: (document.body.innerText || '').includes('シリーズ'),
  }));
  console.log(`\n${u} → ${has.url.slice(0, 70)} title欄=${has.title} desc欄=${has.desc} シリーズ表記=${has.series}`);
  if (has.title) break;
}
await page.screenshot({ path: path.join(REPO, 'scripts/bookwalker/out', `edit-probe-${bwId}.png`), fullPage: true }).catch(() => {});
console.log(`\nscreenshot: scripts/bookwalker/out/edit-probe-${bwId}.png`);
if (HEADFUL) { console.log('headful: 30秒表示'); await page.waitForTimeout(30000); }
await browser.close();
