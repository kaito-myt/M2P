/** BWの /api/files/epub/check 400本文を取得してEPUB拒否理由を特定 */
import { createRequire } from 'module';
import path from 'path';
const SP = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SP), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const { chromium } = req('playwright');
const OUT = path.join(REPO, 'scripts/bookwalker/out');
const bookId = process.argv[2];
const persist = await chromium.launchPersistentContext(path.join(REPO, 'scripts/.bw-userdata2'), { headless: true, channel: 'chrome' });
const state = await persist.storageState(); await persist.close();
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
const ctx = await browser.newContext({ storageState: state, locale: 'ja-JP' });
const page = await ctx.newPage();
page.on('response', async (r) => {
  const u = r.url();
  if (/\/api\/files\/(epub|image)/.test(u)) {
    let body=''; try { body = (await r.text()).slice(0,500); } catch {}
    console.log(`${r.request().method()} ${r.status()} ${u.replace(/https?:\/\/[^/]+/,'')}`);
    if (body) console.log('  BODY:', body.replace(/\s+/g,' '));
  }
});
await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
await page.setInputFiles('#book_files_epub', path.join(OUT, `${bookId}.epub`)).catch(e=>console.log('e',e.message.slice(0,40)));
await page.waitForTimeout(25000);
await browser.close(); process.exit(0);
