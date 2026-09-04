/** KWL 新規作品登録フォームの入力欄・ボタン・ファイル入力を詳細ダンプ。 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const reqRoot = createRequire(path.join(REPO, 'package.json'));
const { chromium } = req('playwright');
const { Client } = reqRoot(path.join(REPO, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
const OUT = path.join(REPO, 'scripts/kobo/out'); fs.mkdirSync(OUT, { recursive: true });
function decrypt(b64) { const raw = Buffer.from(b64, 'base64'); const key = Buffer.from(process.env.KDP_CRED_KEY, 'hex'); const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12)); d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'); }
const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
await c.connect(); const r = await c.query("SELECT kobo_session_state_enc FROM app_settings WHERE id='singleton'"); await c.end();
const state = JSON.parse(decrypt(r.rows[0].kobo_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1200 } });
const page = await ctx.newPage();

await page.goto('https://rakutenkwl.kobo.com/v2/ebooks/ebook/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
console.log('URL:', page.url());
// SPAの可能性 — タブ/ステップ構造も見る
const dump = await page.evaluate(() => {
  const vis = (e) => e.offsetWidth || e.offsetHeight || e.getClientRects().length;
  const fields = [...document.querySelectorAll('input,textarea,select')].filter(vis).map((e) => ({
    tag: e.tagName.toLowerCase(), type: e.type || '', id: e.id || '', name: e.name || '',
    ph: e.placeholder || '', label: (e.labels && e.labels[0]?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
  }));
  const buttons = [...document.querySelectorAll('button,[role=button],a.btn,input[type=submit]')].filter(vis).map((b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean);
  const tabs = [...document.querySelectorAll('[role=tab],.step,.tab,[class*=step],[class*=Step],[class*=tab],[class*=Tab]')].filter(vis).map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 15);
  const fileInputs = [...document.querySelectorAll('input[type=file]')].map((f) => ({ id: f.id, name: f.name, accept: f.accept }));
  const labels = [...document.querySelectorAll('label')].filter(vis).map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  return { fields, buttons, tabs, fileInputs, labels, bodyLen: (document.body.innerText || '').length };
});
console.log('=== FIELDS ===\n', JSON.stringify(dump.fields, null, 1));
console.log('=== FILE INPUTS ===\n', JSON.stringify(dump.fileInputs));
console.log('=== BUTTONS ===\n', JSON.stringify(dump.buttons));
console.log('=== TABS/STEPS ===\n', JSON.stringify(dump.tabs));
console.log('=== LABELS ===\n', JSON.stringify(dump.labels));
await page.screenshot({ path: path.join(OUT, 'kwl-form.png'), fullPage: true }).catch(() => {});
await browser.close();
process.exit(0);
