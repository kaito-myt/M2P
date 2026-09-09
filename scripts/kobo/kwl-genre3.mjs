import { createRequire } from 'module';
import path from 'path'; import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
function dec(b64) { const raw = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(process.env.KDP_CRED_KEY, 'hex'), raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].kobo_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

const slotState = () => page.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find((e) => /ご選択のジャンル/.test(e.textContent || '') && (e.textContent || '').length < 300);
  const red = [...document.querySelectorAll('*')].some((e) => e.offsetParent !== null && e.children.length === 0 && /1つ以上ご選択ください/.test((e.textContent || '').trim()));
  return { slot: h ? (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90) : '?', red };
});

// トップ「ビジネス・経済・就職」をクリックして展開
const top = page.getByText(/^ビジネス・経済・就職\s*›?\s*$/).first();
console.log('トップ数:', await top.count().catch(() => 0));
await top.click({ force: true }).catch((e) => console.log('top click err', e.message.slice(0, 40)));
await page.waitForTimeout(2500);
console.log('展開後の枠:', JSON.stringify(await slotState()));

const subs = await page.evaluate(() => [...document.querySelectorAll('li,a,button,[role=button],span,div')]
  .filter((e) => e.offsetParent !== null && e.children.length === 0)
  .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim())
  .filter((t) => t.length > 2 && t.length < 20 && /投資|経営|マネー|起業|副業|ビジネス|経済|就職|資産|株|一般/.test(t)));
console.log('展開後サブ候補:', JSON.stringify([...new Set(subs)].slice(0, 20)));

// サブ候補を順にクリックして枠に入るか
for (const cand of subs.slice(0, 8)) {
  const leaf = page.getByText(cand, { exact: true }).first();
  if (await leaf.count().catch(() => 0)) {
    await leaf.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1800);
    const st = await slotState();
    console.log('葉[' + cand + ']→', JSON.stringify(st));
    if (!st.red) { console.log('★成功葉: ' + cand); break; }
  }
}
await browser.close();
process.exit(0);
