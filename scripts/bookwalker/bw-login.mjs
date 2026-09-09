/**
 * BookWalker著者センター ログインセッション捕獲。
 *   node scripts/bookwalker/bw-login.mjs
 * 専用プロファイル scripts/.bw-userdata で headful Chrome を開き author.bookwalker.jp を表示。
 * 運営者が手動ログイン(初回は会員登録+SMS認証)するのを最大30分待ち、ログイン検知で終了。
 * 以後のスクリプトは同プロファイルでセッション再利用。
 */
import { createRequire } from 'module';
import path from 'path';
const SCRIPT_PATH = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO = path.resolve(path.dirname(SCRIPT_PATH), '../..');
const req = createRequire(path.join(REPO, 'apps/worker/package.json'));
const pw = req('playwright');
const chromium = pw.chromium ?? pw.default?.chromium;
const USERDATA = path.join(REPO, 'scripts/.bw-userdata');

const ctx = await chromium.launchPersistentContext(USERDATA, {
  headless: false, channel: 'chrome', locale: 'ja-JP',
  viewport: { width: 1300, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(60000);
await page.goto('https://author.bookwalker.jp/books/new', { waitUntil: 'domcontentloaded' });
console.log('ブラウザを開きました。ログイン(未登録なら会員登録)をお願いします。最大30分待ちます…');
for (let i = 0; i < 360; i++) {
  await page.waitForTimeout(5000);
  const url = page.url();
  const loggedIn = /author\.bookwalker\.jp\/(books|home|dashboard)/.test(url) &&
    !(await page.evaluate(() => /ログイン|会員登録/.test(document.querySelector('h1,h2,form')?.textContent || '')) .catch(() => false)) &&
    await page.evaluate(() => !document.querySelector('input[type=password]'));
  if (i % 12 === 0) console.log(`  待機${Math.round(i / 12)}分 url=${url.slice(0, 70)}`);
  if (loggedIn) { console.log('✅ ログイン検知: ' + url); break; }
}
console.log('セッションを保存して終了します(プロファイル: scripts/.bw-userdata)。');
await ctx.close();
process.exit(0);
