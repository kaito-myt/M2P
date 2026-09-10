/**
 * BW 編集画面の「シリーズ情報」欄を実DOMで採取する（非破壊・読み取りのみ）。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-series-recon.mjs <bwId>
 *
 * 却下理由「シリーズ作品とお見受けする作品において『シリーズ情報』が設定されていないため」への対応。
 * BW の案内では 作品編集画面下部の「シリーズ情報」を開き、シリーズ名と巻数を入力する。
 * その入力欄のセレクタを確定させるためのリコン。
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
if (!bwId) { console.log('usage: bw-series-recon.mjs <bwId>'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].bw_session_state_enc));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 2400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

// 先に本棚を開いてセッションを確立してから編集画面へ入る
// (いきなり /books/<id>/edit を叩くと本棚へリダイレクトされることがある)
await page.goto('https://author.bookwalker.jp/library/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
if (await page.$('input[type=password]')) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
await page.goto(`https://author.bookwalker.jp/books/${bwId}/edit`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
if (!/\/edit/.test(page.url()) || (await page.$('input[type=password]'))) {
  console.log('編集画面に入れず:', page.url().slice(0, 90));
  await browser.close();
  process.exit(3);
}

// 「シリーズ」を含む見出し/セクションを展開してから採取する（アコーディオンの可能性）
const opened = await page.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll('a,button,summary,h2,h3,div[role=button],legend')) {
    if (/シリーズ/.test(el.textContent || '') && (el.offsetWidth || el.offsetHeight)) { el.click(); n++; }
  }
  return n;
});
console.log('シリーズ見出しクリック:', opened);
await page.waitForTimeout(2500);

const diag = await page.evaluate(() => {
  const vis = (el) => !!(el.offsetWidth || el.offsetHeight);
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // 「シリーズ」を含むテキストの近傍にある入力欄を全部拾う
  const fields = [...document.querySelectorAll('input,select,textarea')].map((f) => ({
    tag: f.tagName, type: f.type, id: f.id, name: f.name, cls: clean(f.className).slice(0, 60),
    value: (f.value || '').slice(0, 40), visible: vis(f),
    label: clean(f.closest('label')?.textContent || f.labels?.[0]?.textContent
      || f.parentElement?.textContent || '').slice(0, 70),
  }));
  return {
    seriesFields: fields.filter((f) => /シリーズ|series|volume|巻/i.test(f.id + ' ' + f.name + ' ' + f.label)),
    allNames: fields.filter((f) => f.visible).map((f) => f.id || f.name).filter(Boolean).slice(0, 60),
    bodyHasSeries: (document.body.innerText || '').includes('シリーズ'),
  };
});
console.log('\n===== SERIES DIAG =====');
console.log(JSON.stringify(diag, null, 2));
await page.screenshot({ path: path.join(REPO, 'scripts/bookwalker/out', `series-recon-${bwId}.png`), fullPage: true }).catch(() => {});
console.log(`\nscreenshot: scripts/bookwalker/out/series-recon-${bwId}.png`);
await browser.close();
