/** サーバーと同一条件(headless chromium + storageState + UA)で /books/new 到達を検証する診断。 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const { chromium } = req('playwright');
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// storageState はプロファイルから直接抽出(サーバーが使うものと同一の生成方法)
const persist = await chromium.launchPersistentContext(path.join(REPO, 'scripts/.bw-userdata2'), { headless: true, channel: 'chrome' });
const state = await persist.storageState();
await persist.close();
console.log('cookies:', state.cookies.length);

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ storageState: state, userAgent: UA, locale: 'ja-JP', viewport: { width: 1400, height: 1100 } });
ctx.setDefaultTimeout(60000);
const page = await ctx.newPage();
try {
  const t0 = Date.now();
  await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
  console.log(`goto ok ${Date.now() - t0}ms url=${page.url()}`);
  await page.waitForTimeout(6000);
  console.log('after wait url=', page.url());
  const pw = await page.$('input[type=password]');
  const title = await page.title().catch(() => '?');
  console.log('password field:', !!pw, 'title:', title.slice(0, 60));
  const ids = await page.evaluate(() => ['book_main_title', 'book_files_cover', 'register-book'].map((i) => i + '=' + !!document.getElementById(i)).join(' '));
  console.log('form ids:', ids);
  await page.screenshot({ path: path.join(REPO, 'scripts/bookwalker/out/headless-test.png'), fullPage: false });
} catch (e) {
  console.log('ERROR:', e.message.slice(0, 300));
}
await browser.close();
process.exit(0);
