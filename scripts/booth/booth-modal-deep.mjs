/** 「ファイルの追加・管理」モーダルを深く解析: クリック後の全要素/ボタン/file input/filechooser。 */
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
const r = await c.query("SELECT booth_session_state_enc FROM app_settings WHERE id='singleton'");
await c.end();
const state = JSON.parse(dec(r.rows[0].booth_session_state_enc));
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP', viewport: { width: 1500, height: 1400 } });
const page = await ctx.newPage();
let fcSeen = false;
page.on('filechooser', () => { fcSeen = true; });
await page.goto('https://manage.booth.pm/items/8804766/edit', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
// クリック
await page.getByText('ファイルの追加・管理', { exact: false }).first().click({ force: true }).catch((e) => console.log('click err', e.message.slice(0, 40)));
await page.waitForTimeout(8000);
// 最前面モーダル(z-index高 or fixed)の全構造
const deep = await page.evaluate(() => {
  const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
  // fixed/absolute な大きめのコンテナ = モーダル候補
  const cands = [...document.querySelectorAll('div,section,dialog,aside')].filter((e) => {
    const s = getComputedStyle(e); const r = e.getBoundingClientRect();
    return (s.position === 'fixed' || s.position === 'absolute') && r.width > 300 && r.height > 150 && r.top < 1200;
  });
  const dump = cands.slice(-3).map((m) => ({
    cls: m.className.slice(0, 50),
    text: (m.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 150),
    buttons: [...m.querySelectorAll('button,a,label,[role=button]')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20)).filter(Boolean).slice(0, 10),
    fileInputs: m.querySelectorAll('input[type=file]').length,
    iframes: m.querySelectorAll('iframe').length,
  }));
  const allFiles = [...document.querySelectorAll('input[type=file]')].map((f) => ({ accept: (f.accept || '').slice(0, 30), display: getComputedStyle(f).display, parent: f.parentElement?.className.slice(0, 30) }));
  return { modalCount: cands.length, dump, allFiles };
});
console.log('モーダル候補数:', deep.modalCount);
console.log('モーダル詳細:', JSON.stringify(deep.dump, null, 1));
console.log('全file input:', JSON.stringify(deep.allFiles));
console.log('filechooser発火:', fcSeen);
// 「ファイルを選択」「アップロード」等のボタンをクリックしてfilechooserを誘発
for (const t of ['ファイルを選択', 'アップロード', 'ファイルを追加', '選択', '参照', 'ここにドラッグ']) {
  const b = page.getByText(t, { exact: false }).first();
  if (await b.count().catch(() => 0)) {
    try { await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }).then(() => console.log('★filechooser誘発:', t)), b.click({ force: true })]); }
    catch (e) { console.log('  ' + t + ': filechooser出ず'); }
    break;
  }
}
await page.screenshot({ path: path.join(REPO, 'scripts/booth/out/modal-deep.png'), fullPage: true }).catch(() => {});
await browser.close();
process.exit(0);
