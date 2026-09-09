/** BW本棚/販売情報で申請済み書籍の状態を確認(READ-ONLY) */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata2');
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const ctx = await chromium.launchPersistentContext(USERDATA, { headless: false, channel: 'chrome', locale: 'ja-JP', viewport: { width: 1400, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(45000);
for (const url of ['https://author.bookwalker.jp/books', 'https://author.bookwalker.jp/library/bookshelf', 'https://author.bookwalker.jp/']) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);
  const items = await page.evaluate(() => {
    const rows = [];
    // テーブル行やカードから タイトル+状態 を拾う
    for (const el of document.querySelectorAll('tr, li, .book, [class*=book], [class*=item], article')) {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/手書きメモ|審査|申請|販売中|下書き|公開/.test(t) && t.length < 200) rows.push(t);
    }
    return [...new Set(rows)].slice(0, 25);
  });
  console.log(`\n=== ${url} (${page.url()}) ===`);
  for (const r of items) console.log(' ', r);
  await page.screenshot({ path: path.join(OUT, 'bw-verify-' + url.split('/').pop() + '.png'), fullPage: true }).catch(() => {});
}
console.log('\nVERIFY DONE');
await ctx.close();
process.exit(0);
