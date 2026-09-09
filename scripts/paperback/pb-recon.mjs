/**
 * ペーパーバック作成ウィザード偵察 (提出しない):
 * 本棚で対象ASINを検索 → 「ペーパーバックの作成」クリック → 遷移後の画面のフォーム要素を全ダンプ+スクショ。
 * 保存/提出は一切クリックしない。作成枠モーダルが出たらその文言を記録して終了。
 *   node scripts/paperback/pb-recon.mjs B0HBXR8LN6
 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.kdp-userdata');
const OUT = path.join(REPO, 'scripts/paperback/out');
const asin = process.argv[2];
if (!asin) { console.log('usage: pb-recon.mjs <ASIN>'); process.exit(1); }

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1500, height: 1200 }, args: ['--disable-blink-features=AutomationControlled'],
});
ctx.setDefaultTimeout(60000);
const page = ctx.pages()[0] ?? (await ctx.newPage());

async function dump(label) {
  const info = await page.evaluate(() => {
    const els = [];
    for (const el of document.querySelectorAll('input,select,textarea,[role=radio],[role=checkbox],button')) {
      const lab = el.labels?.[0]?.textContent?.trim() || el.getAttribute('aria-label') || '';
      const t = {
        tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '',
        id: el.id || '', name: el.getAttribute('name') || '', label: lab.slice(0, 60),
        value: (el.value || '').slice(0, 40), checked: el.checked ?? el.getAttribute('aria-checked') ?? '',
        text: (el.tagName === 'BUTTON' ? (el.textContent || '').trim().slice(0, 40) : ''),
        visible: !!(el.offsetWidth || el.offsetHeight),
      };
      if (t.id || t.name || t.label || t.text) els.push(t);
    }
    const heads = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim().slice(0, 80)).filter(Boolean);
    const modal = [...document.querySelectorAll('[role=dialog],.a-popover,.modal')].map((m) => m.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
    return { url: location.href, heads, modal, els };
  });
  console.log(`\n===== DUMP ${label} =====`);
  console.log('URL:', info.url);
  console.log('HEADINGS:', JSON.stringify(info.heads));
  if (info.modal.length) console.log('MODAL:', JSON.stringify(info.modal));
  for (const e of info.els.filter((x) => x.visible)) console.log(JSON.stringify(e));
  await page.screenshot({ path: path.join(OUT, `recon-${label}.png`), fullPage: true }).catch(() => {});
}

// 1) 本棚で ASIN 検索
await page.goto('https://kdp.amazon.co.jp/ja_JP/bookshelf', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
if (/signin/i.test(page.url())) { console.log('NOT_LOGGED_IN'); await ctx.close(); process.exit(2); }
const sb = await page.$('input[type="search"], input[aria-label*="検索"], input[placeholder*="検索"]');
if (sb) { await sb.fill(asin); await page.keyboard.press('Enter'); await page.waitForTimeout(5000); }

// 2) 対象行の「ペーパーバックの作成」を探してクリック
const clicked = await page.evaluate((asin) => {
  const cands = [...document.querySelectorAll('a,button,span[role=button]')].filter((el) => /ペーパーバックの作成/.test(el.textContent || ''));
  for (const el of cands) {
    let row = el;
    for (let i = 0; i < 14 && row; i++) { row = row.parentElement; if ((row?.textContent || '').includes(asin)) break; }
    if ((row?.textContent || '').includes(asin) || cands.length === 1) { el.click(); return true; }
  }
  if (cands[0]) { cands[0].click(); return 'first_fallback'; }
  return false;
}, asin);
console.log('ペーパーバックの作成 クリック:', clicked);
if (!clicked) { await dump('no-button'); await ctx.close(); process.exit(3); }
await page.waitForTimeout(9000);

// 3) 遷移先(詳細ページ or モーダル)をダンプ
await dump('step1');

// 4) 次のステップの偵察はしない(保存を押さないと進めないため)。ここで終了。
console.log('\nRECON DONE (何も保存していません)');
await ctx.close();
process.exit(0);
