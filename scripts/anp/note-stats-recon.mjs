// note ダッシュボード(統計/フォロワー数)の実DOM偵察 (F-ANP-40, 非破壊・READ-ONLY)。
//   bash scripts/anp/note-stats-recon.sh
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
const r = await c.query("select id, handle, session_state_enc from note_accounts where id='note-acc-1'");
await c.end();
if (!r.rows[0]?.session_state_enc) {
  console.log('no session for note-acc-1');
  process.exit(1);
}
const state = JSON.parse(dec(r.rows[0].session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: path.join(OUT, `stats-recon-${n}.png`), fullPage: true }).catch(() => {});

// 1. トップの統計ページ (ダッシュボード)
await page.goto('https://note.com/sitesettings/stats', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto stats err', e.message));
await page.waitForTimeout(4000);
console.log('url after /sitesettings/stats:', page.url());
await shot('01-stats-top');
console.log('title:', await page.title());
console.log('logged-in check (has password field?)', !!(await page.$('input[type=password]').catch(() => null)));

// 2. ページ全体のテキストダンプ(概観をつかむ)
const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('--- body text (first 2000 chars) ---');
console.log(bodyText.slice(0, 2000));

// 3. テーブル/リスト構造の粗い採取
const rows = await page
  .evaluate(() => {
    const tables = [...document.querySelectorAll('table')];
    return tables.map((t) => ({
      headers: [...t.querySelectorAll('th')].map((th) => th.textContent?.trim()),
      firstRow: [...(t.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim()),
    }));
  })
  .catch(() => []);
console.log('--- tables ---');
console.log(JSON.stringify(rows, null, 1));

// 4. フォロワー数(クリエイターページ)
const handle = r.rows[0].handle;
if (handle) {
  await page.goto(`https://note.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('creator page url:', page.url());
  await shot('02-creator-page');
  const followerText = await page
    .evaluate(() => {
      const els = [...document.querySelectorAll('a,span,div')].filter((e) => /フォロワー/.test(e.textContent || ''));
      return els.slice(0, 5).map((e) => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 60), text: (e.textContent || '').trim().slice(0, 60) }));
    })
    .catch(() => []);
  console.log('--- follower candidates ---');
  console.log(JSON.stringify(followerText, null, 1));
}

// 5. 記事別ビュー/スキの一覧 (コンテンツ管理ページ)
await page.goto('https://note.com/sitesettings/stats/pv', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto pv err', e.message));
await page.waitForTimeout(4000);
console.log('url after /sitesettings/stats/pv:', page.url());
await shot('03-stats-pv');
const pvText = await page.locator('body').innerText().catch(() => '');
console.log('--- pv page text (first 2000 chars) ---');
console.log(pvText.slice(0, 2000));

await browser.close();
