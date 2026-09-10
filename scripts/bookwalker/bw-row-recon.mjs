/**
 * 本棚の特定書籍の行を実DOMで採取する（非破壊）。
 *   bash scripts/paperback/pb-env.sh node scripts/bookwalker/bw-row-recon.mjs <bwId|タイトル片>
 * 却下書籍の編集導線(href)やボタンを確定させるためのリコン。
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

const needle = process.argv[2];
if (!needle) { console.log('usage: bw-row-recon.mjs <bwId|タイトル片>'); process.exit(1); }

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT bw_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].bw_session_state_enc));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1400, height: 2400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();

let found = null;
for (let p = 1; p <= 12 && !found; p++) {
  await page.goto('https://author.bookwalker.jp/library/bookshelf?page=' + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2000);
  if (p === 1 && (await page.$('input[type=password]'))) { console.log('NOT_LOGGED_IN'); await browser.close(); process.exit(2); }
  found = await page.evaluate((nd) => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    // 行らしき要素を総当たりし、needle を含むものを返す
    for (const row of document.querySelectorAll('li,tr,article,div')) {
      const t = clean(row.textContent);
      if (!t || t.length > 600) continue;
      const hit = t.includes(nd) || row.querySelector(`[data-id="${nd}"]`);
      if (!hit) continue;
      // 行の中で最も内側のものを選ぶため、子に同じ hit があればスキップ
      const childHit = [...row.children].some((ch) => {
        const ct = clean(ch.textContent);
        return (ct.includes(nd) || ch.querySelector?.(`[data-id="${nd}"]`)) && ct.length < 600;
      });
      if (childHit) continue;
      return {
        page: location.href,
        text: t.slice(0, 240),
        links: [...row.querySelectorAll('a')].map((a) => ({
          href: a.getAttribute('href'), cls: clean(a.className).slice(0, 50),
          dataId: a.getAttribute('data-id'), text: clean(a.textContent).slice(0, 24),
        })),
        buttons: [...row.querySelectorAll('button,[role=button],.pure-button')].map((b) => ({
          cls: clean(b.className).slice(0, 50), text: clean(b.textContent).slice(0, 24),
          dataId: b.getAttribute('data-id'),
        })),
        html: row.innerHTML.replace(/\s+/g, ' ').slice(0, 900),
      };
    }
    return null;
  }, needle).catch(() => null);
}

console.log('===== ROW =====');
console.log(found ? JSON.stringify(found, null, 1) : '見つからず');
await browser.close();
