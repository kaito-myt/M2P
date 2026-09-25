/**
 * KDP 本棚の「下書き」一覧を READ-ONLY で確認する (F-041 診断)。
 * サーバー側 `kdp.submit` が creation_limit / no_draft で止まる原因を切り分けるために、
 * 「上書き可能な下書きが実際に残っているか」を見る。状態変更操作は一切行わない。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/kdp/shelf-drafts-recon.mjs
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

const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query(
  "select kdp_session_state_enc from accounts where status='active' and kdp_session_state_enc is not null order by created_at limit 1",
);
await c.end();
if (!rows[0]) {
  console.log('KDP セッション無し');
  process.exit(1);
}
const state = JSON.parse(dec(rows[0].kdp_session_state_enc, process.env.KDP_CRED_KEY));

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1200 } });
await ctx.addInitScript({ content: 'globalThis.__name=globalThis.__name||function(f){return f;};' });
const page = await ctx.newPage();
page.setDefaultTimeout(45000);

await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(7000);
if (/\/ap\/signin|\/signin/i.test(page.url())) {
  console.log('セッション失効');
  await browser.close();
  process.exit(2);
}

const summary = await page.evaluate(() => {
  const found = [];
  for (const el of document.querySelectorAll('div,li,tr')) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!/^(Kindle 本|ペーパーバック)/.test(t)) continue;
    if (t.length > 400) continue;
    found.push(t.slice(0, 120));
  }
  const uniq = [...new Set(found)];
  const counts = {};
  for (const r of uniq) {
    const m = r.match(/^(Kindle 本|ペーパーバック)\s+(\S+)/);
    const k = m ? `${m[1]}/${m[2]}` : 'other';
    counts[k] = (counts[k] || 0) + 1;
  }
  return { counts, sample: uniq.slice(0, 5) };
});
console.log('本棚 1 ページ目の行サマリ:', JSON.stringify(summary.counts));
for (const s of summary.sample) console.log(' -', s);

// 「下書き」フィルタを当てる
const filtered = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('option')].find((o) => (o.textContent || '').trim() === '下書き');
  if (!opt) return false;
  const sel = opt.closest('select');
  if (!sel) return false;
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
});
console.log('下書きフィルタ適用:', filtered);
await page.waitForTimeout(7000);

const drafts = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div,li,tr')) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^(Kindle 本|ペーパーバック)\s+下書き/.test(t) && t.length < 400) out.push(t.slice(0, 140));
  }
  return [...new Set(out)];
});
console.log(`下書き: ${drafts.length} 件`);
for (const d of drafts.slice(0, 10)) console.log(' -', d);

// 下書き行の編集リンクから titleId を拾う (ペーパーバックの再開に必要)。
const links = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/(paperback|print-setup)[^"']*?\/([A-Z0-9]{8,})/);
    if (m) out.push({ href, titleId: m[2], text: (a.textContent || '').trim().slice(0, 40) });
  }
  const seen = new Set();
  return out.filter((x) => (seen.has(x.titleId) ? false : (seen.add(x.titleId), true)));
});
console.log(`下書きの titleId 候補: ${links.length} 件`);
for (const l of links) console.log(` - ${l.titleId} ${l.href.slice(0, 90)}`);

const bodyHasLimit = await page.evaluate(() => /本の作成数制限|提出可能な本の数/.test(document.body.innerText || ''));
console.log('本棚上に作成数制限の表示:', bodyHasLimit);
await browser.close();
