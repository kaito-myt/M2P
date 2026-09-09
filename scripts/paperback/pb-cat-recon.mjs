/** カテゴリモーダル集中偵察: 作成→カテゴリーを選択→モーダル構造をダンプして終了(保存しない) */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');
const asin = process.argv[2] || 'B0HBXR8LN6';

const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'] });
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
if (sb) { await sb.fill(asin); await page.keyboard.press('Enter'); await page.waitForTimeout(5000); }
await page.evaluate((asin) => {
  const cands = [...document.querySelectorAll('a,button,span[role=button]')].filter((el) => /ペーパーバックの作成/.test(el.textContent || ''));
  for (const el of cands) { let row = el; for (let i = 0; i < 14 && row; i++) { row = row.parentElement; if ((row?.textContent || '').includes(asin)) break; } if ((row?.textContent || '').includes(asin) || cands.length === 1) { el.click(); return; } }
  cands[0]?.click();
}, asin);
await page.waitForTimeout(9000);
console.log('URL:', page.url());
await page.click('#categories-modal-button');
await page.waitForTimeout(4000);
const dump = await page.evaluate(() => {
  const dlg = document.querySelector('[role=dialog]') || document.querySelector('.a-popover:not([style*="display: none"])') || document.querySelector('.a-modal-scroller');
  if (!dlg) return { found: false, popovers: [...document.querySelectorAll('.a-popover')].map((p) => ({ vis: p.offsetParent !== null, cls: p.className.slice(0, 80) })) };
  const controls = [];
  for (const el of dlg.querySelectorAll('input,select,button,a,[role=treeitem],[role=checkbox],[role=radio],li')) {
    const vis = !!(el.offsetWidth || el.offsetHeight);
    if (!vis) continue;
    controls.push({ tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', id: el.id || '', cls: (el.className || '').toString().slice(0, 50), text: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 70) });
    if (controls.length > 120) break;
  }
  return { found: true, text: dlg.textContent.replace(/\s+/g, ' ').trim().slice(0, 1200), controls };
});
console.log(JSON.stringify(dump, null, 1));
await page.screenshot({ path: path.join(OUT, 'cat-modal.png'), fullPage: true }).catch(() => {});
console.log('CAT RECON DONE');
await ctx.close();
process.exit(0);
